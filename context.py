"""上下文用量 + 技能清单。

上下文用量：优先调用 Hermes 原生计数函数，校验保存的用量记录是否仍匹配当前历史，
计入回复用量与后续新增消息估算；记录缺失或失效时退回消息估算。
缓存命中和调用次数另读库里的累计值（只算主对话、只算当前模型），不作为当前上下文大小。

技能清单：直接扫 ~/.hermes/skills 下的 SKILL.md 头部的 name/description，
给输入框里的 `/` 菜单用。
"""
from __future__ import annotations

import datetime
import json
import os
import re
import sqlite3
import time
from pathlib import Path

_skills_cache: tuple[float, list[dict]] | None = None

HERMES_HOME = Path(os.environ.get("HERMES_HOME", "~/.hermes")).expanduser()
SKILLS_DIR = HERMES_HOME / "skills"
USAGE_FILE = SKILLS_DIR / ".usage.json"  # Hermes 记的技能使用台账（最近用过的时间）
CONFIG_FILE = HERMES_HOME / "config.yaml"
STATE_DB = Path(os.environ.get("HERMES_STATE_DB", str(HERMES_HOME / "state.db"))).expanduser()


# ── 技能 ────────────────────────────────────────────────────
def _frontmatter(text: str) -> tuple[str, str]:
    if not text.lstrip().startswith("---"):
        return "", ""
    body = text.lstrip()[3:]
    end = body.find("\n---")
    block = body[:end] if end > 0 else body[:2000]
    name = desc = ""
    for line in block.splitlines():
        if line.startswith("name:") and not name:
            name = line[5:].strip().strip("\"'")
        elif line.startswith("description:") and not desc:
            desc = line[12:].strip().strip("\"'")
    return name, desc


def list_skills() -> list[dict]:
    """扫本机技能目录，按名字去重。只取常见的一两层目录，插件里的深层技能不管。

    扫一次要读 160 多个文件，进程内缓存一小会儿（改完技能一般也会重开界面）。
    """
    global _skills_cache
    now = time.time()
    if _skills_cache and now - _skills_cache[0] < 30:
        return _skills_cache[1]
    out: list[dict] = []
    seen: set[str] = set()
    usage = _skill_usage()
    if not SKILLS_DIR.is_dir():
        return []
    for path in sorted(SKILLS_DIR.glob("**/SKILL.md")):
        rel = path.relative_to(SKILLS_DIR)
        # 排除第三方依赖包或隐藏目录，但允许正常子分类目录（如 mlops/inference/）
        if "node_modules" in rel.parts or any(p.startswith(".") for p in rel.parts):
            continue
        try:
            head = path.read_text(encoding="utf-8", errors="replace")[:5000]
        except OSError:
            continue
        name, desc = _frontmatter(head)
        name = name or path.parent.name
        if not name or name in seen:
            continue
        seen.add(name)
        out.append({
            "name": name,
            # 描述的第一句就够菜单用；整段太长了
            "description": re.split(r"(?<=[。.;])\s", desc)[0][:160] if desc else "",
            "category": rel.parts[0] if len(rel.parts) > 2 else "",
            "path": str(path),
            # 最近使用时间（Hermes 记的台账），菜单按它排序
            "last_used": usage.get(name),
        })
    out.sort(key=lambda s: s["name"])
    _skills_cache = (now, out)
    return out


def _skill_usage() -> dict[str, float]:
    """Hermes 自己维护的技能使用台账（skills/.usage.json）：技能名 → 最近使用时间戳（秒）。

    这个文件由 Hermes 在真正加载/复用技能时更新，所以它既是"最近用过"的排序依据，
    也能反过来当证据：网页里点名一个技能后，这里的时间有没有跟着更新，就知道模型
    到底有没有去读那个技能文件。
    """
    try:
        raw = json.loads(USAGE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}
    out: dict[str, float] = {}
    for name, rec in (raw.items() if isinstance(raw, dict) else []):
        if not isinstance(rec, dict):
            continue
        for key in ("last_used_at", "last_activity_at", "last_viewed_at"):
            value = rec.get(key)
            if not value:
                continue
            try:
                out[name] = datetime.datetime.fromisoformat(
                    str(value).replace("Z", "+00:00")
                ).timestamp()
            except (TypeError, ValueError):
                pass
            break
    return out


def skill_by_name(name: str) -> dict | None:
    for s in list_skills():
        if s["name"] == name:
            return s
    return None


