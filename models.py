"""relay 自己的模型清单与「当前用哪个模型 / 多强的思考」——**只作用于这个网页**。

为什么不写 Hermes 的全局配置：那样会连带改到命令行、桌面端、微信那几个入口，
而用户明确要求「网页里选的只影响网页」。所以这里有一份独立的小配置：

    ~/.hermes/hermes-relay/models.json      （0600）

    {
      "current": {"key": "cline-pass/deepseek-v4.1-flash", "effort": "medium"},
      "custom": [
        {"key": "custom:kimi-k3", "name": "Kimi K3", "model_id": "kimi-k3",
         "base_url": "https://api.moonshot.cn/v1", "api_key": "sk-..."}
      ]
    }

两条来源：
- **Hermes 已配置的渠道模型**（读 config.yaml 的 providers.*.models）—— 这里只是「挑一个用」，
  渠道和密钥仍由 Hermes 自己解析；
- **页面上加的模型**（标准 OpenAI 格式的接口地址 + 密钥 + 模型 ID）—— 密钥只落在上面那个文件里，
  不进代码仓库，也不进 Hermes 的配置。

每轮对话都重新读一次这个文件（agent_bridge 用 active_runtime()），所以页面上改完**下一轮就生效**，
不需要重启服务。
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

DATA_DIR = os.path.expanduser("~/.hermes/hermes-relay")
# 测试时可以指向别处（HERMES_RELAY_MODELS=/tmp/x.json），免得动到线上正在用的那份
CONFIG_PATH = os.environ.get("HERMES_RELAY_MODELS") or os.path.join(DATA_DIR, "models.json")

# 界面上的五档 → 实际存的值。Hermes 认的字面就是 none/low/medium/high/max
# （`middle` 它不认）。注意：上游只支持三档的模型（比如现在的 DeepSeek）会把
# medium 折成 high，也就是「中」和「高」在那种模型上效果一样 —— 这是上游的限制。
EFFORTS = [
    {"value": "none", "label": "关", "hint": "不思考，最快"},
    {"value": "low", "label": "低", "hint": "low"},
    {"value": "medium", "label": "中", "hint": "medium"},
    {"value": "high", "label": "高", "hint": "high"},
    {"value": "max", "label": "最高", "hint": "max，最慢"},
]
EFFORT_VALUES = [e["value"] for e in EFFORTS]

# 显示名里常见的品牌写法（自动生成名字时用；认不出来的就首字母大写）
_BRAND = {
    "deepseek": "DeepSeek", "glm": "GLM", "gpt": "GPT", "kimi": "Kimi", "qwen": "Qwen",
    "mimo": "MiMo", "grok": "Grok", "claude": "Claude", "gemini": "Gemini", "llama": "Llama",
    "minimax": "MiniMax", "doubao": "Doubao", "ernie": "ERNIE", "spark": "Spark",
    "hunyuan": "Hunyuan", "gemma": "Gemma", "phi": "Phi",
}

_lock = threading.Lock()


# ── 配置读写 ────────────────────────────────────────────────────────────────

def _load() -> dict:
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}
    except Exception:
        return {}


def _save(data: dict) -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = CONFIG_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    os.chmod(tmp, 0o600)
    os.replace(tmp, CONFIG_PATH)


# ── 模型清单 ────────────────────────────────────────────────────────────────

def _pretty(model_id: str) -> str:
    """从模型 ID 猜一个能看的名字：deepseek-v4.1-flash → DeepSeek V4.1 Flash"""
    raw = model_id.split("/")[-1]
    words: list[str] = []
    for tok in re.split(r"[-_ ]", raw):
        if not tok:
            continue
        low = tok.lower()
        if low in _BRAND:
            words.append(_BRAND[low])
            continue
        ver = re.fullmatch(r"v(\d+(?:\.\d+)*)", low)
        if ver:
            words.append("V" + ver.group(1))
            continue
        if re.fullmatch(r"[\d.]+", tok):
            words.append(tok)
            continue
        words.append(tok[:1].upper() + tok[1:])
    return " ".join(words) or raw


def _hermes_models() -> list[dict]:
    """Hermes 已经配好的渠道模型（config.yaml → providers.<pid>.models）。"""
    out: list[dict] = []
    try:
        from hermes_cli.config import load_config
        cfg = load_config() or {}
    except Exception:
        return out
    providers = cfg.get("providers") or {}
    default_model = ""
    model_cfg = cfg.get("model")
    if isinstance(model_cfg, dict):
        default_model = str(model_cfg.get("default") or "")
    for pid, prof in providers.items():
        models = (prof or {}).get("models") or {}
        for mid in models:
            mid = str(mid)
            full = mid if "/" in mid else f"{pid}/{mid}"
            item = {
                "key": full,
                "name": _pretty(mid),
                "model_id": mid,
                "provider": pid,
                "source": "hermes",
            }
            if mid == default_model or full == default_model:
                item["is_default"] = True
            out.append(item)
    # 默认模型要是没在上面出现（比如渠道没写 models 段），也补一条，免得选不到
    if default_model and not any(m["key"] == default_model or m["model_id"] == default_model for m in out):
        pid = str((cfg.get("model") or {}).get("provider") or "")
        out.insert(0, {
            "key": default_model,
            "name": _pretty(default_model),
            "model_id": default_model,
            "provider": pid,
            "source": "hermes",
            "is_default": True,
        })
    return out


def default_effort() -> str:
    """Hermes 配置里的全局思考强度 —— 页面上没选过档位时，实际生效的就是它。"""
    try:
        from hermes_cli.config import load_config
        cfg = load_config() or {}
        val = str(((cfg.get("agent") or {}).get("reasoning_effort")) or "").strip()
        return val if val in EFFORT_VALUES else "high"
    except Exception:
        return "high"


def list_models() -> dict:
    """给前端的清单：Hermes 渠道的 + 页面上自己加的。"""
    data = _load()
    custom = []
    for c in data.get("custom") or []:
        row = {
            "key": c.get("key") or "",
            "name": c.get("name") or c.get("model_id") or "",
            "model_id": c.get("model_id") or "",
            "base_url": c.get("base_url") or "",
            "source": "custom",
            "has_key": bool(c.get("api_key")),
        }
        ctx = c.get("context_length")
        if isinstance(ctx, int) and ctx > 0:
            row["context_length"] = ctx
        custom.append(row)
    # 渠道里的模型：摊平成同样的条目，多带 channel_id / channel_name（前端按渠道分组）
    channel_models = []
    for ch in data.get("channels") or []:
        cid = str(ch.get("id") or "")
        cname = str(ch.get("name") or "") or _channel_host(ch.get("base_url") or "")
        for m in ch.get("models") or []:
            mid = str(m.get("model_id") or "")
            if not mid:
                continue
            row = {
                "key": make_channel_key(cid, mid),
                "name": _pretty(mid),
                "model_id": mid,
                "base_url": str(ch.get("base_url") or ""),
                "source": "custom",
                "channel_id": cid,
                "channel_name": cname,
                "has_key": bool(ch.get("api_key")),
            }
            ctx = m.get("context_length")
            if isinstance(ctx, int) and ctx > 0:
                row["context_length"] = ctx
            channel_models.append(row)
    return {
        "models": _hermes_models() + custom + channel_models,
        "custom": custom,
        "channels": [_public_channel(c) for c in data.get("channels") or []],
        "default_effort": default_effort(),
    }


def current() -> dict:
    cur = (_load().get("current") or {})
    return {
        "key": str(cur.get("key") or ""),
        "effort": str(cur.get("effort") or ""),
    }


def set_current(key: str | None = None, effort: str | None = None) -> dict:
    """页面上选完就写这里。

    ``None`` = 这个字段不动；空串 = 清掉（回到 Hermes 的默认）。
    必须区分这两者：前端换档位时只发 effort，不能顺手把选的模型也清掉。
    """
    with _lock:
        data = _load()
        cur = dict(data.get("current") or {})
        if key is not None:
            if key:
                cur["key"] = key
            else:
                cur.pop("key", None)
        if effort is not None:
            if effort:
                if effort not in EFFORT_VALUES:
                    raise ValueError(f"不认识的思考强度：{effort}")
                cur["effort"] = effort
            else:
                cur.pop("effort", None)
        data["current"] = cur
        _save(data)
        return cur


# ── 页面上自己加的模型（标准 OpenAI 格式） ──────────────────────────────────

def make_custom_key(model_id: str) -> str:
    return "custom:" + str(model_id).strip().lower().replace(" ", "-")


def add_custom(name: str, base_url: str, api_key: str, model_id: str, context_length=None) -> dict:
    name, base_url, api_key, model_id = (x.strip() for x in (name, base_url, api_key, model_id))
    if not (base_url and model_id):
        raise ValueError("接口地址和模型 ID 都要填")
    if not base_url.startswith(("http://", "https://")):
        raise ValueError("接口地址要以 http:// 或 https:// 开头")
    base_url = base_url.rstrip("/")
    # 手填的窗口优先（很多中转接口不肯报窗口大小，只能人填）；没填才去问接口和公开目录。
    # 查不到就留空。绝不拿「名字差不多的另一个模型」或 Hermes 的 25.6 万默认值来填。
    manual = _manual_context(context_length)
    found = None if manual else lookup_context_length(base_url, api_key, model_id)
    item = {
        "key": make_custom_key(model_id),
        "name": name or _pretty(model_id),
        "model_id": model_id,
        "base_url": base_url,
        "api_key": api_key,
        "added_at": int(time.time()),
    }
    if manual:
        item["context_length"] = manual
        item["context_source"] = "manual"
    elif found:
        item["context_length"] = found["context_length"]
        item["context_source"] = found["source"]
    with _lock:
        data = _load()
        custom = [c for c in (data.get("custom") or []) if c.get("key") != item["key"]]
        custom.append(item)
        data["custom"] = custom
        _save(data)
    return {k: v for k, v in item.items() if k != "api_key"} | {"has_key": bool(api_key)}


def update_custom(key: str, name: str, model_id: str, context_length=None) -> dict:
    name, model_id = name.strip(), model_id.strip()
    if not model_id:
        raise ValueError("模型 ID 不能为空")
    manual = _manual_context(context_length)
    with _lock:
        data = _load()
        # 1. 渠道下的模型：key 形如 custom:<channel_id>/<model_id>
        if "/" in key and key.startswith("custom:"):
            raw = key.split("custom:", 1)[1]
            cid, old_mid = raw.split("/", 1)
            channels = data.get("channels") or []
            target = next((c for c in channels if str(c.get("id") or "") == cid), None)
            if not target:
                raise ValueError("未找到对应渠道")
            models_list = target.get("models") or []
            new_list = []
            found = False
            for m in models_list:
                cur_mid = m.get("model_id") if isinstance(m, dict) else str(m)
                if cur_mid == old_mid:
                    found = True
                    item: dict = {"model_id": model_id}
                    if name:
                        item["name"] = name
                    elif isinstance(m, dict) and m.get("name"):
                        item["name"] = m["name"]
                    if manual is not None:
                        item["context_length"] = manual
                    elif isinstance(m, dict) and "context_length" in m:
                        item["context_length"] = m["context_length"]
                    new_list.append(item)
                else:
                    new_list.append(m)
            if not found:
                raise ValueError("未找到要修改的模型")
            target["models"] = new_list
            new_key = make_channel_key(cid, model_id)
            cur = data.get("current") or {}
            if cur.get("key") == key:
                cur["key"] = new_key
                data["current"] = cur
            _save(data)
            return {"key": new_key, "name": name or model_id, "model_id": model_id, "context_length": manual}

        # 2. 独立自定义模型
        custom = data.get("custom") or []
        target = next((c for c in custom if c.get("key") == key), None)
        if not target:
            raise ValueError("未找到要修改的模型")

        new_key = make_custom_key(model_id)
        if new_key != key and any(c.get("key") == new_key for c in custom):
            raise ValueError(f"已存在相同 ID 的模型「{model_id}」")

        target["name"] = name or _pretty(model_id)
        target["model_id"] = model_id
        target["key"] = new_key
        if manual is not None:
            target["context_length"] = manual
            target["context_source"] = "manual"
        elif context_length is not None and str(context_length).strip() == "":
            target.pop("context_length", None)
            target.pop("context_source", None)
            found = lookup_context_length(target.get("base_url") or "", target.get("api_key") or "", model_id)
            if found:
                target["context_length"] = found["context_length"]
                target["context_source"] = found["source"]

        cur = data.get("current") or {}
        if cur.get("key") == key:
            cur["key"] = new_key
            data["current"] = cur

        _save(data)
        return {k: v for k, v in target.items() if k != "api_key"} | {"has_key": bool(target.get("api_key"))}


def remove_custom(key: str) -> bool:
    with _lock:
        data = _load()
        # 先按「页面上单独加的模型」精确删。它的 model_id 可能自带渠道前缀
        # （custom:cline-pass/deepseek-v4.1-flash-1017），不能凭 key 里有 "/" 就当渠道模型 ——
        # 那样会去 channels 里找一个不存在的渠道 id，返回 False，界面上表现为「点删除没反应」。
        custom = data.get("custom") or []
        left = [c for c in custom if c.get("key") != key]
        if len(left) != len(custom):
            data["custom"] = left
            cur = data.get("current") or {}
            if cur.get("key") == key:
                cur.pop("key", None)
                data["current"] = cur
            _save(data)
            return True

        if "/" in key and key.startswith("custom:"):
            # 属于某个渠道下的模型：从对应渠道的 models 列表里移除
            raw = key.split("custom:", 1)[1]
            cid, mid = raw.split("/", 1)
            channels = data.get("channels") or []
            target = next((c for c in channels if str(c.get("id") or "") == cid), None)
            if not target:
                return False
            models_list = target.get("models") or []
            left_models = [m for m in models_list if (m.get("model_id") if isinstance(m, dict) else str(m)) != mid]
            if len(left_models) == len(models_list):
                return False
            target["models"] = left_models
            cur = data.get("current") or {}
            if cur.get("key") == key:
                cur.pop("key", None)
                data["current"] = cur
            _save(data)
            return True

        return False


# ── 渠道：一次填地址 + 密钥，把这个接口下的模型整批收进来 ─────────────────────
#
# 和「单个模型」的区别只在存法：渠道把连接信息存一份，模型挂在它下面。
# 选模型时用的 key 是 ``custom:<渠道id>/<模型名>``，两个渠道有同名模型也不会打架。

def make_channel_key(channel_id: str, model_id: str) -> str:
    return "custom:" + str(channel_id) + "/" + str(model_id).strip()


def _channel_host(base_url: str) -> str:
    """地址里的主机名：https://sub.lunarfox.cn/v1 → sub.lunarfox.cn"""
    host = urllib.parse.urlsplit(base_url or "").netloc or ""
    return host.split("@")[-1].split(":")[0]


