# Hermes Relay — 给 AI 的项目约定

给这台服务器上唯一的 Hermes agent 做的网页聊天前端：同一份记忆与技能、同一个会话库
（`~/.hermes/state.db`）。线上 `https://relay.example.com`，服务 `hermes-relay`（后端 8788）
+ `hermes-relay-web`（前端 3220）。只有一个用户，没有登录/多租户。

**细节流程、命令、坑都在技能 `hermes-relay` 里，动手前先加载它**；产品意图看 `PRODUCT.md`，
改动史看 `AI_CHANGES.md`（先 `grep -n '^## ' AI_CHANGES.md` 扫时间线，近的条目才是当前状态）。

## 红线

1. **删会话是不可逆的物理删除**。脚本清理测试会话只能删自己 `POST /api/chats` 返回的 id；认领不到就跳过。
   绝不许拿"列表最新一条"当自己的会话——用户正在聊的就是最新一条（2026-10-08 删过用户的长会话）。
2. **别在它托管的会话里停/重启它自己**（`KillMode=control-group` 会连执行者一起杀）。
3. **后端不能装第三方 Python 包**（跑在 Hermes 自带 venv 里）；后端只能用 `/usr/local/lib/hermes-agent/venv/bin/python`。
4. **仓库是公开的**：密钥、密码、token、cookie 不进代码、日志、AI_CHANGES。
5. **界面改动走 `design-system/` 的规范**，不凭个人审美另起一套。

## 改一处

1. 加载技能 `hermes-relay`，扫 `AI_CHANGES.md` 时间线。
2. 改代码；前端改完必须 `bash web/scripts/dev-restart.sh`（只改源码不构建等于没改），后端改完重启服务。
3. 自己验证（cookie + 无头浏览器，见技能），然后写 `AI_CHANGES.md`：时间 / 改动 / 原因 / 效果 / 验证 / 注意点。