# 技能正文多大才值得整段塞给模型。中位数才 7KB，整段注入既保证"选了就真按它走"，
# 成本也就 1k tokens 上下；超过这个数（本机只有 6 个）就退回让模型自己去读。
SKILL_INLINE_LIMIT = 20 * 1024


def skill_body(skill: dict, limit: int = SKILL_INLINE_LIMIT) -> str | None:
    """读技能正文（剥掉开头的 YAML frontmatter）。超过 limit 就返回 None。"""
    try:
        raw = Path(skill["path"]).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    if len(raw.encode("utf-8")) > limit:
        return None
    if raw.startswith("---"):
        end = raw.find("\n---", 3)
        if end != -1:
            raw = raw[end + 4:]
    body = raw.strip()
    return body or None


# ── 子代理（delegate_task 派出去的那些） ─────────────────────
def delegations(session_ids: list[str], limit_per_session: int = 20) -> dict[str, list[dict]]:
    """每个会话发起过的子代理。Hermes 自己写在 async_delegations 里，直接读就行。"""
    if not session_ids:
        return {}
    out: dict[str, list[dict]] = {}
    try:
        conn = _state()
        marks = ",".join("?" * len(session_ids))
        rows = conn.execute(
            "select origin_session, delegation_id, state, dispatched_at, completed_at, task_json "
            f"from async_delegations where origin_session in ({marks}) order by dispatched_at desc",
            session_ids,
        ).fetchall()
        conn.close()
    except Exception:
        return {}
    for r in rows:
        sid = r["origin_session"]
        if len(out.get(sid, [])) >= limit_per_session:
            continue
        goal = ""
        try:
            goal = str(json.loads(r["task_json"] or "{}").get("goal") or "")
        except Exception:
            pass
        started = r["dispatched_at"] or 0
        done = r["completed_at"]
        out.setdefault(sid, []).append({
            "id": r["delegation_id"],
            "state": r["state"] or "",
            "goal": " ".join(goal.split())[:120],
            "seconds": round(done - started, 1) if (done and started) else None,
        })
    return out


