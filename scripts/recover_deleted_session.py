#!/usr/bin/env python3
"""从 Hermes state.db 的 freelist（已释放页）里抢救被删会话。

背景：relay 前端「删除会话」是物理删除（DELETE FROM sessions/messages）。
只要数据库没有 VACUUM 过，被删的行所在的数据页还留在 freelist 链上、内容原样未擦除，
就可以从这个文件里再抠出来。

用法：
  # 1) 先停下手里的写操作，把库拷一份（别在原库上折腾）
  cp -a ~/.hermes/state.db ~/.hermes/state.db-wal /tmp/recover/
  # 2) 试扫：看这个会话还能捞出多少
  python3 recover_deleted_session.py --db /tmp/recover/state.db --sid <会话id> --out /tmp/recover/rows.jsonl
  # 3) 捞到的内容写成一个 .md 便于直接看
  python3 recover_deleted_session.py --db /tmp/recover/state.db --sid <会话id> --markdown /tmp/recover/对话.md
  # 4) 写回会话库（默认用【新】id，避免和残留的内部记录撞车；--same-id 才复用原 id）
  python3 recover_deleted_session.py --db /tmp/recover/state.db --sid <会话id> --restore

只能捞到「页还没被新数据覆盖」的那部分：越早的消息越可能已经被复用，别指望 100% 完整。
"""
from __future__ import annotations

import argparse
import datetime
import json
import struct
import sys

COLS = ['id', 'session_id', 'role', 'content', 'tool_call_id', 'tool_calls', 'tool_name',
        'effect_disposition', 'timestamp', 'token_count', 'finish_reason', 'reasoning',
        'reasoning_content', 'reasoning_details', 'codex_reasoning_items', 'codex_message_items',
        'platform_message_id', 'observed', 'active', 'compacted', 'api_content', 'display_kind',
        'display_metadata', '_compressed_summary']