def _channel_id(base_url: str, taken: set) -> str:
    """从地址生成稳定的渠道 id：sub.lunarfox.cn → sub-lunarfox-cn（撞了就加 -2）。"""
    host = _channel_host(base_url) or (base_url or "")
    base = re.sub(r"[^a-z0-9]+", "-", host.lower()).strip("-") or "channel"
    cid, n = base, 1
    while cid in taken:
        n += 1
        cid = f"{base}-{n}"
    return cid


def _public_channel(c: dict) -> dict:
    """给前端的渠道：密钥不外发，只说有没有。"""
    cid = str(c.get("id") or "")
    models_out = []
    for m in c.get("models") or []:
        mid = str(m.get("model_id") or "")
        if not mid:
            continue
        row = {"model_id": mid, "key": make_channel_key(cid, mid), "name": _pretty(mid)}
        ctx = m.get("context_length")
        if isinstance(ctx, int) and ctx > 0:
            row["context_length"] = ctx
        models_out.append(row)
    return {
        "id": cid,
        "name": str(c.get("name") or "") or _channel_host(c.get("base_url") or ""),
        "base_url": str(c.get("base_url") or ""),
        "models": models_out,
        "has_key": bool(c.get("api_key")),
        "added_at": c.get("added_at"),
        "synced_at": c.get("synced_at"),
    }


