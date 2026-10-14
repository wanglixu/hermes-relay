"""会话上下文压缩 —— 等价于 CLI 里的 `/compress`。

底层就是 Hermes 自己的 compress_context()，需要一个活着的 AIAgent 实例，
所以这里照 agent_bridge 起 agent 的那套参数临时造一个，只做压缩、不跑对话。
压缩会写 state.db（把历史切成"摘要 + 保留的尾巴"），失败时库里保持原样。

**同步执行**：调用方（HTTP 请求）会一直等到压完（30~60 秒）。
nginx 那边 proxy_read_timeout 是 3600s，挂得住。前端在此期间把用户新发的消息排队。

压完会在 compactions.json 里记一笔（这个会话几点压的、压前压后多少条），
sessions.display_messages() 会把它挂回对应回合，界面上就能在"用时 …"下面看到压缩成果。
"""
from __future__ import annotations

import json
import threading
import time
from pathlib import Path

METRICS_DIR = Path.home() / ".hermes" / "hermes-relay"
COMPACTIONS_FILE = METRICS_DIR / "compactions.json"

# 同步执行期间用锁挡住并发（同一个会话不可能同时在压，跨会话也串行，反正就几十秒）
_lock = threading.Lock()


def _load() -> dict:
    try:
        data = json.loads(COMPACTIONS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def records(session_id: str) -> list[dict]:
    """这个会话的历史压缩记录，按时间正序。"""
    rows = _load().get(session_id) or []
    return [r for r in rows if isinstance(r, dict)]


def _append(session_id: str, row: dict) -> None:
    data = _load()
    rows = [r for r in (data.get(session_id) or []) if isinstance(r, dict)]
    rows.append(row)
    data[session_id] = rows[-50:]
    METRICS_DIR.mkdir(parents=True, exist_ok=True)
    tmp = COMPACTIONS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    tmp.replace(COMPACTIONS_FILE)


def is_busy() -> bool:
    """正在压缩吗（同步执行期间锁是持着的）。前端排队之外，后端也拿它挡一下。"""
    return _lock.locked()


def run(session_id: str, focus: str | None = None) -> dict:
    """同步压缩（会阻塞到这个会话压完）。返回 {ok, before, after, seconds, error?}。"""
    with _lock:
        started = time.time()
        try:
            import agent_bridge
            import context as chat_context
            import sessions
            from agent.conversation_compression import compress_context
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "seconds": round(time.time() - started, 1),
                    "error": f"依赖加载失败：{exc}"}

        try:
            history = sessions.history(session_id)
            before = len(history)
            if before < 4:
                return {"ok": False, "before": before, "after": before, "seconds": 0,
                        "error": "消息太少（不到 4 条），没什么可压的"}

            # 压前压后各量一次上下文占用（估算值），界面上显示成 "263k → 41k"
            try:
                before_tokens = chat_context.context_stats(session_id).get("used")
            except Exception:
                before_tokens = None

            turn = agent_bridge.Turn(session_id, "")  # 只为拿到与正常一轮一致的 agent 参数
            agent = agent_bridge.AIAgent(**turn._agent_kwargs())
            system_prompt = getattr(agent, "_cached_system_prompt", "") or ""
            messages, _ = compress_context(
                agent, history, system_prompt, task_id=session_id, force=True, focus_topic=focus,
            )
            after = len(messages)
            seconds = round(time.time() - started, 1)
            try:
                after_tokens = chat_context.context_stats(session_id).get("used")
            except Exception:
                after_tokens = None
            row = {
                "at": time.time(), "before": before, "after": after, "seconds": seconds,
                "before_tokens": before_tokens, "after_tokens": after_tokens,
            }
            try:
                _append(session_id, row)
            except Exception:
                pass  # 记账失败不该让压缩本身算失败
            return {"ok": True, "before": before, "after": after, "seconds": seconds}
        except Exception as exc:  # noqa: BLE001 — 失败原因要原样带回前端
            import traceback
            traceback.print_exc()
            return {"ok": False, "seconds": round(time.time() - started, 1),
                    "error": f"{type(exc).__name__}: {exc}"}
