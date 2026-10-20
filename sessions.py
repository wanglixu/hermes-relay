"""会话库读写：直接复用 Hermes 自己的 state.db。

不另建库，所以网页里的对话和 CLI / Telegram 是同一份历史。
只读列表走 list_sessions_rich，历史消息走 get_messages。
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sys
import threading
import time
import urllib.parse
from pathlib import Path

AGENT_DIR = Path(os.environ.get("HERMES_AGENT_DIR", "/usr/local/lib/hermes-agent")).expanduser()
if AGENT_DIR.is_dir() and str(AGENT_DIR) not in sys.path:
    sys.path.append(str(AGENT_DIR))

from hermes_state_registry import acquire  # noqa: E402


# Hermes 压缩上下文时会把"给模型看的"交接标记写进消息里：旧尾巴用 [PRIOR CONTEXT …] 包住、
# 后面接压缩摘要（此时该行 _compressed_summary=1）。官方界面靠 agent.compaction_display 的
# 投影把这层剥掉，relay 直读 state.db、自己组消息，得走同一步 —— 否则往上翻历史就看见这堆标记。
try:
    from agent.compaction_display import project_compaction_message_for_display as _project_compaction

    def _display_content(m: dict):
        """压缩载体消息只留真实正文（官方投影）；其余原样。"""
        raw = m.get("content")
        if not (m.get("_compressed_summary") or str(raw or "")[:16] == "[PRIOR CONTEXT"):
            return raw
        try:
            projected = _project_compaction(dict(m))
        except Exception:
            return raw
        return "" if projected is None else (projected.get("content") or "")

except Exception:  # Hermes 换了接口就原样显示，不自己另写一套剥离规则
    def _display_content(m: dict):
        return m.get("content")


# 机器写进"用户角色"的行：后台进程通知、上下文压缩通知、gateway 提示……都不是他说的话。
# 官方判定口径在 agent.context_compressor（_SYNTHETIC_USER_ROW_PREFIXES / _synthetic_user_row），
# 直接用它，别自己另造一张表；下面几条是本机自建服务注入的，官方不认识，补在一起。
try:
    from agent.context_compressor import _synthetic_user_row as _hermes_synthetic_user_row
except Exception:
    _hermes_synthetic_user_row = None

_EXTRA_SCAFFOLD_USER_PREFIXES = (
    "[agentmemory context",
    "[DEFAULT]",
    "[STILL IN PROGRESS",
    # Hermes 在流被网络打断后写的续写提示：不是用户说的，也不该把一条回复切成几段
    "[System:",
    # 压缩摘要 / 交接说明
    "[CONTEXT COMPACTION",
)

# 机器信封：套在用户原话外面的那层（写入时加的），显示前剥掉，原话留着。
_SCAFFOLD_ENVELOPES = (
    re.compile(r"^\s*\[Workspace::v1:[^\]]*\]\s*"),
    re.compile(r"^\s*I've uploaded \d+ file\(s\):[^\n]*\n?"),
    re.compile(r"\[Attached files:[^\]]*\]\s*"),
)


def _is_scaffold_user_row(text: str) -> bool:
    """整条都是机器写的（没有用户原话）→ 不该显示成用户气泡。"""
    if text.lstrip().startswith(_EXTRA_SCAFFOLD_USER_PREFIXES):
        return True
    if _hermes_synthetic_user_row is not None:
        return bool(_hermes_synthetic_user_row(text))
    return False


def _strip_scaffold_envelope(text: str) -> str:
    """剥掉机器信封，只留用户原话（剥完为空就交给 _is_scaffold_user_row 判）。"""
    # 优先使用 Hermes 官方解析：还原 /skill 命令行格式（如 "/i-have-adhd 帮我看看"）
    try:
        from agent.skill_commands import describe_skill_invocation
        desc = describe_skill_invocation(text, separator=" ")
        if desc:
            return desc
    except Exception:
        pass
    out = text
    # 兼容 relay 历史上的自定义信封（[USER OVERRIDE] + [FORCED SKILL CONTEXT]）
    out = re.sub(r"^\[USER OVERRIDE\][^\n]*\n*", "", out)
    out = re.sub(r"\[FORCED SKILL CONTEXT:[^\]]+\][\s\S]*?\[/FORCED SKILL CONTEXT\]\s*", "", out)
    for rx in _SCAFFOLD_ENVELOPES:
        out = rx.sub("", out)
    return out.strip()

SOURCE = "webui"

# 上传的图片/附件落盘位置（跟 server.py 共用同一个环境变量）
UPLOAD_DIR = Path(os.environ.get("HERMES_RELAY_UPLOADS", "~/.hermes/hermes-relay/uploads")).expanduser()

# 每轮的首字响应时间（TTFT）。Hermes 库里没有这个数（助手消息的时间戳是整轮写完的时刻），
# 只能自己记：跟图片一样挂在"第几条提问"上，键是会话 id。
METRICS_FILE = UPLOAD_DIR.parent / "metrics.json"
PARTIALS_FILE = UPLOAD_DIR.parent / "partials.json"  # 被打断那轮的半截正文，一个会话只留最近一条
MAX_ROUNDS_PER_SESSION = 500
_metrics_lock = threading.Lock()
_partials_lock = threading.Lock()

# 只显示给人类看的来源，杂项（cron / 子任务 / 工具）不出现在侧栏
LISTED_SOURCES = ["webui", "cli", "telegram", "discord", "slack", "api_server"]

# 工具参数/结果进界面的上限，防止一条消息把整个 JSON 撑到几 MB
MAX_ARGS_CHARS = 2000
MAX_RESULT_CHARS = 1500
# 一条助手消息最多拼多少段（思考/工具/正文）。原来是 40，配上今天这种几十个工具调用的
# 长回合就正好撞满：后面的正文段被直接丢掉，界面只剩一屏工具行、看不到最终回答。
# 段数上限现在是防体积的兜底，工具的体积另有 MAX_TOOL_BODIES 管。
MAX_PARTS_PER_MESSAGE = 200
# 只有最近这么多个工具调用保留可展开的参数/结果，更早的只留一行摘要（省流量）
MAX_TOOL_BODIES = 60

_db = None


def db():
    """共享句柄，进程内只开一次。SessionDB 支持多读单写。"""
    global _db
    if _db is None:
        _db = acquire()
    return _db


def _clean_title(value) -> str:
    """标题里不该出现的东西：换行、Markdown 符号、超长附件标记。"""
    text = " ".join(str(value or "").split())
    text = text.replace("**", "").replace("```", "").strip("# ").strip()
    return text


def _is_generic_title(title: str) -> bool:
    """Hermes 推不出来的标题长这样：'[Workspace::v1: /home/user/workspace] #34'、Untitled、admin…"""
    if not title:
        return True
    low = title.strip().lower()
    if low in ("untitled", "admin", "未命名对话", "new chat"):
        return True
    return title.lstrip().startswith("[Workspace") or title.lstrip().startswith("[workspace")


def list_chats(limit: int = 50, offset: int = 0, q: str = None) -> list[dict]:
    rows = db().list_sessions_rich(
        sources=LISTED_SOURCES, limit=limit, offset=offset,
        order_by_last_active=True, search_query=q or None,
    )
    out = []
    for r in rows:
        sid = r.get("id")
        # 标题优先用会话库里那把（Hermes 从第一条用户消息推出来的），
        # 推不出来时退回 preview（同样是第一条用户消息）。
        # 不要用 display_name —— 那里存的是用户标识（'admin'），不是标题。
        title = _clean_title(db().get_session_title(sid)) if sid else ""
        if _is_generic_title(title):
            title = _clean_title(r.get("preview")) or ""
        out.append({
            "id": sid,
            "title": title[:64],
            "source": r.get("source") or "",
            "model": r.get("model") or "",
            "message_count": r.get("message_count") or 0,
            "last_active": r.get("last_active") or r.get("started_at") or 0,
            "preview": (r.get("preview") or "")[:200],
        })
    return out


def get_chat(session_id: str) -> dict | None:
    row = db().get_session(session_id)
    if not row:
        return None
    title = _clean_title(db().get_session_title(session_id))
    if _is_generic_title(title):
        title = ""
    return {
        "id": row.get("id"),
        "title": title[:64],
        "source": row.get("source") or "",
        "model": row.get("model") or "",
        "message_count": row.get("message_count") or 0,
        "started_at": row.get("started_at") or 0,
    }


def create_chat(session_id: str, title: str = "") -> str:
    return db().create_session(session_id, source=SOURCE, display_name=title or None)


def chat_exists(session_id: str) -> bool:
    try:
        return bool(db().get_session(session_id))
    except Exception:
        return False


def ensure_chat(session_id: str, title: str = "") -> str:
    """懒创建：真正用到这个会话（发第一条消息 / 改名）时才落库。

    点「新对话」时后端只发一个 id、不写库 —— 侧栏只列库里的会话，所以
    「点了新对话又没说话」的草稿不会在侧栏积成一条条「未命名对话」。
    """
    if chat_exists(session_id):
        return session_id
    return create_chat(session_id, title=title)


def hide_chat(session_id: str) -> None:
    """把会话藏起来（**不删除**，数据还在）。用来清掉历史上留下的空壳会话。"""
    db().set_session_hidden(session_id, True)


def rename_chat(session_id: str, title: str) -> None:
    # 上游改过接口：update_session_meta 现在只管 model_config，标题要走 set_session_title。
    # （旧调用 db().update_session_meta(session_id, display_name=title) 会 400：
    #   got an unexpected keyword argument 'display_name'）
    db().set_session_title(session_id, title)


def delete_chat(session_id: str) -> None:
    db().delete_session(session_id)


def history(session_id: str) -> list[dict]:
    """给 agent 用的对话历史。"""
    return db().get_messages_as_conversation(session_id)


def _upload_index(session_id: str) -> list[dict]:
    """这一轮的图属于哪条提问——服务端不存附件，只能我们自己记一份。

    记录按**时间戳**匹配（见 record_uploads）。10-08 之前的老记录存的是"提问序号"，
    序号已经被上下文压缩改写过了，照它挂只会张冠李戴，所以整条忽略。
    """
    try:
        data = json.loads((UPLOAD_DIR / session_id / "index.json").read_text(encoding="utf-8"))
    except Exception:
        return []
    return [
        e
        for e in (data if isinstance(data, list) else [])
        if isinstance(e, dict) and e.get("files") and isinstance(e.get("ts"), (int, float))
    ]


def _files_for(uploads: list[dict], msg_ts: float, window: float = 120.0) -> list[str]:
    """这条提问当时的附件：记录时刻和消息落库时刻相差 window 秒内算同一轮，取最近的一条。"""
    best: tuple[float, list[str]] | None = None
    for e in uploads:
        gap = abs(float(e["ts"]) - msg_ts)
        if gap <= window and (best is None or gap < best[0]):
            best = (gap, [str(f) for f in e["files"]])
    return best[1] if best else []


def record_uploads(session_id: str, names: list[str]) -> float:
    """在开跑一轮之前调用：把这一轮带的附件记到**当时的时间戳**上。

    原来记的是"第几条提问"（数库里的提问条数）。上下文压缩会往历史里插新的 user 行、
    把老行标成 inactive，序号一漂，旧记录就挂到后来的消息上——10-08 就是这么坏的：
    10:49 传的截图跑到了 11:04 那条消息旁边。时间戳跟着消息本身走，压缩重写的行也保留原时间戳。
    """
    files = [n for n in names if n]
    if not files:
        return 0.0
    ts = time.time()
    d = UPLOAD_DIR / session_id
    d.mkdir(parents=True, exist_ok=True)
    f = d / "index.json"
    try:
        data = json.loads(f.read_text(encoding="utf-8")) if f.exists() else []
    except Exception:
        data = []
    data = [
        e
        for e in (data if isinstance(data, list) else [])
        if not (
            isinstance(e, dict)
            and isinstance(e.get("ts"), (int, float))
            and abs(e["ts"] - ts) < 120
        )
    ]
    data.append({"ts": round(ts, 3), "files": files})
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    tmp.replace(f)
    return ts


def _load_partials() -> dict:
    try:
        data = json.loads(PARTIALS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _write_partials(data: dict) -> None:
    PARTIALS_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = PARTIALS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    tmp.replace(PARTIALS_FILE)


def save_partial(session_id: str, text: str, ts: float) -> None:
    """被打断时把已经吐出来的正文存下来（一个会话只留最近一条）。

    存的是**服务端收到那一轮的时刻**，读取时拿它跟库里最后一条消息的时间戳比：
    更新才追加，免得正常跑完的轮次后面又冒出一条重复的「半截」。
    """
    text = (text or "").strip()
    if not text:
        return
    try:
        at = round(float(ts), 3)
    except (TypeError, ValueError):
        at = 0.0
    with _partials_lock:
        data = _load_partials()
        data[session_id] = {"ts": at, "text": text}
        _write_partials(data)


def clear_partial(session_id: str) -> None:
    """这一轮正常跑完了：库里已经有完整回复，半截记录该丢掉。"""
    with _partials_lock:
        data = _load_partials()
        if session_id in data:
            del data[session_id]
            _write_partials(data)


def _load_partial(session_id: str) -> dict | None:
    entry = _load_partials().get(session_id)
    return entry if isinstance(entry, dict) else None


def _load_metrics() -> dict:
    try:
        data = json.loads(METRICS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _write_metrics(data: dict) -> None:
    METRICS_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = METRICS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    tmp.replace(METRICS_FILE)


def prune_metrics(dry_run: bool = False) -> dict:
    """删掉 metrics.json 里已经不存在于会话库的条目。

    会话被删（`delete_chat`）时只清 Hermes 库和上传目录，metrics 是另一份 json，
    一直没人回收：2026-10-19 量到 68 条里 24 条的会话已经没了。
    按会话库对账最准，不看时间——老会话只要还在就该留着耗时数据。
    """
    with _metrics_lock:
        data = _load_metrics()
        total = len(data)
        stale = [k for k in data if not chat_exists(k)]
        if stale and not dry_run:
            for k in stale:
                data.pop(k, None)
            _write_metrics(data)
    return {"removed": len(stale), "kept": total - len(stale), "ids": stale}


# 上传目录里的孤儿判定：会话已删 + 最后写入超过这么多天。草稿目录单独留着。
UPLOAD_TTL_DAYS = 30


def gc_uploads(dry_run: bool = True, ttl_days: int = UPLOAD_TTL_DAYS) -> dict:
    """回收「会话已删、图还躺在磁盘上」的上传目录。

    目录名就是会话 id（草稿期是 `draft`，无 id 时是 `misc`）——那两个永远留着：
    draft 是当前新会话正在用的图，删了会让人正在打的字里图片变裂图。
    判据是**目录里最新文件的 mtime**，不是目录本身的 mtime。
    """
    now = time.time()
    root = Path(UPLOAD_DIR)
    keep = {"draft", "misc"}
    candidates, kept = [], 0
    try:
        entries = [p for p in root.iterdir() if p.is_dir()]
    except OSError:
        return {"scanned": 0, "removed": 0, "bytes": 0, "dirs": []}
    for d in entries:
        if d.name in keep or chat_exists(d.name):
            kept += 1
            continue
        files = [p for p in d.rglob("*") if p.is_file()]
        newest = max((p.stat().st_mtime for p in files), default=d.stat().st_mtime)
        age_days = (now - newest) / 86400
        if age_days < ttl_days:
            kept += 1
            continue
        size = sum(p.stat().st_size for p in files)
        candidates.append({"id": d.name, "bytes": size, "age_days": round(age_days, 1), "files": len(files)})
        if not dry_run:
            shutil.rmtree(d, ignore_errors=True)
    return {
        "scanned": len(entries),
        "removed": 0 if dry_run else len(candidates),
        "pending": len(candidates) if dry_run else 0,
        "kept": kept,
        "bytes": sum(c["bytes"] for c in candidates),
        "dirs": sorted(candidates, key=lambda c: -c["bytes"]),
    }


def record_ttft(session_id: str, ttft: float, dur: float | None = None,
                out_tokens: int | None = None, gen_seconds: float | None = None,
                cache: dict | None = None) -> float:
    """记下这一轮的首字响应时间（TTFT）和整轮用时。

    调用时机是这一轮正常跑完之后，用户那条消息已经落库了，
    所以拿「最后一条用户消息的时间戳」当这一轮的键（同时留一份序号给老数据兜底）。

    键用**时间戳**而不是「第几条提问」：上下文一压缩，序号就会漂
    （图片附件踩过同一个坑），时间戳不会。老记录里只有序号，
    读取时退回按序号匹配，不至于让老会话的耗时直接消失。

    两个数从同一刻起算（服务端收到这一轮的请求）：
    首字 = 到第一个片段（一般是第一段思考），用时 = 到整轮结束。
    库里的消息时间戳做不到这一点——用户消息落库比请求到达要晚一两秒。
    """
    try:
        value = round(float(ttft), 2)
    except (TypeError, ValueError):
        return -1
    users = [
        m
        for m in db().get_messages(session_id)
        if m.get("role") == "user" and _flatten(m.get("content"))
    ]
    if not users:
        return -1
    idx = len(users) - 1
    try:
        key_ts = round(float(users[-1].get("timestamp") or 0), 3)
    except (TypeError, ValueError):
        key_ts = 0.0
    row: dict = {"user_index": idx, "ttft": value}
    if key_ts > 0:
        row["user_ts"] = key_ts
    try:
        if dur is not None:
            row["dur"] = round(float(dur), 2)
    except (TypeError, ValueError):
        pass
    try:
        if out_tokens is not None:
            row["out_tokens"] = int(out_tokens)
    except (TypeError, ValueError):
        pass
    try:
        if gen_seconds is not None:
            # 真正在收字的秒数：tok/s 的分母。落了库，刷新页面后给出的速度跟当时一致。
            row["gen_seconds"] = round(float(gen_seconds), 2)
    except (TypeError, ValueError):
        pass
    if isinstance(cache, dict):
        # 这一轮 Hermes 自己数的 token（agent 实例内存里的计数器，实例一销毁就没了，
        # 所以趁刚跑完当场记下来）。命令行状态栏那个命中率就是拿这几个数算的。
        for _k in ("cache_read", "cache_write", "prompt_total", "api_calls"):
            _v = cache.get(_k)
            if isinstance(_v, int):
                row[_k] = _v
        # 记下这一轮用的是哪个模型：命中率只按当前模型算（Hermes 换模型会重置缓存基线），
        # 汇总时得能挑出来。
        _model = cache.get("model")
        if isinstance(_model, str) and _model:
            row["model"] = _model
    def _is_same(e: dict) -> bool:
        """同一条提问的旧记录：有时间戳的按时间戳比，没有的退回比序号。"""
        if key_ts > 0 and e.get("user_ts") is not None:
            try:
                return abs(float(e["user_ts"]) - key_ts) < 0.005
            except (TypeError, ValueError):
                return False
        return e.get("user_index") == idx

    with _metrics_lock:
        data = _load_metrics()
        rows = [e for e in (data.get(session_id) or []) if isinstance(e, dict)]
        rows = [e for e in rows if not _is_same(e)]
        rows.append(row)
        data[session_id] = rows[-MAX_ROUNDS_PER_SESSION:]
        METRICS_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = METRICS_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        tmp.replace(METRICS_FILE)
    return key_ts or float(idx)


def _same_model_name(a, b) -> bool:
    """同一个模型：名字可能带渠道前缀（cline-pass/deepseek-v4.1-flash）。"""
    x, y = str(a or "").strip().lower(), str(b or "").strip().lower()
    return bool(x) and bool(y) and (x == y or x.split("/")[-1] == y.split("/")[-1])


def turn_cache_stats(session_id: str, model: str = "") -> dict:
    """汇总这个会话里「Hermes 当场报的」缓存计数（只覆盖加了埋点之后跑的轮次）。

    和 session_model_usage 那张表的区别：那张表是 Hermes 每轮写进库的账
    （按模型/任务分行累计），这里是每轮结束时 agent 实例内存计数器的快照。
    两者口径都是「未命中输入 + 命中 + 写入 = 总输入」，但快照能分辨
    「上游压根没返回缓存字段」（该轮命中/写入全 0 而总输入 > 0）和
    「返回了但真没命中」—— 库里只有数字，分不出来。
    """
    cr = cw = pt = 0
    turns = 0
    reported = False
    entries = [e for e in (_load_metrics().get(session_id) or []) if isinstance(e, dict)]
    # 只看当前模型的轮次：换了模型，前面那些轮（很可能来自不报缓存的接口）会把命中率拖到 0。
    # 老记录里没有模型字段，那就退回全部，别把已有数据藏起来。
    if model and any(e.get("model") for e in entries):
        entries = [e for e in entries if _same_model_name(e.get("model"), model)]
    for e in entries:
        if not isinstance(e, dict):
            continue
        _cr, _pt = e.get("cache_read"), e.get("prompt_total")
        if not isinstance(_cr, int) or not isinstance(_pt, int) or _pt <= 0:
            continue
        _cw = e.get("cache_write") if isinstance(e.get("cache_write"), int) else 0
        cr += _cr
        cw += _cw
        pt += _pt
        turns += 1
        if _cr or _cw:
            reported = True
    return {
        "turns": turns,
        "cache_read": cr,
        "cache_write": cw,
        "prompt_total": pt,
        "hit_rate": round(cr / pt, 4) if pt else 0.0,
        "reported": reported,
    }


def _turn_metrics(session_id: str) -> tuple[dict[float, dict], dict[int, dict]]:
    """这个会话每一轮的指标，返回 (按提问时间戳索引的, 按序号索引的)。

    新记录两个键都有，读取时**优先用时间戳**；只有序号的老记录退回按序号匹配
    —— 压缩后序号可能漂，但总比整段耗时不显示强。
    """
    by_ts: dict[float, dict] = {}
    by_idx: dict[int, dict] = {}
    for e in _load_metrics().get(session_id) or []:
        if not isinstance(e, dict):
            continue
        row: dict = {}
        for k in ("ttft", "dur", "out_tokens", "gen_seconds"):
            try:
                if e.get(k) is not None:
                    row[k] = float(e[k])
            except (TypeError, ValueError):
                continue
        if not row:
            continue
        if e.get("user_ts") is not None:
            try:
                by_ts[round(float(e["user_ts"]), 3)] = row
            except (TypeError, ValueError):
                pass
        if isinstance(e.get("user_index"), int):
            by_idx[e["user_index"]] = row
    return by_ts, by_idx


def _flatten(content) -> str:
    """消息正文可能是字符串，也可能是多模态的 parts 数组。"""
    if isinstance(content, list):
        return "\n".join(
            p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text"
        )
    return str(content or "")


def _brief_from_args(args) -> str:
    """给工具行取一句人看的摘要：命令 / 路径 / 查询词。"""
    if not isinstance(args, dict):
        return ""
    for k in ("command", "file_path", "path", "query", "prompt", "pattern", "url", "name"):
        v = args.get(k)
        if v:
            return " ".join(str(v).split())[:110]
    try:
        return " ".join(json.dumps(args, ensure_ascii=False).split())[:110]
    except Exception:
        return ""


def _parse_tool_calls(raw) -> list[dict]:
    """助手行里的 tool_calls：拿到每个调用的名字、参数摘要、完整参数。"""
    if not raw:
        return []
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        return []
    out = []
    for c in data or []:
        if not isinstance(c, dict):
            continue
        fn = c.get("function") if isinstance(c.get("function"), dict) else {}
        name = str(fn.get("name") or c.get("name") or "tool")
        arg_raw = fn.get("arguments") if fn else c.get("arguments")
        args: dict = {}
        if isinstance(arg_raw, str):
            try:
                args = json.loads(arg_raw)
            except Exception:
                args = {}
        elif isinstance(arg_raw, dict):
            args = arg_raw
        try:
            args_text = json.dumps(args, ensure_ascii=False, indent=2) if args else str(arg_raw or "")[:MAX_ARGS_CHARS]
        except Exception:
            args_text = str(arg_raw or "")[:MAX_ARGS_CHARS]
        out.append({
            "id": str(c.get("id") or c.get("call_id") or ""),
            "name": name,
            "brief": _brief_from_args(args),
            "args_text": args_text[:MAX_ARGS_CHARS],
        })
    return out


def slice_turns(msgs: list[dict], turns: int | None, before: int = 0) -> tuple[list[dict], bool, int]:
    """按「回合」切展示窗口，供前端只渲染最近几个回合用。

    一个回合 = 一条提问到它的助手回答结束（`display_messages` 的产出就是这种成对的列表）。
    `before` 是已经给过的、从末尾数过去的回合数（上一页的游标）；`turns` 是这一页要几个回合，
    给 None 就是一路取到开头。返回（窗口, 上面还有没有更早的, 这一页装了几个回合）。

    这里只切「显示窗口」：不动数据库、不动 Hermes 自己的上下文管理。
    """
    ends = [i for i, m in enumerate(msgs) if m.get("role") == "assistant"]
    total = len(ends)
    if before >= total:
        return [], False, 0
    last = total - before  # 这一页结束在第几个回合之后
    first = 0 if turns is None else max(0, last - turns)
    start = ends[first - 1] + 1 if first > 0 else 0
    stop = len(msgs) if before == 0 else ends[last - 1] + 1
    return msgs[start:stop], first > 0, last - first


def display_messages(session_id: str) -> list[dict]:
    """给界面显示的消息。

    一个回合 = 一条用户消息到下一条用户消息之间。回合内部按**行顺序**组装 parts：
    思考片段、工具调用、正文依次排列，跟当时真实发生的顺序一致
    （正文/思考落在 assistant 行上，工具参数在 assistant 行的 tool_calls 里，
    工具结果在紧随其后的 tool 行里，用 tool_call_id 配对）。
    耗时只挂在**回合的最后一条助手消息**上，是这个回合一整轮的总耗时。
    """
    # 读"显示口径"：活跃行 + 压缩归档行。压缩只是把老行从**给模型的上下文**里摘掉，
    # 历史仍然是用户的历史 —— 官方界面就是这么读的（tui_gateway 传 include_compacted=True，
    # 注释原话 "a compacted session's archived turns are still the user's"）。
    # 用默认那档（只读 active=1），压缩一次后往上划就看不到更早的消息了。
    rows = db().get_messages(session_id, include_compacted=True)
    out: list[dict] = []
    args_by_id: dict[str, dict] = {}
    uploads = _upload_index(session_id)
    metrics_ts, metrics_idx = _turn_metrics(session_id)
    user_n = 0  # 第几条用户提问（从 0 数），用来把上传的图挂回对应那条
    cur: dict | None = None

    def new_turn(user_ts: float, idx: int | None = None) -> dict:
        return {
            "user_ts": user_ts,
            "idx": idx,
            "last_assistant_ts": 0.0,
            "msg": {"role": "assistant", "ts": 0.0, "parts": []},
        }

    def add_part(part: dict) -> None:
        """往当前回合加一段。段数上限是防体积的兜底，但正文不能被工具行挤掉：
        撞到上限时先丢掉最前面的一段非正文，把位置腾出来。"""
        if cur is None:
            return
        parts = cur["msg"]["parts"]
        if len(parts) >= MAX_PARTS_PER_MESSAGE:
            for i, p in enumerate(parts):
                if p.get("kind") != "text":
                    parts.pop(i)
                    break
            else:
                return  # 整条都是正文，那就不加了
        parts.append(part)

    def close_turn() -> None:
        nonlocal cur
        if cur is None:
            return
        msg = cur["msg"]
        if msg["parts"]:
            msg["_turn_ts"] = cur["user_ts"]  # 内部用：压缩记录要按时间挂回回合
            # 用时和首字都优先用我们自己的埋点（同一刻起算，口径可比）；
            # 早于埋点的老回合没有这两个数，用时退回用库里的时间戳差。
            # 优先按这条提问的时间戳对位（压缩后序号会漂）；老记录只有序号，退回按序号
            m = metrics_ts.get(round(float(cur["user_ts"]), 3)) if cur.get("user_ts") else None
            if m is None and cur.get("idx") is not None:
                m = metrics_idx.get(cur["idx"])
            if m:
                if m.get("dur"):
                    msg["elapsed"] = round(float(m["dur"]), 1)
                if m.get("ttft"):
                    msg["ttft"] = round(float(m["ttft"]), 2)
                if m.get("out_tokens"):
                    msg["out_tokens"] = int(m["out_tokens"])
                if m.get("gen_seconds"):
                    # 真正在收字的秒数：前端拿它当 tok/s 的分母，刷新前后数字一致
                    msg["gen_seconds"] = round(float(m["gen_seconds"]), 2)
            if "elapsed" not in msg and cur["last_assistant_ts"] and cur["user_ts"] and cur["last_assistant_ts"] > cur["user_ts"]:
                msg["elapsed"] = round(cur["last_assistant_ts"] - cur["user_ts"], 1)
            out.append(msg)
        cur = None

    for m in rows:
        role = m.get("role")
        ts = float(m.get("timestamp") or 0)

        if role == "user":
            text = _strip_scaffold_envelope(_flatten(m.get("content")))
            # 服务端不存附件：把当初上传的图找回来挂在这条上，刷新后还看得见。
            # 按时间戳就近匹配（提问序号会被上下文压缩改写，见 record_uploads）。
            files = _files_for(uploads, ts)
            # 整条都是机器写的（后台进程通知 / 压缩通知 / 网络中断续写提示…）：不显示成用户气泡。
            # **注意先判再切回合**：以前是 close_turn() 打头、判完再 continue，结果一条真实回复
            # 被这些行切成好几条独立消息，各自带一个复制按钮和工具胶囊（2026-10-20 用户报的
            # 「刷新后一个回复被拆成好几块」）。
            if not files and _is_scaffold_user_row(text):
                continue
            if not text and not files:
                continue
            close_turn()
            msg: dict = {"role": "user", "text": text, "ts": ts}
            if files:
                msg["images"] = [
                    "/api/uploads/%s/%s" % (urllib.parse.quote(session_id), urllib.parse.quote(f))
                    for f in files
                ]
            out.append(msg)
            user_n += 1
            cur = new_turn(ts, user_n - 1)
            continue

        if role == "assistant":
            for c in _parse_tool_calls(m.get("tool_calls")):
                if c["id"]:
                    args_by_id[c["id"]] = c
            reason = str(m.get("reasoning_content") or m.get("reasoning") or "")
            text = _flatten(_display_content(m))
            if cur is None:  # 没有前置提问的助手行（系统起头等）
                cur = new_turn(0.0)
            # 库里有上千条 reasoning 字段"存在但全是空白"（模型那轮没真思考，字段还是写了）。
            # 以前照单全收，界面上就多出一个点开是空框的"思考"行——所以要 strip 后再判。
            if reason.strip():
                add_part({"kind": "reason", "text": reason})
            if text:
                add_part({"kind": "text", "text": text})
            if text:
                cur["msg"]["ts"] = ts
                cur["last_assistant_ts"] = ts
            continue

        if role == "tool":
            if cur is None:
                continue
            call = args_by_id.get(str(m.get("tool_call_id") or ""), {})
            add_part({
                "kind": "tool",
                "name": str(m.get("tool_name") or call.get("name") or "tool"),
                "brief": call.get("brief") or "",
                "args": call.get("args_text") or "",
                "result": _flatten(m.get("content"))[:MAX_RESULT_CHARS],
            })
            continue

    close_turn()

    # 只保留最近 MAX_TOOL_BODIES 个工具的参数/结果（从后往前数），
    # 更早的删掉正文，界面就只显示那一行摘要。一个 500 条消息的会话能省下几 MB。
    seen = 0
    for msg in reversed(out):
        for part in reversed(msg.get("parts", [])):
            if part.get("kind") != "tool":
                continue
            seen += 1
            if seen > MAX_TOOL_BODIES:
                part.pop("args", None)
                part.pop("result", None)

    # 被打断留下的半截：按时间戳对位——只有比库里最后一条消息更新才追加。
    # 用时间戳而不是「最后一条」，跟图片附件、耗时指标同一个教训：序号会漂。
    partial = _load_partial(session_id)
    if partial and partial.get("text"):
        try:
            p_ts = float(partial.get("ts") or 0)
        except (TypeError, ValueError):
            p_ts = 0.0
        last_ts = 0.0
        for m in rows:
            try:
                last_ts = max(last_ts, float(m.get("timestamp") or 0))
            except (TypeError, ValueError):
                continue
        if p_ts > last_ts:
            out.append({
                "role": "assistant",
                "ts": p_ts,
                "parts": [{"kind": "text", "text": str(partial["text"])}],
                "stopped": True,  # 前端认这个字段：标「已被你停止」
            })

    return out


if __name__ == "__main__":
    # 运维入口：回收孤儿上传目录（默认只看不删）
    #   /usr/local/lib/hermes-agent/venv/bin/python sessions.py --gc-uploads
    #   /usr/local/lib/hermes-agent/venv/bin/python sessions.py --gc-uploads --apply
    import argparse

    ap = argparse.ArgumentParser(description="hermes-relay 数据维护")
    ap.add_argument("--gc-uploads", action="store_true", help="回收会话已删的上传目录")
    ap.add_argument("--apply", action="store_true", help="真的删除（不加就是只列清单）")
    ap.add_argument("--prune-metrics", action="store_true", help="删 metrics.json 里已删会话的条目")
    args = ap.parse_args()
    if args.prune_metrics:
        print(json.dumps(prune_metrics(dry_run=not args.apply), ensure_ascii=False, indent=2))
    if args.gc_uploads:
        report = gc_uploads(dry_run=not args.apply)
        print(f"扫描 {report['scanned']} 个目录，保留 {report.get('kept', 0)}，"
              f"{'待删' if not args.apply else '已删'} {len(report['dirs'])} 个，"
              f"共 {report['bytes'] / 1048576:.1f} MB")
        for d in report["dirs"]:
            print(f"  {d['id']}  {d['bytes'] / 1048576:.2f} MB  {d['files']} 个文件  {d['age_days']} 天前")
    if not (args.gc_uploads or args.prune_metrics):
        ap.print_help()