def list_channels() -> list:
    return [_public_channel(c) for c in (_load().get("channels") or [])]


def _models_from_entries(entries: list) -> list:
    out = []
    for e in entries:
        mid = str(e.get("id") or e.get("model_id") or "").strip()
        if not mid:
            continue
        ctx = e.get("context_length")
        if isinstance(ctx, int) and ctx > 0:
            out.append({"model_id": mid, "context_length": ctx})
        else:
            out.append({"model_id": mid})
    return out


def add_channel(name: str, base_url: str, api_key: str) -> dict:
    """填接口地址 + 密钥 → 拉这个接口的模型清单 → 整条渠道存下来。

    不做勾选：清单里的模型全部收进来（收进来只代表「能选」，不代表在用）。
    接口不提供 /models 清单时直接报错，让用户退回「单个模型」手动加。
    """
    name, base_url, api_key = ((x or "").strip() for x in (name, base_url, api_key))
    if not base_url:
        raise ValueError("接口地址要填")
    if not base_url.startswith(("http://", "https://")):
        raise ValueError("接口地址要以 http:// 或 https:// 开头")
    base_url = base_url.rstrip("/")
    listing = list_endpoint_models(base_url, api_key)
    if not listing.get("ok"):
        raise ValueError(
            (listing.get("error") or "拿不到模型清单")
            + "；这个接口可能不提供 /models，改用下面的「单个模型」手动加。"
        )
    entries = listing.get("entries") or [{"id": i} for i in listing.get("models") or []]
    with _lock:
        data = _load()
        channels = list(data.get("channels") or [])
        # 同一个地址再加一次 = 刷新已有的那条，不会多出一个重复渠道
        cid = _channel_id(base_url, {str(c.get("id") or "") for c in channels})
        for old in list(channels):
            if (old.get("base_url") or "").rstrip("/") == base_url:
                cid = str(old.get("id") or cid)
                channels.remove(old)
                break
        now = int(time.time())
        item = {
            "id": cid,
            "name": name or _channel_host(base_url),
            "base_url": base_url,
            "api_key": api_key,
            "added_at": now,
            "synced_at": now,
            "models": _models_from_entries(entries),
        }
        channels.append(item)
        data["channels"] = channels
        _save(data)
    return _public_channel(item)