class DbReader:
    def __init__(self, path: str):
        self.f = open(path, 'rb')
        hdr = self.f.read(100)
        ps = struct.unpack('>H', hdr[16:18])[0]
        self.ps = 65536 if ps == 1 else ps
        self.first_trunk = struct.unpack('>I', hdr[32:36])[0]
        self.size = __import__('os').path.getsize(path)

    def page(self, n: int) -> bytes:
        self.f.seek((n - 1) * self.ps)
        return self.f.read(self.ps)

    def free_pages(self) -> list[int]:
        out, t = set(), self.first_trunk
        while t:
            page = self.page(t)
            nxt = struct.unpack('>I', page[0:4])[0]
            n = struct.unpack('>I', page[4:8])[0]
            out.add(t)
            for i in range(min(n, (self.ps - 8) // 4)):
                leaf = struct.unpack('>I', page[8 + 4 * i:12 + 4 * i])[0]
                if leaf:
                    out.add(leaf)
            t = nxt
        return sorted(out)

    def overflow(self, first: int, want: int) -> bytes:
        out, p, seen = b'', first, set()
        while p and len(out) < want and p not in seen:
            seen.add(p)
            page = self.page(p)
            out += page[4:]
            p = struct.unpack('>I', page[0:4])[0]
        return out[:want]


def parse_varint(buf: bytes, i: int):
    v = 0
    for k in range(9):
        b = buf[i + k]
        if k == 8:
            return (v << 8) | b, i + 9
        v = (v << 7) | (b & 0x7F)
        if not b & 0x80:
            return v, i + k + 1
    return v, i + 9


def serial_len(t: int) -> int:
    if t >= 13:
        return (t - 13) // 2
    return {0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 6, 6: 8, 7: 8, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0}[t]


def parse_record(payload: bytes) -> list:
    if not payload:
        return []
    hsize, i = parse_varint(payload, 0)
    types = []
    while i < hsize and i < len(payload):
        t, i = parse_varint(payload, i)
        types.append(t)
    vals, off = [], hsize
    for t in types:
        ln = serial_len(t)
        raw = payload[off:off + ln]
        off += ln
        if t == 0:
            vals.append(None)
        elif t in (8, 9):
            vals.append(1 if t == 9 else 0)
        elif t in (1, 2, 3, 4, 5, 6):
            vals.append(int.from_bytes(raw, 'big', signed=(t == 1)))
        elif t == 7:
            vals.append(struct.unpack('>d', raw)[0] if ln == 8 else None)
        else:
            vals.append(raw.decode('utf-8', 'replace'))
    return vals


def leaf_cells(rd: DbReader, page: bytes):
    if not page or page[0] != 0x0D:
        return
    ncell = struct.unpack('>H', page[3:5])[0]
    if ncell > 2000:
        return
    for i in range(ncell):
        pos = 8 + 2 * i
        if pos + 2 > len(page):
            return
        off = struct.unpack('>H', page[pos:pos + 2])[0]
        if off == 0 or off >= len(page):
            continue
        try:
            plen, j = parse_varint(page, off)
            rowid, j = parse_varint(page, j)
        except Exception:
            continue
        max_local = rd.ps - 35
        if plen <= max_local:
            payload = page[j:j + plen]
        else:
            head = page[j:j + max_local]
            if j + max_local + 4 <= len(page):
                nxt = struct.unpack('>I', page[j + max_local:j + max_local + 4])[0]
                payload = head + rd.overflow(nxt, plen - max_local)
            else:
                payload = head
        yield rowid, payload


def scan(db_path: str, sid: str) -> list[dict]:
    rd = DbReader(db_path)
    rows = []
    for p in rd.free_pages():
        for rowid, payload in leaf_cells(rd, rd.page(p)):
            try:
                vals = parse_record(payload)
            except Exception:
                continue
            if len(vals) >= 4 and vals[1] == sid and isinstance(vals[3], str):
                d = {COLS[i]: vals[i] for i in range(min(len(vals), len(COLS)))}
                d['_rowid'] = rowid
                rows.append(d)
    rows.sort(key=lambda r: r['_rowid'])
    return rows


def tidy(rows: list[dict]) -> list[dict]:
    """时间戳修正（解析异常的行沿用上一条）+ 按内容去重（压缩重写会留两份一样的）。"""
    seen, out, prev = set(), [], None
    for r in rows:
        try:
            ts = float(r.get('timestamp'))
            ts = ts if 1.6e9 < ts < 2.0e9 else None
        except (TypeError, ValueError):
            ts = None
        if ts is None:
            ts = prev
        else:
            prev = ts
        content = r.get('content') or ''
        key = (r['role'], content.strip(), r.get('tool_call_id') or '')
        if key[1] and key in seen:
            continue
        if key[1]:
            seen.add(key)
        msg = {'role': r['role'], 'content': content, 'timestamp': ts}
        for src in ('tool_call_id', 'tool_calls', 'tool_name', 'reasoning_content'):
            if r.get(src):
                msg[src] = r[src]
        out.append(msg)
    return out


def to_markdown(rows: list[dict]) -> str:
    def stamp(r):
        try:
            return datetime.datetime.fromtimestamp(float(r['timestamp'])).strftime('%m-%d %H:%M:%S')
        except Exception:
            return '??'
    parts = ['# 恢复出来的对话片段\n',
             '> 从数据库已释放页里抢救的内容，按原顺序排列；不保证完整。\n']
    for r in rows:
        c = r.get('content') or ''
        if r['role'] == 'user':
            parts.append(f"\n### 👤 用户 {stamp(r)}\n\n{c}\n")
        elif r['role'] == 'assistant':
            if c.strip():
                parts.append(f"\n#### 🤖 助手 {stamp(r)}\n\n{c[:4000]}\n")
        else:
            parts.append(f"\n<details><summary>🔧 工具 {r.get('tool_name')} {stamp(r)}</summary>\n\n```\n{c[:800]}\n```\n</details>\n")
    return ''.join(parts)


def restore(rows: list[dict], old_sid: str, same_id: bool, title: str) -> None:
    sys.path.insert(0, '/usr/local/lib/hermes-agent')
    from hermes_state_registry import acquire
    import uuid
    sid = old_sid if same_id else uuid.uuid4().hex[:12]
    db = acquire()
    db.create_session(sid, source='webui')
    BATCH = 40
    total = 0
    for i in range(0, len(rows), BATCH):
        total += db.append_messages_batch(sid, rows[i:i + BATCH])
    db.set_session_title(sid, title)
    last = max((m['timestamp'] for m in rows if m.get('timestamp')), default=None)
    if last:
        db.touch_session_activity(sid, last)
    print(f'已写回会话 {sid}（{total} 条消息）')


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', required=True, help='state.db 的【副本】路径，别指原库')
    ap.add_argument('--sid', required=True, help='被删会话的 id')
    ap.add_argument('--out', help='把捞到的原始行写成 jsonl')
    ap.add_argument('--markdown', help='把捞到的内容写成人看的 .md')
    ap.add_argument('--restore', action='store_true', help='写回 Hermes 会话库')
    ap.add_argument('--same-id', action='store_true', help='写回时复用原来的会话 id')
    ap.add_argument('--title', default='（已恢复）', help='写回后的会话标题')
    args = ap.parse_args()

    rows = scan(args.db, args.sid)
    print(f'扫描完成：{len(rows)} 行')
    if args.out:
        with open(args.out, 'w') as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + '\n')
    clean = tidy(rows)
    print(f'清理去重后：{len(clean)} 条消息')
    if args.markdown:
        open(args.markdown, 'w').write(to_markdown(clean))
    if args.restore:
        restore(clean, args.sid, args.same_id, args.title)


if __name__ == '__main__':
    main()
