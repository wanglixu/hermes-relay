# Hermes Relay — 给 AI 的项目约定

给 [Hermes Agent](https://hermes-agent.nousresearch.com/docs) 做的轻量网页外壳：同一份会话库
（`~/.hermes/state.db`）、同一套技能与记忆。后端 `server.py`（8788），前端 `web/`（3220）。

**怎么跑、接口表、二次开发看 `README.md`；产品意图与取舍看 `PRODUCT.md`。**

## 红线

1. **删会话是不可逆的物理删除**。脚本清理测试会话只能删自己 `POST /api/chats` 返回的 id；
   认领不到就跳过——绝不许拿「列表最新一条」当自己的会话（用户正在聊的就是最新一条）。
2. **别在它托管的会话里停/重启它自己**（systemd 的 `KillMode=control-group` 会连执行者一起杀）。
   后端重启走 `POST /api/admin/restart`：写完标记文件，等这一轮答完再自己重启。
3. **后端不能装第三方 Python 包**：它跑在 Hermes 自带的 venv 里，装包等于动 Hermes 的依赖树。
   后端只能用标准库 + Hermes 自己的模块。
4. **仓库是公开的**：密钥、密码、token、cookie 不进代码、日志、提交信息。
5. **界面改动走 `design-system/` 的规范**，不凭个人审美另起一套。

## 改一处

1. 改代码。前端改完必须构建（`bash web/scripts/dev-restart.sh`，只改源码不构建等于没改）；
   后端改完重启服务（走 `POST /api/admin/restart`）。
2. 自己先验证——无头浏览器把关键路径跑一遍，别拿半成品让人验收。
3. 有变动就同步文档：接口表 / 已知限制（`README.md`）、产品口径（`PRODUCT.md`）。