def sync_channel(channel_id: str) -> dict:
    """重新问一次这个接口有哪些模型：已存的窗口值保留，新出现的追加，上游撤掉的去掉。"""
    with _lock:
        data = _load()
        channels = list(data.get("channels") or [])
        target = next((c for c in channels if str(c.get("id") or "") == channel_id), None)
        if target is None:
            raise ValueError("没有这个渠道")
        listing = list_endpoint_models(str(target.get("base_url") or ""), str(target.get("api_key") or ""))
        if not listing.get("ok"):
            raise ValueError(listing.get("error") or "拿不到模型清单")
        entries = listing.get("entries") or [{"id": i} for i in listing.get("models") or []]
        known = {str(m.get("model_id") or ""): m for m in target.get("models") or []}
        fresh = []
        for row in _models_from_entries(entries):
            mid = row["model_id"]
            if "context_length" not in row:
                old_ctx = (known.get(mid) or {}).get("context_length")
                if isinstance(old_ctx, int) and old_ctx > 0:
                    row["context_length"] = old_ctx
            fresh.append(row)
        target["models"] = fresh
        target["synced_at"] = int(time.time())
        data["channels"] = channels
        _save(data)
    return _public_channel(target)


def remove_channel(channel_id: str) -> bool:
    with _lock:
        data = _load()
        channels = data.get("channels") or []
        left = [c for c in channels if str(c.get("id") or "") != channel_id]
        if len(left) == len(channels):
            return False
        data["channels"] = left
        cur = data.get("current") or {}
        # 正在用的模型属于这个渠道时，选择一起清掉（下一轮回到 Hermes 的默认模型）
        if str(cur.get("key") or "").startswith("custom:" + channel_id + "/"):
            cur.pop("key", None)
            data["current"] = cur
        _save(data)
        return True


