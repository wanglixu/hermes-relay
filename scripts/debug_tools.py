#!/usr/bin/env python3
"""调试用：走一遍本机 HTTP，强制触发工具调用，打印收到的事件类型。

    python3 scripts/debug_tools.py
"""
import json
import sys
import time
import urllib.request

BASE = "http://127.0.0.1:8788"


def post(path, payload=None, stream=False, timeout=180):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(BASE + path, method="POST", data=data,
                                 headers={"Content-Type": "application/json"})
    return urllib.request.urlopen(req, timeout=timeout)


sid = json.loads(post("/api/chats", {}).read())["id"]
print("会话:", sid)

resp = post(f"/api/chats/{sid}/turn",
            {"text": "用 terminal 工具执行 date，把输出贴出来。不要用别的方式。"})
t0 = time.time()
kinds = []
while True:
    line = resp.readline().decode("utf-8", "ignore").strip()
    if not line:
        continue
    if not line.startswith("data: "):
        print("非 data 行:", line[:80])
        continue
    ev = json.loads(line[6:])
    kinds.append(ev["type"])
    if ev["type"] in ("tool", "tool_start", "tool_end"):
        print(f"  [{ev['type']}] {ev}")
    if ev["type"] == "eof":
        break
    if time.time() - t0 > 150:
        print("超时")
        break
print("事件统计:", {k: kinds.count(k) for k in sorted(set(kinds))})
