"""Offline regression tests; no live sessions or model calls are modified.

覆盖两处显示口径（都只改 relay 接入层，不动 Hermes 核心、不动压缩算法）：
1. 上下文用量 / 窗口：用量走 Hermes 原生校验过的计数，窗口直接问 Hermes 自己。
2. 缓存命中率：只算主对话 + 只算当前模型；上游不返回缓存字段时报「无数据」而不是 0%。
"""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.append("/usr/local/lib/hermes-agent")
import context
# Load dependencies before patch.dict restores sys.modules after each test.
# Lazy imports inside that patch can leave retained modules with stale classes.
import yaml
import agent.model_metadata
import agent.agent_init
import run_agent
from agent.usage_anchor import capture_usage_anchor, anchored_context_tokens


class _FakeCursor:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows

    def fetchone(self):
        return self._rows[0] if self._rows else None


class _FakeConn:
    """只够 context_stats 用：按模型分行返回用量累计。"""

    def __init__(self, rows):
        self.rows = rows

    def execute(self, sql, params=()):
        low = sql.lower()
        if "from sessions" in low:
            return _FakeCursor([])
        if "from messages" in low:
            return _FakeCursor([])
        return _FakeCursor(self.rows)

    def close(self):
        pass



def _usage_row(model, calls=1, inp=1000, out=100, cr=0, cw=0):
    return {"model": model, "c": calls, "i": inp, "o": out, "cr": cr, "cw": cw}


def _fake_sessions(messages=None, usage_rows=None, turn_stats=None):
    return SimpleNamespace(
        history=lambda sid: messages or [],
        db=lambda: SimpleNamespace(get_session_model_config_value=lambda *a: None),
        turn_cache_stats=lambda sid, model="": turn_stats
        or {"turns": 0, "cache_read": 0, "cache_write": 0, "prompt_total": 0, "hit_rate": 0.0, "reported": False},
    )


class UsageTests(unittest.TestCase):
    def check_usage(self, messages, anchor):
        # Use Hermes actual anchor validation; only replace the storage boundary.
        store = SimpleNamespace(get_session_model_config_value=lambda *a: anchor)
        sessions = SimpleNamespace(history=lambda sid: messages, db=lambda: store,
                                   turn_cache_stats=lambda sid, model="": {})
        with patch.dict(sys.modules, {"sessions": sessions}), patch.object(context, "_config", return_value={}), patch.object(context, "_state", side_effect=RuntimeError("isolated")):
            return context.context_stats("test-only")

    def test_counts_completion_and_new_messages(self):
        base = [{"role": "user", "content": "question"}]
        anchor = capture_usage_anchor(1000, 100, base)
        messages = base + [{"role": "assistant", "content": "answer"}, {"role": "user", "content": "next question"}]
        result = self.check_usage(messages, anchor)
        self.assertEqual(result["used"], anchored_context_tokens(messages, anchor))
        self.assertEqual(result["used_source"], "anchor")

    def test_stale_anchor_is_not_used(self):
        anchor = capture_usage_anchor(1000, 100, [{"role": "user", "content": "old"}])
        result = self.check_usage([{"role": "user", "content": "replacement"}], anchor)
        self.assertEqual(result["used_source"], "estimate")
        self.assertGreater(result["used"], 0)
        self.assertNotEqual(result["used"], 1000)