# 上下文长度的字段名，跟 Hermes 读 /models 时认的那一组对齐。
# max_tokens 故意不在里面：很多接口用它表示「单次最多输出多少」，不是整段上下文。
_CONTEXT_KEYS = (
    "context_length", "context_window", "context_size", "max_context_length",
    "max_position_embeddings", "max_model_len", "max_input_tokens",
    "max_sequence_length", "max_seq_len", "n_ctx_train", "n_ctx", "ctx_size",
)


def _positive_context(value) -> int | None:
    try:
        n = int(str(value).strip().replace(",", "")) if isinstance(value, str) else int(value)
    except (TypeError, ValueError):
        return None
    if 1024 <= n <= 10_000_000:
        return n
    return None


def _manual_context(value) -> int | None:
    """页面上手填的窗口大小。留空/None = 没填，返回 None（调用方去自动查）。

    填了就必须是正数，允许 `128000` / `128,000` / `128k` / `1m` 这几种写法 ——
    中转接口大多不报窗口，用户是从模型文档里抄数字过来的，格式放宽一点省事。
    非法值直接报错（而不是悄悄留空）：填错了要当场知道，不能等到看百分比才发现。
    """
    if value is None:
        return None
    raw = str(value).strip().lower().replace(",", "").replace("_", "").replace(" ", "")
    if not raw:
        return None
    mult = 1
    if raw.endswith("k"):
        mult, raw = 1000, raw[:-1]
    elif raw.endswith("m"):
        mult, raw = 1_000_000, raw[:-1]
    try:
        n = int(float(raw) * mult)
    except ValueError:
        raise ValueError("上下文窗口要填数字，比如 128000 或 128k；留空就自动查")
    if n <= 0:
        raise ValueError("上下文窗口要填大于 0 的数字")
    return n


