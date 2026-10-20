"""进程内跑 Hermes agent：直接 import run_agent.AIAgent，不走网关 HTTP。

必须用 Hermes 自带的 Python 启动本服务，才拿得到它的依赖：
    /usr/local/lib/hermes-agent/venv/bin/python server.py

一轮对话 = 一个 Turn：agent 在自己的线程里跑，回调把事件塞进队列，
HTTP 那边把队列内容以 SSE 吐给浏览器。审批（要不要执行某条命令）会
在 agent 线程里阻塞等待，由浏览器 POST 回来解除。
"""
from __future__ import annotations

import base64
import inspect
import json
import mimetypes
import os
import queue
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

# 重启标记：POST /api/admin/restart 会放下它，某一轮答案吐完后我们据此重启自己
RESTART_FLAG = Path.home() / ".hermes/hermes-relay/restart.pending"


def _maybe_restart_service() -> None:
    """一轮答案已经完整发出（eof 之后）时调用：有重启标记就重启服务。

    改完需要重启的后端代码，不必再掐着表算"几分钟后重启"——放下标记即可，
    服务会在下一轮回答结束后（答案已经在浏览器里了）自己起来。
    """
    try:
        if not RESTART_FLAG.exists():
            return
        RESTART_FLAG.unlink()
        subprocess.Popen(
            [
                "systemd-run", "--on-active=3", "--unit=hc-auto-restart", "--collect",
                "systemctl", "restart", "hermes-relay",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass

AGENT_DIR = Path(os.environ.get("HERMES_AGENT_DIR", "/usr/local/lib/hermes-agent")).expanduser()
if AGENT_DIR.is_dir() and str(AGENT_DIR) not in sys.path:
    sys.path.append(str(AGENT_DIR))  # 放最后，别盖掉本目录的同名模块

from run_agent import AIAgent  # noqa: E402
from tools import approval as hermes_approval  # noqa: E402
from tools import clarify_gateway as hermes_clarify  # noqa: E402

try:  # 老版本 Hermes 没这个模块就退回旧行为（危险命令审批静默放行）
    from gateway.session_context import clear_session_vars, set_session_vars
except Exception:  # noqa: BLE001
    set_session_vars = clear_session_vars = None  # type: ignore[assignment]

import sessions  # noqa: E402
import models as relay_models  # noqa: E402  （relay 自己的模型清单：只作用于网页）

MAX_IMAGE_BYTES = 12 * 1024 * 1024
AGENT_SIGNATURE = set(inspect.signature(AIAgent.__init__).parameters)

# 首字响应时间（TTFT）从哪一刻算起：这一轮里第一个"有东西可看"的片段。
# 思考（reasoning）也算——它是最先到屏幕上的内容，正是用户感知的"开始回话了"。
FIRST_EVENT_KINDS = ("delta", "reasoning", "tool_start")

_runtime_cache: dict | None = None


def resolve_runtime() -> dict:
    """按 Hermes 官方的无头路径解析模型和渠道（同一个 oneshot 用的那套）。

    解析结果进程内缓存一次；config.yaml 改了要重启服务。
    """
    global _runtime_cache
    if _runtime_cache is not None:
        return _runtime_cache

    from hermes_cli.config import load_config
    from hermes_cli.runtime_provider import resolve_runtime_provider

    cfg = load_config()
    model, provider, api_key, base_url = "", None, None, None
    try:
        from hermes_cli.oneshot import _resolve_model_and_provider
        choice = _resolve_model_and_provider(cfg, None, None)
        model, provider, api_key, base_url = choice.model, choice.provider, choice.api_key, choice.base_url
    except Exception:
        # 版本变动时的兜底：只从 config.yaml 取默认模型
        model_cfg = cfg.get("model")
        if isinstance(model_cfg, dict):
            model = str(model_cfg.get("default") or model_cfg.get("model") or "")
        elif model_cfg:
            model = str(model_cfg)

    kwargs = {}
    if provider:
        kwargs["requested"] = provider
    if api_key:
        kwargs["explicit_api_key"] = api_key
    if base_url:
        kwargs["explicit_base_url"] = base_url
    rt = resolve_runtime_provider(**kwargs)

    fallback = None
    try:
        from hermes_cli.fallback_config import get_fallback_chain
        fallback = get_fallback_chain(cfg) or None
    except Exception:
        fallback = None

    _runtime_cache = {"model": model, "fallback_model": fallback, **rt}
    return _runtime_cache


_turns: dict[str, "Turn"] = {}
_lock = threading.Lock()
# 跑完的轮次在这里多留一会儿：刚跑完就刷新页面的人还能接上，看到的是完整回放
RECENT_KEEP_S = 120

_recent: "dict[str, tuple[Turn, float]]" = {}

# 每个轮次最多留这么多条事件用来回放（一次长回答能到 4000 条上下，这里留足余量）
LOG_MAX = 20000


def live_turn(session_id: str) -> "Turn | None":
    with _lock:
        return _turns.get(session_id)


def recent_turn(session_id: str) -> "Turn | None":
    """刚跑完、还在保留期内的那一轮（用于刷新后补看）。"""
    with _lock:
        got = _recent.get(session_id)
    if not got:
        return None
    turn, ts = got
    if time.time() - ts > RECENT_KEEP_S:
        with _lock:
            _recent.pop(session_id, None)
        return None
    return turn


def is_live(session_id: str) -> bool:
    return live_turn(session_id) is not None


_cached_tools: list | None = None


def get_cached_tools() -> list | None:
    global _cached_tools
    if _cached_tools:
        return _cached_tools
    with _lock:
        for t, _ in _recent.values():
            if t.agent and getattr(t.agent, "tools", None):
                _cached_tools = t.agent.tools
                return _cached_tools
        for t in _turns.values():
            if t.agent and getattr(t.agent, "tools", None):
                _cached_tools = t.agent.tools
                return _cached_tools
    return None





class Turn:
    def __init__(self, session_id: str, text: str, attachments: list[dict] | None = None,
                 persist_text: str | None = None):
        self.session_id = session_id
        self.text = text
        # 发给模型的和落库的可以不一样（比如 `/技能名` 会被改写成一句提示，
        # 但你库里该存你原本打的那句话）
        self.persist_text = persist_text or text
        self.attachments = attachments or []
        self.agent = None
        # 这一轮里工具跑掉的总秒数：算生成速度时要扣掉，否则 sleep/编译这种等待会把 tok/s 摊薄
        self._tool_seconds = 0.0
        # 真正"在收字"的时长：按每一次 API 调用累加（首字之前、跑工具的等待都不算）。
        # tok/s 的分母用它，分子用这一轮真实的输出 token 数。
        self._gen_windows: list[float] = []
        self._chunk_first: float | None = None
        self._chunk_last: float | None = None
        self.thread: threading.Thread | None = None
        self.finished = threading.Event()
        # 事件回放：每条带自增 seq。谁都能从任意位置接上，
        # 所以"刷新页面 = 重新订阅"，而不是把已经生成的内容丢掉。
        self.seq = 0
        self.log: list[dict] = []
        self.dropped = 0  # 因为太长被丢掉的最大 seq
        self._subs: list[queue.Queue] = []
        self._subs_lock = threading.Lock()
        # 首字响应时间：起点是这一轮建起来的时刻（≈ 服务端收到你的发送），
        # 终点是第一个片段到达回调。实测值随渠道和思考长度波动，落库供以后看趋势。
        self.t_start = time.time()
        self.ttft: float | None = None

    # ── 事件出口 ──────────────────────────────────────────────
    def emit(self, **ev) -> None:
        if self.ttft is None and ev.get("type") in FIRST_EVENT_KINDS:
            self.ttft = round(time.time() - self.t_start, 2)
        with self._subs_lock:
            self.seq += 1
            ev["seq"] = self.seq
            self.log.append(ev)
            if len(self.log) > LOG_MAX:
                self.dropped = self.log.pop(0)["seq"]
            subs = list(self._subs)
        for q in subs:
            q.put(ev)

    def subscribe(self, after: int = 0) -> tuple[queue.Queue | None, list[dict], bool]:
        """接上一个正在跑的轮次。

        返回（这条连接的队列, 要补发的事件, 是否因为太长丢过内容）。
        已经跑完的轮次只回放、不给队列（队列返回 None，读完回放就该收尾）。
        """
        with self._subs_lock:
            replay = [e for e in self.log if e["seq"] > after]
            truncated = bool(self.dropped and after < self.dropped)
            if self.finished.is_set():
                return None, replay, truncated
            q: queue.Queue = queue.Queue()
            self._subs.append(q)
            return q, replay, truncated

    def unsubscribe(self, q: queue.Queue | None) -> None:
        if q is None:
            return
        with self._subs_lock:
            if q in self._subs:
                self._subs.remove(q)

    def _done(self, **extra) -> None:
        self.emit(type="done", **extra)
        self.finished.set()

    # ── agent 回调 ────────────────────────────────────────────
    # 速度口径（跟 vLLM 的 TPOT 一个意思）：
    #   一次 API 调用 = 一段「窗口」，从这次调用的第一个字到最后一个字。
    #   窗口里除首字之前的等待（TTFT）和两次调用之间跑工具的时间都**不算分母**，
    #   分母 = 各段窗口之和；分子 = 这一轮真实输出 token 数。
    #   旧做法是「隔超过 1 秒就断开另算一段」，那是个猜：模型正常停顿一下就被切掉，
    #   分母变小、速度虚高，而且同一轮刷新前后还会给出两个数。
    def _track_chunk(self) -> None:
        """收到一个流式片段：记下这一段的起点和最新的终点。"""
        now = time.time()
        if self._chunk_first is None:
            self._chunk_first = self._chunk_last = now
        else:
            self._chunk_last = now

    def _close_window(self) -> None:
        """一次调用结束（要跑工具了 / 整轮结束）：把这一段收进分母。可重复调用，第二次是空操作。"""
        if self._chunk_first is not None and self._chunk_last is not None:
            self._gen_windows.append(self._chunk_last - self._chunk_first)
        self._chunk_first = self._chunk_last = None

    def _finish_gen_seconds(self) -> float:
        """收尾：把最后一段补上，返回整轮「真正在出字」的秒数。"""
        self._close_window()
        return sum(self._gen_windows)

    def _on_delta(self, chunk, *a, **kw):
        if chunk:
            self._track_chunk()
            self.emit(type="delta", text=chunk if isinstance(chunk, str) else str(chunk))

    def _on_reasoning(self, chunk, *a, **kw):
        if chunk:
            self._track_chunk()
            self.emit(type="reasoning", text=chunk if isinstance(chunk, str) else str(chunk))

    def _on_tool(self, phase=None, name=None, brief=None, args=None, *_a, **kw):
        """tool_progress_callback 的真实签名：

            (phase, name, brief, args, duration=..., is_error=..., result=...)

        phase: tool.started / tool.completed / reasoning.available
        —— 别按位置猜第一个参数是工具名，那是阶段名。
        """
        if phase == "tool.started":
            # 这次调用的字出完了，接下来是跑工具：把这一段的窗口收掉（工具时间不进分母）
            self._close_window()
            try:
                args_text = (json.dumps(args, ensure_ascii=False, indent=2)
                             if isinstance(args, (dict, list)) else str(args or ""))
            except Exception:
                args_text = ""
            self.emit(type="tool_start", name=str(name or "tool"),
                      brief=str(brief or "")[:200], args=args_text[:2000])
        elif phase == "tool.completed":
            self._close_window()  # 兜底：万一没有 tool.started
            err = kw.get("is_error")
            result = kw.get("result")
            try:
                self._tool_seconds += float(kw.get("duration") or 0)
            except (TypeError, ValueError):
                pass
            self.emit(type="tool_end", name=str(name or "tool"),
                      ok=(not err) if err is not None else None,
                      result=(str(result)[:1500] if result is not None else ""))
        # reasoning.available 不进工具行

    def _on_status(self, kind, message=None):
        self.emit(type="status", kind=str(kind), text=str(message or ""))

    def _on_approval(self, data: dict) -> None:
        """agent 线程调这个，然后阻塞等 resolve_gateway_approval。必须立刻返回。

        一并带上 Hermes 自己的审批时限（`approvals.timeout`，默认 300 秒）和绝对到期时刻：
        浏览器据此倒计时，刷新页面、事件补发之后也算得准。
        """
        timeout = 300
        try:
            from tools.approval_context import _get_approval_timeout

            timeout = int(_get_approval_timeout())
        except Exception:
            pass
        self.emit(
            type="approval",
            request_id=data.get("request_id"),
            command=data.get("command") or "",
            description=data.get("description") or "",
            timeout_sec=timeout,
            deadline=time.time() + timeout,
        )

    def _on_clarify(self, question=None, choices=None, multi_select=False, questions=None) -> str | None:
        """agent 线程调这个，然后阻塞等浏览器点答案（Hermes 原生的 clarify 闸门）。

        用的是 `tools.clarify_gateway`：register 挂一个待答项 → 等浏览器 POST 回来
        （resolve_gateway_clarify）→ 拿回字符串。整套跟审批（approval）同源，不是自造的。
        单个问题返回答案字符串；`questions=[...]` 批量时按工具侧契约返回
        `{"answers": {qid: 答案}}` 的 JSON（见 tools/clarify_tool._run_batch）。
        """
        items: list[dict] = []
        if questions:
            for e in questions:
                items.append({
                    "qid": str(e.get("qid") or f"q{len(items)}"),
                    "question": str(e.get("question") or ""),
                    "choices": list(e.get("choices") or []) or None,
                    "multi_select": bool(e.get("multi_select")),
                })
        else:
            items.append({
                "qid": "q0",
                "question": str(question or ""),
                "choices": list(choices) if choices else None,
                "multi_select": bool(multi_select) and bool(choices),
            })
        batch = bool(questions)
        cid = uuid.uuid4().hex[:10]
        timeout = hermes_clarify.get_clarify_timeout()
        # 注册成开放式（choices=None）：答案由界面按 id 提交，不靠文本去猜选项。
        hermes_clarify.register(cid, self.session_id, items[0]["question"], None)
        self.emit(type="clarify", clarify_id=cid, questions=items,
                  batch=batch, timeout_seconds=timeout)
        try:
            raw = hermes_clarify.wait_for_response(cid, timeout)
        finally:
            # 答完（或被停/超时）补一条结束事件：刷新页面回放事件流时，
            # 这条能让界面把卡片收掉，而不是把已经答过的卡片又摆出来。
            self.emit(type="clarify_end", clarify_id=cid)
        if raw is None:  # 超时，或者这一轮被停了
            return None
        if not batch:
            return raw
        try:
            answers = {str(k): v for k, v in dict(json.loads(raw).get("answers") or {}).items()}
        except Exception:
            answers = {items[0]["qid"]: raw}  # 用户直接把答案打回来的：算第一个问题的答案
        return json.dumps({"answers": answers}, ensure_ascii=False)

    # ── 组装消息 ──────────────────────────────────────────────
    def _build_message(self):
        """有图就拼成原生多模态（data URL），没图就是纯文本。"""
        parts = [{"type": "text", "text": self.text}]
        images = 0
        for att in self.attachments:
            raw = str(att.get("path") or "")
            if not raw:
                continue
            p = Path(raw).expanduser()
            try:
                if not p.is_file() or p.stat().st_size > MAX_IMAGE_BYTES:
                    continue
                mime = att.get("mime") or mimetypes.guess_type(p.name)[0] or ""
                if not mime.startswith("image/"):
                    continue
                data = base64.b64encode(p.read_bytes()).decode("ascii")
            except OSError:
                continue
            parts.append({"type": "image_url", "image_url": {"url": f"data:{mime};base64,{data}"}})
            images += 1
        return parts if images else self.text

    def _agent_kwargs(self) -> dict:
        rt = resolve_runtime()
        # 页面上选的模型 / 思考强度（models.json）。只覆盖这一轮构造出来的 agent，
        # 不动 Hermes 的全局配置，也不影响命令行 / 桌面端 / 微信那几个入口。
        # 每轮都重新读一次，所以页面上改完**下一轮就生效**，不用重启服务。
        sel = relay_models.active_runtime()
        picked = bool(sel.get("provider"))

        def _f(field: str):
            """页面选了模型时，只用页面上那份配置（缺就是缺）——不能回落默认渠道，
            否则会把默认渠道的 base_url / api_mode 混到另一个渠道上。"""
            return sel.get(field) if picked else rt.get(field)

        kwargs = {
            "model": sel.get("model") or rt.get("model") or "",
            "provider": sel.get("provider") or rt.get("provider"),
            "requested_provider": sel.get("requested_provider") or rt.get("requested_provider"),
            "base_url": _f("base_url"),
            "api_key": _f("api_key"),
            "api_mode": _f("api_mode"),
            "acp_command": rt.get("command"),
            "acp_args": rt.get("args"),
            # 页面上另选了渠道时，凭据池交给 Hermes 按新渠道自己解析
            "credential_pool": None if picked else rt.get("credential_pool"),
            "fallback_model": rt.get("fallback_model"),
            # 五档强度：空值就让 Hermes 按自己配置解析（{"enabled":…, "effort":…}）
            "reasoning_config": sel.get("reasoning_config"),
            "quiet_mode": True,
            "session_id": self.session_id,
            "gateway_session_key": self.session_id,
            "platform": "webui",
            "user_id": "owner",
            "user_name": "owner",
            "chat_id": self.session_id,
            "chat_type": "dm",
            "session_db": sessions.db(),
            "load_soul_identity": True,
            "stream_delta_callback": self._on_delta,
            "reasoning_callback": self._on_reasoning,
            # 只挂 tool_progress_callback：它同时带上工具名、摘要、是否出错、耗时。
            # tool_start_callback/tool_complete_callback 会和它重复触发，别一起挂。
            "tool_progress_callback": self._on_tool,
            "status_callback": self._on_status,
            # 模型反过来问用户（clarify 工具）：跟审批一样在 agent 线程里阻塞等浏览器答复
            "clarify_callback": self._on_clarify,
        }
        # 版本不同参数会变，没这个参数就丢掉，别炸
        return {k: v for k, v in kwargs.items() if k in AGENT_SIGNATURE}

    # ── 主流程 ────────────────────────────────────────────────
    def run(self) -> None:
        sid = self.session_id
        try:
            history = sessions.history(sid)
        except Exception as exc:  # 读历史失败不该让整轮挂掉
            history = []
            self.emit(type="status", kind="warn", text=f"读取历史失败：{exc}")
        # 上一轮被中止时库里会留下一条没有回复的 user，补占位闭合（见函数注释）
        history = close_dangling_user_turn(history)

        hermes_approval.register_gateway_notify(sid, self._on_approval)
        # 把自己标成"能回答审批的前端会话"。不绑的话 Hermes 的 _is_gateway_approval_context()
        # 是 False，危险命令会走"无人值守"分支被静默放行——卡片永远不会弹给用户。
        session_tokens = None
        if set_session_vars is not None:
            try:
                session_tokens = set_session_vars(
                    platform="webui", source="webui", session_key=sid, session_id=sid,
                    chat_id=sid, chat_type="dm", user_id="owner", user_name="owner",
                    async_delivery=False,
                )
            except Exception:
                session_tokens = None
        try:
            agent = AIAgent(**self._agent_kwargs())
            self.agent = agent
            global _cached_tools
            if getattr(agent, "tools", None):
                _cached_tools = agent.tools
            with _lock:
                _turns[sid] = self
            result = agent.run_conversation(
                user_message=self._build_message(),
                conversation_history=history or None,
                task_id=sid,
                persist_user_message=self.persist_text,
            )
            usage = {}
            if isinstance(result, dict):
                for k in ("input_tokens", "output_tokens", "total_tokens", "model", "provider"):
                    if result.get(k) is not None:
                        usage[k] = result[k]
            # Hermes 把「这一轮」的 token 计数留在 agent 实例的内存里（session_* 计数器），
            # 实例销毁就没了；而 relay 每轮新建一个实例，所以趁现在读出来。
            # 命令行状态栏那个命中率就是拿这几个数算的，记下来面板才跟它同一个口径。
            cache_stats: dict = {}
            for _attr, _key in (
                ("session_cache_read_tokens", "cache_read"),
                ("session_cache_write_tokens", "cache_write"),
                ("session_prompt_tokens", "prompt_total"),
                ("session_api_calls", "api_calls"),
            ):
                _val = getattr(agent, _attr, None)
                if isinstance(_val, int):
                    cache_stats[_key] = _val
            _model = getattr(agent, "model", "")
            if _model:
                cache_stats["model"] = str(_model)
            # 正常跑完才记指标：被打断的那半截不进历史，数据也不该跟着进。
            # 用时和首字都从同一刻（服务端收到这一轮）算起，否则会出现"首字比用时还长"的怪数。
            elapsed = time.time() - self.t_start
            # 生成速度（tok/s）的分母 = 真正在收字的时长（见 _track_chunk）：
            # 首字之前的排队/思考前等待、两次调用之间跑工具的时间都不计。
            # 算在前头：这个数要跟指标一起落库，刷新页面后才能给出跟当时一致的速度。
            gen_seconds = None
            if usage.get("output_tokens"):
                gen_seconds = round(max(self._finish_gen_seconds(), 0.3), 2)
            if self.ttft is not None:
                try:
                    sessions.record_ttft(sid, self.ttft, dur=elapsed,
                                         out_tokens=usage.get("output_tokens"),
                                         gen_seconds=gen_seconds,
                                         cache=cache_stats)
                except Exception:
                    pass
            try:
                sessions.clear_partial(sid)  # 正常跑完：库里已有完整回复，半截记录没用了
            except Exception:
                pass
            self._done(usage=usage, ttft=self.ttft,
                       out_tokens=usage.get("output_tokens"), gen_seconds=gen_seconds)
        except Exception as exc:  # noqa: BLE001 — 任何异常都要让前端看到
            import traceback
            self.emit(type="error", message=f"{type(exc).__name__}: {exc}",
                      detail=traceback.format_exc()[-2000:])
            self._done(usage={}, ttft=self.ttft)
        finally:
            hermes_approval.unregister_gateway_notify(sid)
            if session_tokens is not None:
                try:
                    clear_session_vars(session_tokens)
                except Exception:
                    pass
            # 这一轮结束了（含被打断/异常）：把还挂着的 clarify 解开，别让 agent 线程干等
            hermes_clarify.clear_session(sid)
            with _lock:
                if _turns.get(sid) is self:
                    _turns.pop(sid, None)
                _recent[sid] = (self, time.time())  # 留一会儿，方便刚刷新的人接上
            self.emit(type="eof")
            # 答案已经完整发给浏览器了：如果之前有人要求重启服务，现在正是时候。
            _maybe_restart_service()

    def start(self) -> None:
        self.thread = threading.Thread(target=self.run, name=f"turn-{self.session_id}", daemon=True)
        self.thread.start()

    def interrupt(self) -> bool:
        # 有 clarify 挂着时（agent 线程正在等用户回答），停止必须把它解开，
        # 否则那一轮会一直卡到 clarify 超时（默认 1 小时）才动。
        hermes_clarify.clear_session(self.session_id)
        if self.agent is not None:
            try:
                self.agent.interrupt("Cancelled by user")
                self._keep_partial()
                return True
            except Exception:
                return False
        return False

    def _keep_partial(self) -> None:
        """被打断：把这一轮已经吐出来的正文落盘，刷新页面还能看到半截。

        从事件日志里捞 delta（正文增量）；思考片段不算——用户要的是「回答」那半截。
        """
        try:
            text = "".join(
                str(e.get("text") or "") for e in list(self.log) if e.get("type") == "delta"
            ).strip()
            if text:
                sessions.save_partial(self.session_id, text, self.t_start)
        except Exception:
            pass

    def steer(self, text: str) -> bool:
        """生成中插一句话（Hermes 原生的 busy steer），不打断这一轮。

        agent.steer() 是线程安全的：文字先攒在 agent 的 pending 槽里，
        等这一批工具调用跑完，附到最后一条工具结果后面（带 OUT-OF-BAND 标记），
        模型下一轮迭代就看到。注意这轮如果没调工具，它会一直等到下一次工具批次。
        """
        agent = self.agent
        if agent is None or not hasattr(agent, "steer"):
            return False
        try:
            return bool(agent.steer(text))
        except Exception:
            return False


DANGLING_USER_NOTE = "（上一轮被用户中止，未生成回复。）"


def close_dangling_user_turn(history: list[dict] | None) -> list[dict] | None:
    """库里最后一条是「没有回复的 user」时，补一条 assistant 占位把历史闭合。

    这种形状只在上一轮被中止 / 异常结束时出现：Hermes 先把 user 消息落库，
    回复要等这一轮跑完才落，被打断就没有对应 assistant。下一轮读出来的历史就是
    「…, user(作废), user(新)」——Hermes 原生只对尾部是 tool 的情形补占位
    （message_sanitization.close_interrupted_tool_sequence），相邻两条 user 它会在
    发送前合并成一条（agent_runtime_helpers._merge_consecutive_users），于是模型
    把作废的那条和新消息一起回答。

    这里补的是 assistant 而不是删消息：用户看得到自己发过什么，历史又不再悬空，
    新消息只答它自己。只改内存里这一份，不写库（库里保持原样，幂等）。
    """
    if not history:
        return history
    last = history[-1]
    if isinstance(last, dict) and last.get("role") == "user":
        return list(history) + [{"role": "assistant", "content": DANGLING_USER_NOTE}]
    return history


def _warmup_tools():
    global _cached_tools
    try:
        if _cached_tools is None:
            t = Turn("__warmup__", "")
            agent = AIAgent(**t._agent_kwargs())
            if getattr(agent, "tools", None):
                _cached_tools = agent.tools
    except Exception:
        pass


threading.Thread(target=_warmup_tools, daemon=True, name="hermes-tools-warmup").start()


def start_turn(session_id: str, text: str, attachments: list[dict] | None = None,
               persist_text: str | None = None) -> Turn:
    """开一轮。**检查和登记必须在同一把锁里**：

    run() 要等读历史、注册审批通知、构造 AIAgent（实测几百毫秒到几秒）之后才把自己写进
    _turns（见 run 里的 451 行）。以前只查一次 live_turn 就放行，第二次请求在这段窗口里
    查到的还是"没人跑" —— 于是同一条消息真的发两遍（库里两条 user 行、模型答两次）。
    2026-10-13 修：先占位再启动线程，run() 里那次登记写的还是自己，重复赋值无害。
    """
    with _lock:
        if _turns.get(session_id):
            raise RuntimeError("这个会话还有一轮在跑")
        t = Turn(session_id, text, attachments, persist_text=persist_text)
        _turns[session_id] = t
    try:
        t.start()
    except Exception:
        with _lock:
            if _turns.get(session_id) is t:
                _turns.pop(session_id, None)
        raise
    return t


def steer_turn(session_id: str, text: str) -> bool:
    """给正在跑的那一轮插一句话；返回 False 表示没在跑（或 agent 不收）。

    前端拿到 False 就该退回去走普通发送，别把用户打的字弄丢。
    """
    turn = live_turn(session_id)
    if turn is None:
        return False
    return turn.steer(text)


def resolve_approval(session_id: str, choice: str, request_id: str | None = None) -> int:
    """浏览器点了允许/拒绝，解除 agent 线程的阻塞。choice: once/session/always/deny"""
    if choice not in ("once", "session", "always", "deny"):
        raise ValueError(f"unknown choice: {choice}")
    return hermes_approval.resolve_gateway_approval(session_id, choice, request_id=request_id)


def resolve_clarify(session_id: str, clarify_id: str, response: str) -> bool:
    """浏览器点了/填了答案：解除 agent 线程在 clarify 上的阻塞。

    就是 Hermes 原生的 `tools.clarify_gateway.resolve_gateway_clarify`——
    和我们自己维护的队列无关，全部状态都在原生模块里。
    单个问题的 response 就是答案原文；批量问题时是 `{"answers": {qid: 答案}}` 的 JSON 串。
    """
    if not clarify_id:
        return False
    return bool(hermes_clarify.resolve_gateway_clarify(str(clarify_id), "" if response is None else str(response)))


def new_session_id() -> str:
    return uuid.uuid4().hex[:12]
