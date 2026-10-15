"""会话上下文压缩 —— 等价于 CLI 里的 `/compress`。

**这里没有任何自己的压缩算法**：流程逐条对齐 Hermes 官方的 `/compress` 实现
（gateway/slash_commands_session.py 的 `_run_manual_compression`），
量法、判定、文案、拒压处理全部调官方函数。relay 只做两件官方在 gateway 里也要做的事：
造一个一次性 AIAgent（官方 `_build_manual_compression_agent` 同样这么造），
以及把结果记进 compactions.json 好让界面显示。

调用的官方件及其作用：

- `AIAgent._compress_context()`（agent/compression_facade.py）—— 压缩本身。
  等价于 CLI 的 /compress，会写 state.db（把历史切成"摘要 + 保留的尾巴"）。
- `estimate_request_tokens_rough()`（agent/model_metadata.py）—— 压前压后各量一次，
  含系统提示词与工具定义，与 CLI `/compress` 显示的数字同源。
- `summarize_manual_compression()`（agent/manual_compression_feedback.py）—— 官方判定：
  refused_would_grow（摘要比原文长，Hermes 原地放弃、一条不删）、aborted（摘要生成失败）、
  fallback_used（降级上下文硬压）、noop（没有变化）。界面文案在 relay 这层翻成中文，
  判据和数值仍是官方的。
- `describe_compression_lock_skip()` —— 会话压缩锁被别的压缩占着时的官方说法。
- `compressor.has_content_to_compress()` —— 官方"没什么可压的"前置检查。

自己另拼口径会得到「69k → 244k 越压越大」这种假象：压前读 Hermes 的 _usage_anchor（实测），
压后锚点被 Hermes 清掉、退回文本估算 —— 两把尺子拼在一起就没法比了。

**同步执行**：调用方（HTTP 请求）会一直等到压完（30~60 秒）。
nginx 那边 proxy_read_timeout 是 3600s，挂得住。前端在此期间把用户新发的消息排队。
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

# 官方 summarize_manual_compression 给出的四种情形（键名与它返回的一致）
FLAGS = ("refused_would_grow", "aborted", "fallback_used", "noop")


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


def _fail(started: float, error: str, **extra) -> dict:
    out = {"ok": False, "seconds": round(time.time() - started, 1), "error": error}
    out.update(extra)
    return out


def run(session_id: str, focus: str | None = None) -> dict:
    """同步压缩这个会话（会阻塞到压完）。流程同官方 `/compress`。

    返回 {ok, before, after, seconds, before_tokens, after_tokens} +
    官方四种情形标志；失败时带 error。
    """
    with _lock:
        started = time.time()
        try:
            import agent_bridge
            import sessions
            from agent.conversation_compression import finalize_context_engine_compression_notification
            from agent.manual_compression_feedback import (describe_compression_lock_skip,
                                                           summarize_manual_compression)
            from agent.model_metadata import estimate_request_tokens_rough
        except Exception as exc:  # noqa: BLE001
            return _fail(started, f"依赖加载失败：{exc}")

        try:
            history = sessions.history(session_id)
            # 官方只压 user/assistant/tool 三种角色（user/assistant-only 会让工具结果清理挨饿）
            msgs = [m for m in history if isinstance(m, dict) and m.get("role") in {"user", "assistant", "tool"}]
            if not msgs:
                return _fail(started, "这个会话还没有可压缩的消息")

            turn = agent_bridge.Turn(session_id, "")  # 只为拿到与正常一轮一致的 agent 参数
            agent = agent_bridge.AIAgent(**turn._agent_kwargs())

            # 官方注释：必须在 agent 造好之后量，_cached_system_prompt / tools 这时才填好
            sys_prompt = getattr(agent, "_cached_system_prompt", "") or ""
            tools = getattr(agent, "tools", None) or None
            appr_tokens = estimate_request_tokens_rough(msgs, system_prompt=sys_prompt, tools=tools)

            compressor = getattr(agent, "context_compressor", None)
            if compressor is not None and not compressor.has_content_to_compress(msgs):
                return _fail(started, "没什么可压的（history 太短或已被压过）")

            before = len(msgs)
            try:
                # 用 agent 上的官方方法（官方 /compress 也是这么调），approx_tokens 必须带上：
                # Hermes 靠它判断摘要是不是反而比原文长（refused_would_grow）。
                compressed, _ = agent._compress_context(
                    msgs, "", approx_tokens=appr_tokens, focus_topic=focus, force=True,
                    defer_context_engine_notification=True,
                )
            finally:
                # 官方在 finally 里收尾，未提交时的通知不能漏
                try:
                    finalize_context_engine_compression_notification(agent, committed=True)
                except Exception:
                    pass

            # 官方：压缩锁被别的压缩占着时返回原样，要如实说，不能报成"没压动"
            skipped = getattr(agent, "_compression_skipped_due_to_lock", None)
            if skipped is True or isinstance(skipped, str):
                # 用官方 describe_compression_lock_skip 判"确实有人在压"还是"锁拿不到"，文案走中文
                official = describe_compression_lock_skip(skipped)
                who = skipped if isinstance(skipped, str) and skipped.strip() else ""
                msg = (f"另一个压缩正在进行（占用者：{who}），等它结束再试"
                       if who else "这样本会话的压缩锁没能拿到，可能还有别的压缩在跑，稍后再试")
                return _fail(started, msg, lock_skipped=True, official_message=official)

            seconds = round(time.time() - started, 1)
            after = len(compressed)
            after_tokens = estimate_request_tokens_rough(compressed, system_prompt=sys_prompt, tools=tools)
            summary = summarize_manual_compression(
                msgs, compressed, appr_tokens, after_tokens, compression_state=compressor,
            )

            row = {
                "at": time.time(), "before": before, "after": after, "seconds": seconds,
                "before_tokens": appr_tokens, "after_tokens": after_tokens,
                # 官方四种判定（老记录里没有这些键，前端按条数自己推断）
                **{name: bool(summary.get(name)) for name in FLAGS},
                # 官方文案原样留档：想对照 CLI 输出或切英文界面时不用重算
                "headline": summary.get("headline"),
                "token_line": summary.get("token_line"),
                "note": summary.get("note"),
            }
            try:
                _append(session_id, row)
            except Exception:
                pass  # 记账失败不该让压缩本身算失败
            result = {"ok": True, "before": before, "after": after, "seconds": seconds,
                      "before_tokens": appr_tokens, "after_tokens": after_tokens}
            result.update({name: row[name] for name in FLAGS})
            return result
        except Exception as exc:  # noqa: BLE001 — 失败原因要原样带回前端
            import traceback
            traceback.print_exc()
            return _fail(started, f"{type(exc).__name__}: {exc}")