def _context_on_object(obj: dict) -> int | None:
    """只读这一层自己的字段，不往嵌套对象里翻，免得把输出上限当成上下文。"""
    if not isinstance(obj, dict):
        return None
    lower = {str(k).lower(): v for k, v in obj.items()}
    for key in _CONTEXT_KEYS:
        found = _positive_context(lower.get(key))
        if found:
            return found
    limit = lower.get("limit")
    if isinstance(limit, dict):
        found = _positive_context(limit.get("context"))
        if found:
            return found
    return None


def _get_json(url: str, api_key: str = "", timeout: float = 12.0):
    headers = {"Accept": "application/json", "User-Agent": "hermes-relay"}
    if api_key:
        headers["Authorization"] = "Bearer " + api_key
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", "replace") or "{}")


def _context_from_endpoint(base_url: str, api_key: str, model_id: str) -> int | None:
    """问这个接口自己的 /models。只有返回条目的 id 和填的模型 ID 完全一致才采用。"""
    try:
        data = _get_json(base_url.rstrip("/") + "/models", api_key)
    except Exception:
        return None
    items = data.get("data") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return None
    want = model_id.strip()
    for item in items:
        if isinstance(item, dict) and str(item.get("id") or "") == want:
            return _context_on_object(item)
    return None


def _context_from_catalog(model_id: str) -> int | None:
    """公开模型目录（models.dev）。只认目录里的 id 和填的模型 ID 完全相同的那一条。

    同名出现多次、长度还不一样时，不猜，返回空。
    「grok-4.7」和「grok-4.7-build-fast」算两个模型，不会互相借用。
    """
    try:
        data = _get_json("https://models.dev/api.json", timeout=20.0)
    except Exception:
        return None
    want = model_id.strip()
    found: set[int] = set()

    def walk(node) -> None:
        if isinstance(node, dict):
            if str(node.get("id") or "") == want:
                limit = node.get("limit") if isinstance(node.get("limit"), dict) else None
                n = _positive_context(limit.get("context")) if limit else None
                if n is None:
                    n = _context_on_object(node)
                if n:
                    found.add(n)
            for child in node.values():
                if isinstance(child, (dict, list)):
                    walk(child)
        elif isinstance(node, list):
            for child in node:
                walk(child)

    walk(data)
    if len(found) == 1:
        return next(iter(found))
    return None


