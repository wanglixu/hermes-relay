# Hermes Relay

给 [Hermes Agent](https://hermes-agent.nousresearch.com/docs) 做的网页聊天前端：**一个进程、几个 Python 文件 + 一个 Next.js 前端**，看得懂、改得动。和上游 `hermes-webui`（两万行路由的那种大项目）不同，它是同一套 agent 运行时的轻量入口。

> **前提：本机要有一份能跑的 Hermes Agent。** 后端不是通过 HTTP 调 Hermes，而是用 Hermes 自带的 Python 在**同一个进程里**直接构造 `AIAgent` —— 这正是它的核心设计（换来工具审批、模型反问、进程内回调这些只有同进程才有的能力），不是可以绕开的依赖。

---

## 它是什么

- **进程内直连 agent**：服务用 Hermes 自带的 Python 启动，直接 `import run_agent.AIAgent` 在同一个进程里跑，不经过网关的 HTTP API。所以没有额外请求开销。
- **和 CLI / Telegram 是同一个 Hermes**：同一份 `~/.hermes/config.yaml`、同一套技能、同一份记忆。
- **聊天记录落在 Hermes 自己的会话库里**（`~/.hermes/state.db`）。网页里聊的会话，`hermes --resume` 也能接着聊；反过来 CLI 的会话也会出现在网页侧栏。
- **以「会话」为单位**，没有项目 / 工作区那一套。

## 架构

```
浏览器 ──SSE──▶ server.py ──▶ agent_bridge.py ──▶ AIAgent（同进程）
                    │                                  ▲
                    └──▶ sessions.py ──▶ Hermes state.db
```

nginx 按路径分两路：`/api/` 进后端（8788），页面与前端资源（`/`、`/_next/static/`）进前端（3220）。

| 文件 | 干什么 |
| --- | --- |
| `server.py` | 标准库 HTTP 服务：路由、SSE、附件上传、静态回退 |
| `agent_bridge.py` | 解析模型渠道 → 构造 AIAgent → 跑一轮 → 回调转事件；审批 / clarify 桥、生成中插话 |
| `sessions.py` | 会话列表 / 历史 / 新建 / 改名 / 删除（读写 Hermes 自己的库）、展示窗口、图片记录 |
| `compress.py` | 手动压缩上下文（同步压，几十秒） |
| `context.py` | 上下文用量估算 + 技能清单（输入框 `/` 菜单） |
| `web/` | Next.js 16（App Router）+ Tailwind v4，standalone 构建 |
| `static/` | 早期 Vite 版本的残留产物，后端仍能吐，生产已不用 |
| `design-system/hermes-relay/MASTER.md` | UI 设计系统（配色 / 字体 / 间距），改界面前先看它 |
| `deploy/` | systemd 单元 + nginx 站点配置（线上实际配置以 `/etc/nginx/sites-available/` 为准） |

数据目录 `~/.hermes/hermes-relay/`：`uploads/`（附件及其 `index.json`）、`metrics.json`（首字延迟 / 耗时 / 输出 token 埋点）、`partials.json`、`compactions.json`、`memory-backups/`。

## 跑起来

```bash
# 后端（systemd，生产）
systemctl status|restart hermes-relay
journalctl -u hermes-relay -f

# 后端手动跑（调试用）
cd /opt/hermes-relay
/usr/local/lib/hermes-agent/venv/bin/python server.py

# 前端（systemd，生产）
systemctl status|restart hermes-relay-web
```

> **后端必须用 `/usr/local/lib/hermes-agent/venv/bin/python`**，不能用系统 python3——进程内要 import Hermes 的运行时。

环境变量见 [`.env.example`](.env.example)：**全部可选**，不设就走默认值（监听 `127.0.0.1:8788`、会话库取 Hermes 自己的 `~/.hermes/state.db`）。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 存活检查 |
| GET | `/api/config` | 当前解析出的模型 / 渠道 |
| GET | `/api/skills` | 技能清单（输入框 `/` 菜单用它） |
| GET | `/api/chats?limit=&offset=&q=` | 会话列表（`q` 是侧栏搜索，默认 50 条、可翻页） |
| POST | `/api/chats` | 新建会话 → `{id}` |
| GET | `/api/chats/<id>?turns=&before=` | 会话详情 + 展示窗口（分段加载 + 「展开更早」） |
| GET | `/api/chats/<id>/stream?after=N` | SSE 补发（刷新后接上正在跑的这轮） |
| GET | `/api/chats/<id>/context` | 上下文用量 |
| GET | `/api/uploads/<会话>/<文件>` | 取回已上传的图片 |
| POST | `/api/chats/<id>/turn` | **发一条消息，SSE 流式返回**（body `{text, attachments:[{path,mime}]}`） |
| POST | `/api/chats/<id>/interrupt` | 打断当前这一轮 |
| POST | `/api/chats/<id>/steer` | 生成中插话（body `{text}`） |
| POST | `/api/chats/<id>/compress` | 手动压缩上下文（body `{focus?}`，同步返回） |
| PATCH | `/api/chats/<id>` | 改名（body `{title}`） |
| DELETE | `/api/chats/<id>` | 删除（物理删除，不可逆） |
| POST | `/api/approvals` | 审批答复（body `{session_id, request_id, choice}`，choice = `once/session/always/deny`） |
| POST | `/api/clarify` | 回答模型的反问（body `{session_id, clarify_id, response}`） |
| POST | `/api/upload?session=&name=` | 上传附件（原始字节）→ `{path,name,mime}` |
| POST | `/api/admin/restart` | 让后端在答完当前这轮后自动重启（无 body） |

SSE 事件类型：`delta`（正文增量）、`reasoning`（思考增量）、`tool_start` / `tool_end` / `tool`（工具）、`status`（生命周期）、`approval`（要你授权）、`clarify` / `clarify_end`（模型反问）、`error`、`done`（带用量）、`eof`（这一轮结束）。

## 改前端

前端在 `web/`（Next.js 16，standalone）。

```bash
cd web
npm run dev                    # 开发服务器，127.0.0.1:3220
bash scripts/dev-restart.sh    # 构建 + 拷进 standalone + 重启本机自测
```

> **只改源码不构建等于没改**：生产跑的是 `web/.next/standalone` 的产物，改完必须跑一次 `dev-restart.sh`（或走 CI）。
> 静态资源文件名带内容哈希，正常不会拿到旧版；如果前面挂了 CDN 并且按路径缓存，记得让 HTML 走 `no-store`。

样式令牌（颜色、间距、字体）全部来自 `design-system/hermes-relay/MASTER.md`，改配色请改那里的 CSS 变量，不要在组件里写死颜色。

## 改后端

改完要重启才会生效。**不要用定时器，也不要在 relay 托管的会话里 `systemctl restart`**——服务的 `KillMode=control-group` 会连执行者一起杀掉。正路是 `POST /api/admin/restart`：它只写一个标记文件，等服务把当前这一轮答案完整发完（`eof` 之后）再自己重启，不用掐表等。

## 几个刻意的设计（别改坏了）

1. **不用 FastAPI**：进程内必须跑在 Hermes 自带的 Python 环境里，往那个环境装第三方包等于动 Hermes 自己的依赖树，升级还可能被冲掉。标准库 `ThreadingHTTPServer` + SSE 完全够用。
2. **不高频打扰 agent**：浏览器不轮询，所有更新靠 SSE 单向推；会话列表和历史消息直接读 SQLite；一条消息只跑一次 agent；标题不调用模型生成。
3. **流式性能**：token 先攒进 `useRef`，每 80ms 才刷一次 React state；消息组件 memo 化，只有正在输出的那条会重渲染。不要改成「每个 token 一次 setState」。
4. **自动吸底**：只有当用户本来就贴着底部时才自动滚，往上翻过就不抢滚动位置（`stick` ref）。
5. **审批不能省**：agent 要执行命令时会在自己的线程里阻塞等待。网页弹确认卡片 → `POST /api/approvals` → 解除阻塞。这是安全相关的，不是可选项。

## 已知限制

- **一个会话同时只能跑一轮**（Hermes 的跨进程 turn lease）。同一会话在别的入口（CLI / 上游 webui / Telegram）正跑着时，这里新开的一轮会等那边的会话锁，界面上表现为一直转圈。
- **模型和渠道在进程启动时解析一次并缓存**，改了 `config.yaml` 要重启后端。
- **侧栏列的是 Hermes 里所有 `webui / cli / telegram / discord / slack / api_server` 会话**——共用历史的代价。想只看某一类，改 `sessions.py` 里的 `LISTED_SOURCES`。
- **附件只存文件、不进消息正文**：发出去的图片刷新后靠后端 uploads 记录（按时间戳 ±120 秒匹配）恢复显示，能看；但附件本身不能再编辑，关联也依赖时间戳。
- **主要面向 Chrome 桌面端**：部分动效用了 Chrome 较新的特性（`@starting-style` 等），Safari / Firefox 上会优雅退化。
- **会话删除是物理删除，不可逆**。库没被 `VACUUM` 过时，误删的内容还能从空闲页里捞回来（见下）。

## 验证脚本

```bash
# 一轮纯文字（命令行跑，不开服务）
/usr/local/lib/hermes-agent/venv/bin/python scripts/smoke_turn.py "只回复两个字：收到"

# 原生识图：现造一张左红右蓝的图，看模型认不认得出
/usr/local/lib/hermes-agent/venv/bin/python scripts/smoke_image.py

# 后端接口回归（跨站拦截、参数校验等）
/usr/local/lib/hermes-agent/venv/bin/python scripts/verify_hardening.py

# 误删会话抢救（先拷库副本再跑）
/usr/local/lib/hermes-agent/venv/bin/python scripts/recover_deleted_session.py --db <库副本> --sid <会话id> --markdown x.md
```

## 部署（从零到能打开）

前置：本机已有能跑的 Hermes Agent、Node 20.9+（Next.js 16 的要求）、nginx，以及 `7z`（生成字体用，`apt install p7zip-full`）。

```bash
# 1. 拿代码（路径随你，示例用 /opt/hermes-relay）
git clone <本仓库地址> /opt/hermes-relay && cd /opt/hermes-relay

# 2. 生成自托管字体（字体文件不进仓库，新环境必须先跑；约 15 分钟）
web/scripts/fetch-fonts.sh

# 3. 构建前端：产物落在 web/.next/standalone，生产跑的就是它
cd web && npm ci && npm run build
cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/   # standalone 不含静态资源，要手动拷

# 4. 试跑后端（必须用 Hermes 自带的 Python）
cd /opt/hermes-relay && /usr/local/lib/hermes-agent/venv/bin/python server.py
curl -s http://127.0.0.1:8788/api/health     # 期望 {"ok": true}

# 5. 装成 systemd 服务（先按实际路径改两个单元文件）
sudo cp deploy/hermes-relay.service deploy/hermes-relay-web.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now hermes-relay hermes-relay-web

# 6. nginx：拷 deploy/nginx-relay.conf 到 sites-available，改 server_name 和证书路径后 reload
```

要点：

- **字体**：中英文字体（Source Sans 3 / Noto Sans SC / Sarasa Mono SC）都是自托管并按 `unicode-range` 切片，**文件本身不入库** —— 所以新环境构建前必须先跑 `web/scripts/fetch-fonts.sh`，否则 `next build` 会在找字体那一步失败。
- **路由分流**：`/api/` → 后端 8788 且 `proxy_buffering off`（否则 SSE 的字会被攒住、看着像「一下子全蹦出来」）；`/` 与 `/_next/static/` → 前端 3220。
- **登录/鉴权**：本项目不做登录，默认假设它只监听回环或前面有别的网关。参考配置里那段 `site-auth`（`auth_request` 指向 `127.0.0.1:3190`）是自建 cookie 网关的可选接法 —— 不需要就整段删掉。
- **缓存**：HTML 与 `/api/` 必须 `private, no-store`，否则改了界面看不到新版；带内容哈希的 `/_next/static/` 可以放心长缓存。
- **Cloudflare（可选）**：用它的话别让它缓存 HTML，并让 nginx 信任它的真实 IP 段（参考配置里已有 `set_real_ip_from`）。
- **改完后端重启**：走 `POST /api/admin/restart`，别用 `systemctl restart`（见上一节）。
