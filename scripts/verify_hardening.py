#!/usr/bin/env python3
"""后端加固的验收脚本：直连 127.0.0.1:8788，逐条打请求看返回码。"""
import json
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8788"
JSON = {"Content-Type": "application/json"}
created = []


def req(method, path, body=None, headers=None):
    h = dict(headers or {})
    data = None
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
    r = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, resp.read()[:160].decode(errors="replace"), dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:160].decode(errors="replace"), dict(e.headers)


def check(label, got, want):
    ok = got == want
    print(f"{'✓' if ok else '✗'} {label}: 得到 {got}，期望 {want}")
    return ok


results = []

# 1. 跨站 Origin → 403
code, body, _ = req("POST", "/api/chats", {}, {**JSON, "Origin": "https://evil.com"})
results.append(check("跨站 Origin 创建会话", code, 403))
print("   ", body[:100])

# 2. 同源 Origin → 正常
code, body, _ = req("POST", "/api/chats", {}, {**JSON, "Origin": "http://127.0.0.1:8788"})
results.append(check("同源 Origin 创建会话", code, 201))
if code == 201:
    created.append(json.loads(body)["id"])

# 3. 没有 Origin（脚本/curl）→ 正常
code, body, _ = req("POST", "/api/chats", {}, JSON)
results.append(check("无 Origin 创建会话", code, 201))
if code == 201:
    created.append(json.loads(body)["id"])

# 4. Content-Type 不对 → 415
code, body, _ = req("POST", "/api/chats", b"{}", {"Content-Type": "text/plain"})
results.append(check("Content-Type: text/plain 发 JSON", code, 415))
print("   ", body[:100])

# 5. 坏 JSON → 400
code, body, _ = req("PATCH", f"/api/chats/{created[0]}", b"{not json", JSON)
results.append(check("坏 JSON", code, 400))
print("   ", body[:100])

# 6. ?limit=abc → 400
code, body, _ = req("GET", "/api/chats?limit=abc")
results.append(check("?limit=abc", code, 400))
print("   ", body[:100])

# 7. 越界附件路径（用不存在的会话，不会真跑 agent）
code, body, _ = req(
    "POST",
    "/api/chats/__verify_no_such_session__/turn",
    {"text": "hi", "attachments": [{"path": "/etc/passwd", "mime": "image/png"}]},
    JSON,
)
results.append(check("越界附件路径（会话不存在）", code, 404))

# 8. JSON 体积超 1MB → 413
big = b'{"x":"' + b"a" * (1024 * 1024 + 10) + b'"}'
code, body, _ = req("POST", "/api/chats", big, JSON)
results.append(check("JSON 超过 1MB", code, 413))
print("   ", body[:100])

# 9. 上传 .html 再回放 → 415
code, body, _ = req("POST", "/api/upload?session=verify&name=x.html", b"<html>hi</html>")
results.append(check("上传 .html", code, 200))
f_html = json.loads(body)["path"].split("/")[-1]
code2, body2, hdrs = req("GET", f"/api/uploads/verify/{f_html}")
results.append(check("回放 .html", code2, 415))
print("   ", body2[:100])

# 10. 上传 png 再回放 → 200 + 安全头
png = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
)
code, body, _ = req("POST", "/api/upload?session=verify&name=x.png", png)
results.append(check("上传 .png", code, 200))
f_png = json.loads(body)["path"].split("/")[-1]
code2, _, hdrs = req("GET", f"/api/uploads/verify/{f_png}")
results.append(check("回放 .png", code2, 200))
print("    nosniff:", hdrs.get("X-Content-Type-Options"), "| CSP:", hdrs.get("Content-Security-Policy"))

# 11. 健康检查 + 会话列表仍正常
code, body, _ = req("GET", "/api/health")
results.append(check("健康检查", code, 200))
code, body, _ = req("GET", "/api/chats?limit=3")
results.append(check("会话列表", code, 200))

# 清理：删掉测试会话
for sid in created:
    req("DELETE", f"/api/chats/{sid}")
print("\n清理测试会话:", len(created), "个")

print("\n===", sum(results), "/", len(results), "项通过")
