"""上下文用量 + 技能清单。

上下文用量：Hermes 的库里没有现成的"当前上下文多大"这个数（`messages.token_count`
全是 0，`session_model_usage` 又是整会话的累计值），所以这里自己估：
把该会话还活着的消息文本过一遍 Hermes 自己的估算函数，再加上缓存/调用次数这些真实累计值。

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
        if len(rel.parts) > 3:
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


def context_stats(session_id: str, model: str = "", provider: str = "") -> dict:
    cfg = _config()
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

    # 1b) Hermes 自己存着「最近一次真正发出去的 prompt token 数」——会话行 model_config 里的
    #     _usage_anchor，它判断该不该压缩用的就是这个数。有就用它：比按消息文本估的准，
    #     也保证面板的百分比和「会不会触发压缩」是同一个口径。锚点缺失（新会话、刚压缩完）
    #     才退回上面那条估算。
    used_source = "estimate"
    try:
        conn = _state()
        row = conn.execute("select model_config from sessions where id=?", (session_id,)).fetchone()
        conn.close()
        raw = row[0] if row else None
        if isinstance(raw, (bytes, bytearray)):
            raw = raw.decode("utf-8", "replace")
        anchor = (json.loads(raw) or {}).get("_usage_anchor") if raw else None
        aprompt = 0
        if isinstance(anchor, dict):
            aprompt = int(anchor.get("prompt_tokens") or 0)
        if aprompt > 0:
            used = aprompt
            used_source = "anchor"
    except Exception:
        pass

    # 2) 缓存/调用这些只认库里的真实累计
    calls = cache_read = cache_write = in_tok = out_tok = 0
    try:
        conn = _state()
        row = conn.execute(
            # 只算主对话那一行（task=''）：起标题、背景回顾、压缩、识图这些后台调用
            # 不吃前缀缓存，混进来会把命中率压低（本机实测差 1.8 个百分点），
            # 而 Hermes 命令行状态栏的口径也只算主对话。
            "select sum(api_call_count) c, sum(input_tokens) i, sum(output_tokens) o, "
            "sum(cache_read_tokens) cr, sum(cache_write_tokens) cw "
            "from session_model_usage where session_id=? and task=''",
            (session_id,),
        ).fetchone()
        if row:
            calls = int(row["c"] or 0)
            in_tok = int(row["i"] or 0)
            out_tok = int(row["o"] or 0)
            cache_read = int(row["cr"] or 0)
            cache_write = int(row["cw"] or 0)
        conn.close()
    except Exception:
        pass

    # 3) 窗口：全局配置 → 渠道模型自己的声明 → 页面上添加时查到的长度 → Hermes 里同名的模型。
    #    查不到就保持 0，前端不显示百分比，也不拿默认值凑。
    window = 0
    window_source = ""
    mcfg = cfg.get("model") or {}
    if mcfg.get("context_length"):
        window = int(mcfg["context_length"])
        window_source = "config"
    prov = (cfg.get("providers") or {}).get(provider) or {}
    pmodel = ((prov.get("models") or {}).get(model) or {})
    if not window and isinstance(pmodel, dict) and pmodel.get("context_length"):
        window = int(pmodel["context_length"])
        window_source = "provider"
    if not window:
        try:
            import models as relay_models
            for item in (relay_models._load().get("custom") or []):
                if str(item.get("model_id") or "") == model:
                    ctx = item.get("context_length")
                    if isinstance(ctx, int) and ctx > 0:
                        window = ctx
                        window_source = "custom"
                    break
        except Exception:
            pass
    if not window:
        # 页面上自己加的端点多半不报窗口（中转接口的通病），但 Hermes 配置里可能配着同一个模型
        # （页面上的 deepseek-v4.1-flash 与 cline-pass/deepseek-v4.1-flash 就是同一个）。
        # 按「去掉渠道前缀的模型名」找同名声明，找到就借用它的窗口 —— 总比分母是 0 强。
        bare = str(model).split("/")[-1]
        for _pid, _p in (cfg.get("providers") or {}).items():
            for _mid, _m in (((_p or {}).get("models")) or {}).items():
                if not isinstance(_m, dict) or not _m.get("context_length"):
                    continue
                if str(_mid) == str(model) or str(_mid).split("/")[-1] == bare:
                    window = int(_m["context_length"])
                    window_source = "same-name"
                    break
            if window:
                break
    comp = cfg.get("compression") or {}
    threshold = float(comp.get("threshold") or 0.5)
    enabled = bool(comp.get("enabled", True))

    # 逐轮实测：Hermes 每轮当场报的计数（只覆盖加了埋点之后跑的轮次）。
    # 主数字仍用库里的全历史累计，这一份用来对账、并分辨「上游没返回缓存字段」。
    turn_stats = {"turns": 0, "cache_read": 0, "cache_write": 0, "prompt_total": 0,
                  "hit_rate": 0.0, "reported": False}
    try:
        import sessions as _sessions

        turn_stats = _sessions.turn_cache_stats(session_id)
    except Exception:
        pass

    # 口径与 Hermes 自己的状态栏一致：命中 ÷（未命中输入 + 命中 + 写入）。
    # 前一项是「没吃到缓存的输入」，后两项是「吃到缓存的」和「这轮写进缓存的」，
    # 三项相加才是这次请求真正发出去的输入总量（Hermes 存库前已把缓存部分从 input 里扣掉）。
    denom = cache_read + cache_write + in_tok
    hit_rate = (cache_read / denom) if denom else 0.0
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
        "cache_hit_rate": round(hit_rate, 4),
        "turn_stats": turn_stats,
    }