class WindowTests(unittest.TestCase):
    def stats(self, model="model-a", provider="custom", url="https://a.example/v1", data=None, native=256000):
        # native 固定成一个哨兵值：这些用例测的是 relay 自己的取舍，真去问 Hermes
        # （会探接口、写它的窗口缓存）既慢又会往 Hermes 的缓存里塞假模型。
        cfg = {"model": {"default": "model-a", "provider": "custom", "base_url": "https://a.example/v1", "context_length": 100000}}
        fake_models = SimpleNamespace(_load=lambda: data or {})
        with patch.object(context, "_config", return_value=cfg), patch.object(context, "_state", side_effect=RuntimeError("isolated")), patch.object(context, "_native_window", return_value=native), patch.dict(sys.modules, {"models": fake_models, "sessions": SimpleNamespace()}):
            return context.context_stats("test-only", model=model, provider=provider, base_url=url)

    def test_window_comes_from_hermes_resolver(self):
        # 窗口不再由 relay 自己算：Hermes 解析出多少就用多少（配置里钉住的长度、接口探到的、
        # 内置模型表、兜底值都由它决定），这样网页上的百分比和压缩阈值跟实际行为一致。
        out = self.stats(native=100000)
        self.assertEqual(out["window"], 100000)
        self.assertEqual(out["window_source"], "native")

    def test_different_model_does_not_inherit_default(self):
        # 换模型后不能继承配置里那个窗口 —— 但也不是 0：窗口交给 Hermes 自己解析。
        out = self.stats(model="model-b")
        self.assertNotEqual(out["window"], 100000)
        self.assertEqual(out["window_source"], "native")

    def test_same_model_different_endpoint_does_not_inherit(self):
        out = self.stats(url="https://b.example/v1")
        self.assertNotEqual(out["window"], 100000)
        self.assertEqual(out["window_source"], "native")

    def test_channel_window_matches_endpoint(self):
        data = {"channels": [
            {"base_url": "https://a.example/v1", "models": [{"model_id": "model-b", "context_length": 40000}]},
            {"base_url": "https://b.example/v1", "models": [{"model_id": "model-b", "context_length": 80000}]}]}
        out = self.stats(model="model-b", url="https://b.example/v1", data=data)
        self.assertEqual(out["window"], 80000)
        self.assertEqual(out["window_source"], "manual")

    def test_unknown_window_stays_zero(self):
        # Hermes 也解析不出来：保持 0，前端说「窗口未知」，不编一个数。
        out = self.stats(model="model-b", native=0)
        self.assertEqual(out["window"], 0)
        self.assertEqual(out["window_source"], "")
        self.assertEqual(out["percent"], 0.0)


class CacheTests(unittest.TestCase):
    def stats(self, model="model-a", rows=None, turn_stats=None):
        sessions = _fake_sessions(messages=[{"role": "user", "content": "hi"}], usage_rows=rows, turn_stats=turn_stats)
        with patch.object(context, "_config", return_value={}), patch.object(context, "_state", return_value=_FakeConn(rows or [])), patch.dict(sys.modules, {"sessions": sessions}), patch.object(context, "_native_window", return_value=0):
            return context.context_stats("test-only", model=model, provider="custom", base_url="https://a.example/v1")

    def test_cache_rate_only_counts_current_model(self):
        rows = [_usage_row("model-a", inp=100, cr=900), _usage_row("model-b", inp=8_000_000, cr=0)]
        out = self.stats(rows=rows)
        self.assertAlmostEqual(out["cache_hit_rate"], 0.9, places=4)
        self.assertEqual(out["cache_scope"], "model")
        self.assertEqual(out["cache_other_models"], ["model-b"])

    def test_missing_cache_fields_report_no_data(self):
        # 上游压根不返回缓存字段：0 不是「一次都没命中」，给 null，前端显示「无数据」。
        out = self.stats(rows=[_usage_row("model-a", inp=8_000_000, cr=0)],
                         turn_stats={"turns": 3, "cache_read": 0, "cache_write": 0, "prompt_total": 8_000_000, "hit_rate": 0.0, "reported": False})
        self.assertIsNone(out["cache_hit_rate"])

    def test_zero_read_reports_no_data_per_native_policy(self):
        # Hermes 原生准则：A zero-read regime hides the segment (no data != an alarming 0%)
        # 当 cache_read 为 0 时，不强行显示 0%，保持 None 由前端呈现「无数据」
        out = self.stats(rows=[_usage_row("model-a", inp=5000, cr=0)])
        self.assertIsNone(out["cache_hit_rate"])


    def test_falls_back_to_session_rows_when_model_unused(self):
        rows = [_usage_row("model-b", inp=100, cr=900)]
        out = self.stats(model="model-a", rows=rows)
        self.assertEqual(out["cache_scope"], "session")
        self.assertAlmostEqual(out["cache_hit_rate"], 0.9, places=4)


if __name__ == "__main__":
    unittest.main()