# ── 当前上下文用量 ──────────────────────────────────────────
def _state() -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{STATE_DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _config() -> dict:
    try:
        import yaml  # Hermes 自带 venv 里有
        return yaml.safe_load(CONFIG_FILE.read_text(encoding="utf-8")) or {}
    except Exception:
        return {}


def _rough_tokens(text: str) -> int:
    """用 Hermes 自己的估算函数，口径跟它内部一致。"""
    try:
        from agent.model_metadata import estimate_tokens_rough
        return int(estimate_tokens_rough(text or ""))
    except Exception:
        # 退化：中文按 ~1.6 字/token、英文按 ~4 字符/token 粗算
        if not text:
            return 0
        return int(len(text) / 2.8) + 1


# ── 窗口：直接问 Hermes 自己 ────────────────────────────────
_window_cache: dict[tuple, tuple[float, int]] = {}
WINDOW_CACHE_TTL = 300.0        # 问到的窗口 5 分钟内不重复问（探接口有网络开销）
WINDOW_CACHE_TTL_EMPTY = 60.0   # 没问到（网络失败等）只记 1 分钟，别把空值钉住


def _same_model(a, b) -> bool:
    """同一个模型：库里的名字可能带渠道前缀（cline-pass/deepseek-v4.1-flash）。"""
    x, y = str(a or "").strip().lower(), str(b or "").strip().lower()
    return bool(x) and bool(y) and (x == y or x.split("/")[-1] == y.split("/")[-1])


def _relay_entry(model: str, provider: str, base_url: str) -> dict:
    """页面上添加的那条记录（models.json 的 custom / channels），按「模型 + 接口地址」对。

    同一个模型名在不同中转接口上的窗口可能不同，所以地址也要对上。
    """
    if provider and provider != "custom" and not base_url:
        return {}
    try:
        import models as relay_models
        from agent.agent_init import normalize_route_base_url

        def route(raw) -> str:
            return normalize_route_base_url(str(raw or ""))

        data = relay_models._load()
        want = route(base_url)
        for item in data.get("custom") or []:
            if str(item.get("model_id") or "") == model and (not want or route(item.get("base_url")) == want):
                return item
        for channel in data.get("channels") or []:
            for item in channel.get("models") or []:
                if str(item.get("model_id") or "") == model and route(channel.get("base_url")) == want:
                    return dict(item, base_url=channel.get("base_url"), api_key=channel.get("api_key"))
    except Exception:
        pass
    return {}


def _config_stamp() -> tuple:
    """Hermes 配置文件的指纹（改动时间 + 大小）。

    窗口解析要读配置里钉住的 model_overrides，所以配置一改就得重算：
    以前只按模型名缓存，改了配置还要等 5 分钟缓存过期才生效。
    """
    try:
        st = CONFIG_FILE.stat()
        return (int(st.st_mtime), int(st.st_size))
    except OSError:
        return (0, 0)


def _native_window(model: str, provider: str, base_url: str, api_key: str, cfg: dict) -> int:
    """Hermes 自己给这个模型算的窗口（命令行 /model 显示的、压缩阈值用的都是它）。

    解析顺序交给 Hermes：配置里钉住的长度（路由变了就丢弃）→ 自定义接口探 /models →
    持久缓存 → models.dev → 内置模型表 → 兜底值。探接口会阻塞，所以缓存一会儿。
    """
    key = (str(model), str(provider or ""), str(base_url or ""), _config_stamp())
    now = time.time()
    cached = _window_cache.get(key)
    if cached and now - cached[0] < (WINDOW_CACHE_TTL if cached[1] else WINDOW_CACHE_TTL_EMPTY):
        return cached[1]
    window = 0
    try:
        from hermes_cli.model_switch import resolve_display_context_length

        mcfg = cfg.get("model") or {}
        value = resolve_display_context_length(
            model, provider or "",
            base_url=base_url or "", api_key=api_key or "",
            custom_providers=cfg.get("custom_providers") or [],
            config_context_length=(mcfg.get("context_length") if isinstance(mcfg, dict) else None),
            configured_model=str(mcfg.get("default") or ""),
            configured_provider=str(mcfg.get("provider") or ""),
            configured_base_url=str(mcfg.get("base_url") or ""),
        )
        window = int(value) if value else 0
    except Exception:
        window = 0
    _window_cache[key] = (now, window)
    return window


def context_stats(session_id: str, model: str = "", provider: str = "", base_url: str = "") -> dict:
    cfg = _config()

    # 优先查该会话持久化的真实模型与系统提示词（避免顶部切换模型时误用新模型的窗口套在老会话上）
    sess_model = ""
    sess_provider = ""
    sess_base_url = ""
    sess_sys_prompt = ""
    try:
        conn = _state()
        s_row = conn.execute(
            """select s.model, s.billing_provider, s.billing_base_url,
                      coalesce(s.system_prompt, sp.prompt, '') as full_sys_prompt
               from sessions s
               left join system_prompts sp on s.system_prompt_hash = sp.hash
               where s.id = ?""",
            (session_id,),
        ).fetchone()
        conn.close()
        if s_row:
            sess_model = str(s_row["model"] or "").strip()
            sess_provider = str(s_row["billing_provider"] or "").strip()
            sess_base_url = str(s_row["billing_base_url"] or "").strip()
            sess_sys_prompt = str(s_row["full_sys_prompt"] or "").strip()
    except Exception:
        pass

    if sess_model:
        model = sess_model
        if sess_provider:
            provider = sess_provider
        if sess_base_url:
            base_url = sess_base_url
    else:
        if not model:
            model = str((cfg.get("model") or {}).get("default") or "")
        if not provider:
            provider = str((cfg.get("model") or {}).get("provider") or "")

    # 1) 还活着的消息估个 token 数（含思考，含工具结果）
    used = 0
    alive = 0
    try:
        conn = _state()
        rows = conn.execute(
            "select role, content, reasoning_content, reasoning, tool_calls, tool_name "
            "from messages where session_id=? and coalesce(active,1)=1 order by id",
            (session_id,),
        ).fetchall()
        for r in rows:
            content = r["content"]
            if isinstance(content, (bytes, bytearray)):
                content = content.decode("utf-8", "replace")
            used += _rough_tokens(str(content or ""))
            used += _rough_tokens(str(r["reasoning_content"] or r["reasoning"] or ""))
            used += _rough_tokens(str(r["tool_calls"] or ""))
            alive += 1
        conn.close()
    except Exception:
        pass

    # 1b) 调用原生方法校验用量记录与历史是否匹配。
    #     缺失或失效时补全系统提示词和工具定义进行完整请求估算，避免口径断崖式暴跌 2~3 万。
    used_source = "estimate"
    try:
        import sessions
        from agent.usage_anchor import persisted_anchor_tokens
        from agent.model_metadata import estimate_request_tokens_rough
        import agent_bridge

        # Use the same persisted message shape as the agent, including tool IDs.
        messages = sessions.history(session_id)
        alive = len(messages)
        anchored = persisted_anchor_tokens(sessions.db(), session_id, messages)
        if anchored is not None:
            used = anchored
            used_source = "anchor"
        else:
            tools = agent_bridge.get_cached_tools()
            used = estimate_request_tokens_rough(messages, system_prompt=sess_sys_prompt, tools=tools)
    except Exception:
        pass

    # 2) 缓存/调用这些只认 Hermes 库里的真实累计。
    #    口径与 Hermes 状态栏一致：只算主对话（task=''）。
    calls = in_tok = out_tok = 0
    cache_read = cache_write = 0
    cache_scope = ""
    cache_other_models: list[str] = []
    hit_rate: float | None = None
    try:
        conn = _state()
        rows = conn.execute(
            "select model, billing_provider, sum(api_call_count) c, sum(input_tokens) i, sum(output_tokens) o, "
            "sum(cache_read_tokens) cr, sum(cache_write_tokens) cw "
            "from session_model_usage where session_id=? and task='' group by model, billing_provider",
            (session_id,),
        ).fetchall()
        conn.close()

        mine = [r for r in rows if _same_model(r["model"], model)]
        picked = mine or list(rows)
        cache_scope = "model" if mine else ("session" if rows else "")
        if mine:
            cache_other_models = list({str(r["model"]) for r in rows if not _same_model(r["model"], model)})

        calls = sum(int(r["c"] or 0) for r in picked)
        in_tok = sum(int(r["i"] or 0) for r in picked)
        out_tok = sum(int(r["o"] or 0) for r in picked)
        cache_read = sum(int(r["cr"] or 0) for r in picked)
        cache_write = sum(int(r["cw"] or 0) for r in picked)

        # 缓存命中率：只统计报告了缓存字段的行（cr > 0 或 cw > 0），避免不支持缓存的渠道虚增分母
        # 公式对齐 Hermes 原生：cache_read / prompt_total，其中 prompt_total = input_tokens + cache_read + cache_write
        eligible = [r for r in picked if (int(r["cr"] or 0) > 0 or int(r["cw"] or 0) > 0)]
        if eligible:
            e_in = sum(int(r["i"] or 0) for r in eligible)
            e_cr = sum(int(r["cr"] or 0) for r in eligible)
            e_cw = sum(int(r["cw"] or 0) for r in eligible)
            prompt_total = e_in + e_cr + e_cw
            # 对齐 Hermes 原生准则：A zero-read regime hides the segment (no data != an alarming 0%)
            # 只有当 cache_read > 0 时才计算并给出百分比，否则保持 None
            if prompt_total > 0 and e_cr > 0:
                hit_rate = e_cr / prompt_total
    except Exception:
        pass

    # 3) 窗口：页面上手填的 > Hermes 自己算的。查不到就保持 0，前端说「窗口未知」。
    window = 0
    window_source = ""
    entry = _relay_entry(model, provider, base_url)
    api_key = str(entry.get("api_key") or "")
    entry_ctx = entry.get("context_length")
    if isinstance(entry_ctx, int) and entry_ctx > 0:
        window = entry_ctx
        window_source = "manual"
    if not window:
        if not api_key:
            api_key = str((((cfg.get("providers") or {}).get(provider) or {}).get("api_key")) or "")
        native = _native_window(model, provider, base_url, api_key, cfg)
        if native:
            window = native
            window_source = "native"
    comp = cfg.get("compression") or {}
    threshold = float(comp.get("threshold") or 0.5)
    enabled = bool(comp.get("enabled", True))

    pct = (used / window * 100) if window else 0.0
    return {
        "model": model,
        "used": used,
        "used_source": used_source,
        "window": window,
        "window_source": window_source,
        "percent": round(pct, 1),
        "messages": alive,
        "compress_at": int(window * threshold) if window else 0,
        "compress_threshold": threshold,
        "compress_enabled": enabled,
        "calls": calls,
        "input_tokens": in_tok,
        "output_tokens": out_tok,
        "cache_read": cache_read,
        "cache_write": cache_write,
        "cache_hit_rate": round(hit_rate, 4) if hit_rate is not None else None,
        "cache_scope": cache_scope,
        "cache_other_models": cache_other_models,
        "turn_stats": {"turns": 0, "cache_read": 0, "cache_write": 0, "prompt_total": 0, "hit_rate": 0.0, "reported": False},
    }