def lookup_context_length(base_url: str, api_key: str, model_id: str) -> dict | None:
    """添加模型时查它的上下文长度。

    先问接口自己，再问公开目录。两处都没有、或对不上这个确切的模型 ID，就返回空。
    不使用 Hermes 查不到时的 25.6 万默认值。
    """
    base_url = (base_url or "").strip().rstrip("/")
    model_id = (model_id or "").strip()
    if not base_url or not model_id:
        return None
    direct = _context_from_endpoint(base_url, api_key, model_id)
    if direct:
        return {"context_length": direct, "source": "endpoint"}
    catalog = _context_from_catalog(model_id)
    if catalog:
        return {"context_length": catalog, "source": "catalog"}
    return None


def list_endpoint_models(base_url: str, api_key: str, timeout: float = 20.0) -> dict:
    """问这个接口的 /models，拿它实际提供的模型 ID 清单。

    只收标准 OpenAI 格式里 data 数组的 id。接口不给这份清单（404、401、结构不对）
    就返回 ok:false，调用方照旧走单模型测试。
    """
    base_url = (base_url or "").strip().rstrip("/")
    if not base_url:
        return {"ok": False, "error": "接口地址要填"}
    try:
        data = _get_json(base_url + "/models", api_key, timeout=timeout)
    except urllib.error.HTTPError as exc:
        return {"ok": False, "error": f"HTTP {exc.code}"}
    except Exception as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
    items = data.get("data") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return {"ok": False, "error": "这个接口没有返回模型清单"}
    entries: list[dict] = []
    seen: set[str] = set()
    for it in items:
        if not isinstance(it, dict):
            continue
        mid = str(it.get("id") or "").strip()
        if not mid or mid in seen:
            continue
        seen.add(mid)
        row = {"id": mid}
        ctx = _context_on_object(it)
        if ctx:
            row["context_length"] = ctx
        entries.append(row)
    entries.sort(key=lambda r: r["id"])
    ids = [r["id"] for r in entries]
    if not ids:
        return {"ok": False, "error": "模型清单是空的"}
    return {"ok": True, "models": ids, "entries": entries}


