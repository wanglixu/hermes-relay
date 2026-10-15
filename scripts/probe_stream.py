#!/usr/bin/env python3
"""量流式节奏：默认直连 127.0.0.1:8788（绕开 nginx/CF），记录每个 delta 的到达时间与长度。

    python3 scripts/probe_stream.py                    # 本机直连
    PROBE_BASE=https://your-host.example.com python3 scripts/probe_stream.py   # 走公网链路对比

前面挂了鉴权网关时，用 RELAY_COOKIE 传一个有效 cookie。
"""
import base64
import hashlib
import hmac
import json
import os
import time
import urllib.request
from pathlib import Path

BASE = os.environ.get("PROBE_BASE", "http://127.0.0.1:8788")


def _cookie():
    """前面挂了鉴权网关时，把有效 cookie 放进 RELAY_COOKIE 环境变量即可。"""
    return os.environ.get("RELAY_COOKIE", "")


def _headers():
    h = {"Content-Type": "application/json",
         "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"}
    if BASE.startswith("https"):
        h["Cookie"] = _cookie()
    return h


def post(path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(BASE + path, method="POST", data=data, headers=_headers())
    return urllib.request.urlopen(req, timeout=180)


print("目标:", BASE)
sid = json.loads(post("/api/chats", {}).read())["id"]
resp = post(f"/api/chats/{sid}/turn",
            {"text": "用大约 300 字讲讲 TCP 三次握手，分段说明，不要用工具。"})

t0 = time.time()
events = []
while True:
    line = resp.readline().decode("utf-8", "ignore").strip()
    if not line.startswith("data: "):
        continue
    ev = json.loads(line[6:])
    if ev["type"] == "delta":
        events.append((round(time.time() - t0, 2), len(ev["text"])))
    if ev["type"] == "eof":
        break

total = sum(n for _, n in events)
print(f"共 {len(events)} 个 delta，合计 {total} 字")
print("前 25 个 delta 的（秒, 字数）：")
print("  " + "  ".join(f"{t}/{n}" for t, n in events[:25]))
if events:
    span = events[-1][0] - events[0][0]
    print(f"首字 {events[0][0]}s，末字 {events[-1][0]}s，跨度 {span:.2f}s")
    print(f"平均每 {span / max(1, len(events) - 1):.3f}s 来一次，每次 {total / len(events):.1f} 字")
    print("单次最大块:", max(n for _, n in events), "字")
