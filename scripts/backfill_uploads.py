"""把历史上传的图片补挂到对应的那条提问上。

背景：服务端不存附件，靠 uploads/<会话>/index.json 记"这些图属于第几条提问"。
这个索引是后来才加的，所以更早的图要靠文件名前缀的时间戳（上传那一刻的毫秒）
和消息落库时间来配对。跑一次就够，重复跑不会写重复项。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import sessions  # noqa: E402

TS_RE = re.compile(r"^(\d{10,13})-")
SLACK_S = 3.0  # 上传发生在开跑之前，允许一点点误差


def user_rows(session_id: str) -> list[tuple[int, float]]:
    """(第几条提问, 落库时间戳) —— 跟 display_messages 里的编号口径保持一致。"""
    rows = []
    n = 0
    for m in sessions.db().get_messages(session_id):
        if m.get("role") != "user":
            continue
        if not sessions._flatten(m.get("content")).strip():
            continue
        rows.append((n, float(m.get("timestamp") or 0)))
        n += 1
    return rows


def main() -> None:
    root = sessions.UPLOAD_DIR
    if not root.is_dir():
        print("没有上传目录，什么都不用做")
        return
    for d in sorted(p for p in root.iterdir() if p.is_dir()):
        sid = d.name
        files = sorted(f for f in d.iterdir() if f.is_file() and f.name != "index.json")
        if not files:
            continue
        have = sessions._upload_index(sid)
        done = {f for names in have.values() for f in names}
        rows = user_rows(sid)
        added = 0
        for f in files:
            if f.name in done:
                continue
            m = TS_RE.match(f.name)
            if not m or not rows:
                continue
            ts = int(m.group(1)) / 1000.0
            # 找"上传之后最近的那条提问"
            cands = [(abs(r_ts - ts), idx) for idx, r_ts in rows if r_ts >= ts - SLACK_S]
            if not cands:
                continue
            idx = min(cands)[1]
            have.setdefault(idx, [])
            have[idx] = sorted(set(have[idx] + [f.name]))
            added += 1
        if added:
            out = [{"user_index": k, "files": v} for k, v in sorted(have.items())]
            (d / "index.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
        print(f"{sid}: 补录 {added} 个文件，索引 {len(have)} 条")


if __name__ == "__main__":
    main()