def test_endpoint(base_url: str, api_key: str, model_id: str, timeout: float = 25.0) -> dict:
    """真发一次很小的请求，确认地址 / 密钥 / 模型 ID 三个都对得上。

    只用标准库（后端跑在 Hermes 的 venv 里，不能装包）。max_tokens 给 16：
    思考型模型会先吃思考 token，给 1 容易被上游判成参数非法。
    """
    base_url = (base_url or "").strip().rstrip("/")
    model_id = (model_id or "").strip()
    if not base_url or not model_id:
        return {"ok": False, "error": "接口地址和模型 ID 都要填"}
    url = base_url + "/chat/completions"
    payload = json.dumps({
        "model": model_id,
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 16,
        "stream": False,
    }).encode()
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = "Bearer " + api_key
    req = urllib.request.Request(url, data=payload, method="POST", headers=headers)
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            ms = int((time.time() - t0) * 1000)
            body = resp.read().decode("utf-8", "replace")
            try:
                data = json.loads(body or "{}")
            except Exception:
                return {"ok": False, "error": "返回的不是 JSON（可能不是标准 OpenAI 接口）"}
            if not isinstance(data, dict) or not isinstance(data.get("choices"), list):
                # 典型：网关把非流式响应包了一层 {"data": {...}}，这种网页里加不进来
                return {"ok": False, "error": "返回结构不是标准 OpenAI 格式（响应被包了一层？）"}
            got = ""
            try:
                got = str((data["choices"][0].get("message") or {}).get("model") or data.get("model") or "")
            except Exception:
                got = str(data.get("model") or "")
            return {"ok": True, "ms": ms, "model": got or model_id}
    except urllib.error.HTTPError as exc:
        ms = int((time.time() - t0) * 1000)
        detail = ""
        try:
            detail = exc.read().decode("utf-8", "replace")[:1200]
        except Exception:
            pass
        hint = ""
        if exc.code == 401:
            hint = "（密钥无效）"
        elif exc.code == 404:
            hint = "（地址或模型 ID 不对）"
        elif exc.code == 429:
            hint = "（被限流，过一会儿再试）"
        return {"ok": False, "ms": ms, "error": f"HTTP {exc.code}{hint} {detail}".strip()}
    except Exception as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


# ── 给 agent_bridge 用：这一轮该用哪个模型 / 多强的思考 ─────────────────────

def active_runtime() -> dict:
    """当前选择 → 覆盖 agent 的字段。空 dict = 什么都不覆盖（用 Hermes 自己的默认）。"""
    data = _load()
    cur = data.get("current") or {}
    out: dict = {}

    effort = str(cur.get("effort") or "")
    if effort in EFFORT_VALUES:
        out["reasoning_config"] = {"enabled": effort != "none", "effort": effort}

    key = str(cur.get("key") or "")
    if not key:
        return out

    for c in data.get("custom") or []:
        if c.get("key") == key:
            out.update({
                "model": str(c.get("model_id") or ""),
                # 标准 OpenAI 兼容端点：Hermes 认的写法就是 provider="custom" + 显式地址/密钥
                # （在它的 provider 表之前被拦下处理；写 "openai" 会报 Unknown provider）
                "provider": "custom",
                "requested_provider": "custom",
                "base_url": str(c.get("base_url") or ""),
                "api_key": str(c.get("api_key") or ""),
            })
            return out

    for c in data.get("channels") or []:
        cid = str(c.get("id") or "")
        if not cid or not key.startswith("custom:" + cid + "/"):
            continue
        mid = key.split("/", 1)[1]
        if mid and any(str(m.get("model_id") or "") == mid for m in c.get("models") or []):
            out.update({
                "model": mid,
                # 和上面的自定义端点同一条路：provider=custom + 显式地址/密钥
                "provider": "custom",
                "requested_provider": "custom",
                "base_url": str(c.get("base_url") or ""),
                "api_key": str(c.get("api_key") or ""),
            })
            return out

    for m in _hermes_models():
        if m["key"] == key:
            out["model"] = m["model_id"]
            pid = m.get("provider") or ""
            if pid:
                # 只给渠道名，凭据让 Hermes 自己解析 —— 显式塞 base_url/api_key 反而会
                # 绕过渠道插件（比如 cline-pass 的上游 pin），也会把默认渠道的凭据混进来。
                out["provider"] = pid
                out["requested_provider"] = pid
            return out

    # 配置里找不到这个 key（模型被删了？）：不覆盖模型，免得把一轮跑挂
    return out
