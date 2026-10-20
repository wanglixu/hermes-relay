<div align="center">

# Hermes Relay

**给 [Hermes Agent](https://hermes-agent.nousresearch.com/docs) 打造的轻量级无头进程内网页外壳（Thin Shell）**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16.4-black?logo=next.js)](https://nextjs.org/)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white)](https://python.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38B2AC?logo=tailwind-css)](https://tailwindcss.com/)
[![Design System](https://img.shields.io/badge/Theme-Warm%20Paper-D97706)](design-system/hermes-relay/MASTER.md)

<br />

<a href="https://wanglixu.github.io/hermes-relay/"><img src="https://img.shields.io/badge/Live_Demo-%E5%9C%A8%E7%BA%BF%E6%BC%94%E7%A4%BA-8c5a3b?style=for-the-badge&logo=githubpages&logoColor=white" alt="打开在线演示" height="36" /></a>

<br />

[English Documentation](README.en.md) · [UI 规范](PRODUCT.md) · [设计系统](design-system/hermes-relay/MASTER.md) · **[:point_right: 在线演示](https://wanglixu.github.io/hermes-relay/)**

<br />

<img src="docs/images/chat-overview.png" alt="Hermes Relay 核心聊天主界面" width="100%" style="border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.08);" />

</div>

<br />

## 🧪 先试试：静态在线演示

不想先跑起来？**[:point_right: 在线演示](https://wanglixu.github.io/hermes-relay/)** 是 `web/` 这份前端源码的
**静态导出**（`output: 'export'`），只把数据源换成了浏览器里的假后端 —— **不需要 Python、不需要模型、不需要密钥**。
渲染逻辑一行没改：折叠动画、Markdown、设置弹层、工作台四个视图全是线上那份代码。

- 对话：会话列表 / 搜索 / 按日期分组 / 子代理折叠 / 重命名删除；「思考 → 工具 → 审批 → 正文」的完整流式过程，含实时 `≈ tok/s` 与首字时间
- 卡片：权限审批（要做什么 / 风险 / 命令原文 / 四个选项）与模型反问（选项 + 推荐 + 跳过）
- 设置：模型与渠道管理、记忆 / 用户档案 / 人格三份文件、外观
- 工作台：任务看板、后台进程与控制台、定时任务、产物沙箱

数据全部虚构（`demo/demo-mock.ts`）：拦截 `/api/**` 与 `/local-api/**`，返回真实接口的数据结构，
`/turn` 回的是一条真 SSE（ReadableStream），事件顺序与 `server.py` 发出的完全一致。
想改演示内容就改那份文件，再跑 `bash demo/build-demo.sh` 重新导出。

> 演示站不带 32MB 的更纱黑体（等宽退回系统字体），拉丁与思源黑体是自托管的。

---

## 📖 核心理念

Hermes Relay 不重复制造 Agent，也不另立数据中心：模型调用、工具执行、审批阻断、技能、长期记忆、会话存储与上下文压缩，**全部直接复用 Hermes 运行时**。

本项目专注做好三件事：
1. **进程内同构直连**：后端 Python 服务直接跑在 Hermes 运行环境中，同进程构造 `AIAgent` 实例。工具执行回调、安全审批挂起、模型主动反问（Clarify）在进程内毫秒级响应，无需在多层代理之间跨网络重传上下文。
2. **零第三方 Python 依赖**：后端纯使用 Python 标准库（`ThreadingHTTPServer` + SSE 流式管道），绝不往 Hermes 环境安装外部包，长期跟随 Hermes 上游升级无破坏。
3. **沉浸式现代交互界面**：Next.js 16 + Tailwind v4 打造的「暖纸」（Warm Paper）视觉系统，针对高密度技术对话调校字阶、中英文排版与代码高亮，附带多渠道聚合管理与一体化工作台。

---

## ✨ 核心特性

### 💬 智能对话与流式推理
- **思考过程与工具调用折叠**：区分正文流与思维链（Chain of Thought），支持工具调用参数与返回结果的分段收合查看。
- **同进程审批闸门（Approval Card）**：Agent 请求执行 Shell 命令或写入系统文件时，实时弹出原生授权卡片（单次允许 / 当前会话 / 总是允许 / 拒绝）。
- **模型主动反问（Clarify）**：交互式选项与自由输入，无缝桥接多轮决策意图。
- **会话中插话（Steer）与中断（Interrupt）**：生成期间可随时下发指令纠偏，或精准停止流式输出。
- **性能指标看板**：每轮回复实时追踪首字延迟（TTFT）、真实解码速度（Tok/s）与生成用时。
- **权威上下文计量**：用量环与压缩阈值直连 Hermes 核心解析器，精准显示当前模型的前缀缓存命中率。

<br />

### 🎛️ 多渠道与模型聚合管理
<div align="center">
  <img src="docs/images/model-picker.png" alt="模型与渠道选择面板" width="85%" style="border-radius: 6px; box-shadow: 0 2px 12px rgba(0,0,0,0.06);" />
</div>

- **即时聚合任何 OpenAI 兼容端点**：输入 Base URL + API Key 自动拉取全量模型列表，支持随时同步更新与删除。
- **五档思考强度切换**：支持对支持 Reasoning 的模型按轮次调整思考强度（关闭、低、中、高、极高），下一轮对话立刻生效，无需重启服务。
- **独立配置隔离**：所有在页面中管理的自定义渠道与模型存储在 `~/.hermes/hermes-relay/models.json`，**不修改 Hermes 全局的 `config.yaml`**，命令行、微信与 Telegram 客户端互不干扰。

<br />

### 🛠️ 一体化工作台（Workbench）
<div align="center">
  <img src="docs/images/workbench-kanban.png" alt="工作台任务看板" width="85%" style="border-radius: 6px; box-shadow: 0 2px 12px rgba(0,0,0,0.06);" />
</div>

- **任务看板（Kanban）**：基于 SQLite 持久化本地落地，自由流转待办、进行中与已完成任务。
- **定时任务（Cron）**：直接读取并控制 Hermes 的定时触发器（`~/.hermes/cron/jobs.json`），支持一键手动试跑与状态开关。
- **后台进程监控**：实时呈现主机进程资源占用与 Hermes 守护状态。
- **产物沙箱（Artifacts）**：直接浏览与取回 Agent 在工作区生成的代码文件与成果。

<br />

### ⚙️ 设置与持久化记忆管理
<div align="center">
  <img src="docs/images/settings.png" alt="设置与自定义模型管理" width="85%" style="border-radius: 6px; box-shadow: 0 2px 12px rgba(0,0,0,0.06);" />
</div>

- **模型参数覆写**：支持单独修改任意模型的展示名、真实上游 ID 以及自定义上下文窗口上限。
- **记忆三件套编辑**：在线检查与编辑 `memory`、`user`、`soul`，修改时自动建立滚动快照备份（自动保留最近 20 份版本）。
- **字体与设计系统**：全站内置 Source Sans 3、Noto Sans SC 与更纱黑体（Sarasa Mono SC）分片字体，针对代码对齐与中英混排深度调校。

---

## 🏗️ 架构拓扑

```
浏览器 (Next.js 16 WebUI)
   │
   ├── [HTTP / SSE 流] ──▶ server.py (8788, 纯标准库)
   │                           │
   │                           ├──▶ agent_bridge.py
   │                           │       │
   │                           │       └──▶ AIAgent (同进程 Hermes 运行时)
   │                           │
   │                           ├──▶ sessions.py ──▶ ~/.hermes/state.db
   │                           ├──▶ models.py   ──▶ ~/.hermes/hermes-relay/models.json
   │                           └──▶ workbench_api.py ──▶ kanban.db / cron / 进程
   │
   └── [静态资源 / 前端] ──▶ Next.js Standalone (3220)
```

Nginx 在前端充当反向代理与网关：
- `/api/` 路由直连 Python 后端（`8788`），关闭缓冲（`proxy_buffering off`）以保障 SSE 流式极速出字。
- `/`、`/_next/static/` 及其他前端静态资源转发至 Next.js Standalone 服务（`3220`）。

---

## 🚀 快速上手

### 环境要求
- 已正确配置并能运行的 [Hermes Agent](https://hermes-agent.nousresearch.com/docs)
- Node.js 20.9+
- Nginx（推荐生产反代）
- `p7zip-full`（用于自托管字体切片解压，`sudo apt install p7zip-full`）

### 1. 克隆代码
```bash
git clone https://github.com/wanglixu/hermes-relay.git /opt/hermes-relay
cd /opt/hermes-relay
```

### 2. 准备自托管字体分片
项目采用无外部 CDN 的自托管中英文与等宽字体，新环境需首先运行字体拉取脚本（初次下载并生成约需数分钟）：
```bash
bash web/scripts/fetch-fonts.sh
```

### 3. 构建前端
```bash
cd web
npm ci
npm run build

# Standalone 部署模式需要拷贝静态资源目录
cp -r .next/static .next/standalone/.next/
cp -r public .next/standalone/
cd ..
```

### 4. 试运行后端服务
> **注意**：必须使用 Hermes Agent 自带的 Python 环境启动后端，以确保能够在进程内直接导入 Hermes 的运行时模块。

```bash
/usr/local/lib/hermes-agent/venv/bin/python server.py
# 另开终端验证存活探针：
curl -s http://127.0.0.1:8788/api/health
# 期望返回: {"ok": true}
```

### 5. 部署 Systemd 服务
参考并根据实际目录调整 `deploy/` 下的系统单元：
```bash
sudo cp deploy/hermes-relay.service /etc/systemd/system/
sudo cp deploy/hermes-relay-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hermes-relay hermes-relay-web
```

### 6. 配置 Nginx 反向代理
将 `deploy/nginx-relay.conf` 复制到 `/etc/nginx/sites-available/`，配置您的域名与证书后重载：
```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## 📡 后端 API 接口契约

| 方法 | 接口路径 | 说明 |
| :--- | :--- | :--- |
| `GET` | `/api/health` | 存活健康检查 |
| `GET` | `/api/config` | 获取当前解析出的主模型与配置 |
| `GET` | `/api/models` | 可选模型、自定义渠道清单、当前激活项与思考档位 |
| `POST` | `/api/models/select` | 切换当前模型或调整思考强度（`{key?, effort?}`） |
| `POST` | `/api/models/test` | 连通性测试并探寻该端点支持的模型列表 |
| `POST` | `/api/models/add` | 新增单个自定义模型端点 |
| `POST` | `/api/models/update` | 修改自定义模型的真实 ID、名称或上下文窗口 |
| `POST` | `/api/models/remove` | 移除自定义模型 |
| `POST` | `/api/channels/add` | 接入并枚举一个 OpenAI 兼容渠道 |
| `POST` | `/api/channels/sync` | 重新同步指定渠道的模型列表 |
| `POST` | `/api/channels/remove` | 移除指定渠道 |
| `GET` | `/api/chats?limit=&offset=&q=` | 分页与全文检索历史会话列表 |
| `POST` | `/api/chats` | 预分配会话 ID（**懒创建模式**：仅发首条消息时落库） |
| `GET` | `/api/chats/<id>?turns=&before=` | 获取会话展示窗口（支持增量拉取历史） |
| `GET` | `/api/chats/<id>/stream?after=N` | SSE 断线重连与事件补发机制 |
| `GET` | `/api/chats/<id>/context` | 当前会话的权威上下文用量与缓存命中率 |
| `POST` | `/api/chats/<id>/turn` | **发起对话轮次**（SSE 流式实时推流） |
| `POST` | `/api/chats/<id>/interrupt` | 即时打断当前生成轮次 |
| `POST` | `/api/chats/<id>/steer` | 生成中下发插话指令（中途动态修正模型方向） |
| `POST` | `/api/chats/<id>/compress` | 手动执行上下文摘要压缩（支持焦点引导） |
| `PATCH` | `/api/chats/<id>` | 重命名会话标题 |
| `DELETE` | `/api/chats/<id>` | 彻底物理删除会话 |
| `POST` | `/api/approvals` | 审批答复（`once` / `session` / `always` / `deny`） |
| `POST` | `/api/clarify` | 响应模型的决策反问 |
| `POST` | `/api/upload?session=&name=` | 附件与图片上传（支持原生多模态识别） |
| `GET` | `/api/kanban/tasks?status=` | 工作台任务看板 CRUD |
| `GET` | `/api/cron/jobs` | 定时任务列表与开关调度 |
| `GET` | `/api/system/processes` | 主机进程与 Hermes 运行状态监控 |
| `POST` | `/api/admin/restart` | **优雅重启指令**：等待当前轮次安全结束后排队重启服务 |

---

## 💡 核心设计与考量

1. **同进程回调与异步转接**：
   `agent_bridge.py` 内部维护了阻塞队列与事件订阅。当 Agent 触发工具执行需要用户确认时，Worker 线程在内存中安全挂起，直到前端通过 `/api/approvals` 发出回调解除阻塞，避免了跨网络长轮询的不可靠状态。
2. **渐进式懒创建（Lazy Creation）**：
   点击“新建会话”仅在前端预置临时 Draft ID，绝不预先向数据库写入空条目。只有当用户真正发出第一句消息时才落库持久化，防止历史侧栏残留大量空白对话。
3. **流式节流与零卡顿渲染**：
   在前端 `use-turn-stream.ts` 中，SSE 高频推送的 Delta 片段首先暂存于 `useRef` 缓冲区，每 80ms 批量同步一次 React 渲染树；同时对非活动消息应用严格的 `memo` 保护，即使千字长文在低配设备上依然保持丝滑流畅。
4. **900ms 停止守卫（Stop Guard）**：
   解决用户因快速连击发送键导致“误触新生成的停止键”而中断会话的常见交互痛点。

---

## 📄 许可证

本项目基于 [MIT 许可证](LICENSE) 开源。欢迎参与贡献与二次开发！
