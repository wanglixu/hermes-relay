'use client'

/**
 * 静态演示用的「假后端」。
 *
 * 它只做一件事：在浏览器里把 /api/** 与 /local-api/** 接管掉，返回真实接口的
 * 数据结构；`/turn` 这类流式接口返回一条真正的 SSE（ReadableStream），
 * 事件顺序与后端 server.py + agent_bridge.py 发出的完全一致。
 *
 * 因此：页面、组件、折叠动画、Markdown、设置弹层、工作台四个视图，
 * 全部跑的是线上那份代码，一个渲染逻辑都没有重写。
 *
 * 真实项目的入口在 server.py；这份文件只在 `NEXT_PUBLIC_DEMO=1` 的静态构建里
 * 被 app/layout.tsx 引入（见 scripts/build-demo.sh）。
 */

import type {
  ArtifactFile,
  Chat,
  ClarifyQuestion,
  ContextStats,
  CronJob,
  KanbanTask,
  MemoryFile,
  ModelsPayload,
  Msg,
  Part,
  ProcessItem,
  Skill,
  TurnEvent,
} from './api'

/* ───────────────────────────── 小工具 ───────────────────────────── */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const nowSec = () => Math.floor(Date.now() / 1000)
const today = (minsAgo: number) => nowSec() - minsAgo * 60

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

const ok = (extra: Record<string, unknown> = {}) => json({ ok: true, ...extra })

/** 一张收据图（内联 SVG，不用外部资源） */
const RECEIPT =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="460" viewBox="0 0 360 460">
<rect width="360" height="460" fill="#f4f1e8"/><rect x="28" y="24" width="304" height="412" fill="#fffdf6" stroke="#e2ddd0"/>
<g fill="#cfc9ba" font-family="monospace" font-size="13">
<text x="56" y="70" font-size="17" fill="#8c5a3b">SUPERMARKET</text><text x="56" y="96">2026-10-18  19:24</text>
<text x="56" y="126">牛乳            ¥ 218</text><text x="56" y="150">卵 10個         ¥ 298</text>
<text x="56" y="174">食パン          ¥ 178</text><text x="56" y="198">野菜セット      ¥ 398</text>
<text x="56" y="222">洗剤            ¥ 248</text><text x="56" y="258" fill="#2d2d2a">合計            ¥ 1,340</text>
<text x="56" y="286">(内消費税 ¥ 121)</text></g>
<rect x="56" y="320" width="248" height="1" fill="#e2ddd0"/>
<g fill="#cfc9ba" font-family="monospace" font-size="12"><text x="56" y="346">PayPay  残高決済</text><text x="56" y="362">承認番号 8842-1190</text></g>
<rect x="228" y="380" width="76" height="30" fill="none" stroke="#b8a894"/><text x="240" y="400" font-family="monospace" font-size="11" fill="#b8a894">PAID</text></svg>`,
  )

/* ───────────────────────────── 会话假数据 ───────────────────────────── */

type DemoChat = Chat & { messages: Msg[] }

const ANSWER_TPS = `## 为什么要收成一行

思考动辄几千字，直接铺开会把回答整个淹掉。答完之后把「思考行 / 工具行」按顺序打包成**一颗胶囊**，
只报数量；点开还是原来的内容，位置也没变：

- 收起用 \`height\` 过渡（120–150ms ease-out），不用 \`display: none\` —— 布局缓存留着，30 个块也只要约 5ms
- 展开时同帧改 \`scrollTop\`，块不会「往上跳」
- 正文不参与折叠，按原顺序照旧铺开

\`\`\`js
// 高度与滚动补偿在同一帧里写，避免逐帧过冲
box.scrollTop -= startTop - el.getBoundingClientRect().top
\`\`\`

### tok/s 的两个口径

| 位置 | 算法 | 说明 |
| --- | --- | --- |
| 生成中 | 片段数 ÷ 收字秒数 | 前面带 \`≈\`，就是真实解码速度 |
| 答完后 | \`out_tokens ÷ gen_seconds\` | 分子含工具参数的 token，读数偏高 |

细节都在 web/components/chat/messages.tsx 里。实测对账：纯文字 767 个片段 = \`usage\` 的 768
completion_tokens，所以**1 片段 ≈ 1 token**；偏高的是定稿值，因为工具参数不走流式回调，
分母里没有对应的时间。

> 一句话：生成中看趋势，答完后看成本，两个数不要互相校准。`

const CHATS: DemoChat[] = [
  {
    id: 'c1',
    title: '折叠动效与 tok/s 口径',
    source: 'webui',
    model: 'deepseek-v4.1-flash',
    message_count: 2,
    last_active: today(38),
    preview: '回复里的思考块和工具调用，为什么答完要收成一行？',
    messages: [
      {
        role: 'user',
        ts: today(41),
        text: '回复里的思考块和工具调用，为什么答完要收成一行？顺便说下 tok/s 到底怎么算的。',
      },
      {
        role: 'assistant',
        ts: today(38),
        elapsed: 72.4,
        ttft: 0.86,
        out_tokens: 4390,
        gen_seconds: 70.8,
        parts: [
          {
            kind: 'reason',
            text: '用户问两件事：一是答完后「思考 / 工具」为什么收成一行胶囊，二是 tok/s 的口径。前者要解释折叠为什么会把答案淹掉，后者要区分「生成中」和答完后的两个数——这两者分母不同，混着说会被追问。先看一遍实现，再回答。',
          },
          {
            kind: 'tool',
            name: 'read_file',
            brief: 'web/components/chat/messages.tsx',
            args: '{"path": "web/components/chat/messages.tsx", "limit": 120}',
            result: '（已读取 731 行）LeadingChain / intoGroups / Tail 三个函数与折叠逻辑都在这里。',
            done: true,
          },
          {
            kind: 'tool',
            name: 'terminal',
            brief: 'grep -n "tok/s" hooks/use-turn-stream.ts',
            args: '{"command": "grep -n \\"tps\\\\|片段\\" web/hooks/use-turn-stream.ts", "workdir": "~/workspace/hermes-relay"}',
            result: '41: const tps = (chunks / Math.max(0.4, genSeconds))\n88: // 实时值只按本轮收到的片段数估，不乘历史比例',
            done: true,
          },
          { kind: 'text', text: ANSWER_TPS },
        ],
      },
    ],
  },

  {
    id: 'c2',
    title: '网关日志按密钥筛选',
    source: 'webui',
    model: 'deepseek-v4.1-flash',
    message_count: 2,
    last_active: today(155),
    preview: '管理后台的请求日志，能按密钥筛选吗？',
    messages: [
      { role: 'user', ts: today(158), text: '管理后台的请求日志，能按密钥筛选吗？现在只能看全部。' },
      {
        role: 'assistant',
        ts: today(155),
        elapsed: 41.2,
        ttft: 1.24,
        out_tokens: 1830,
        gen_seconds: 39.6,
        parts: [
          {
            kind: 'reason',
            text: '这是给自建网关加一个筛选维度。先确认日志里有没有记录 key，再决定是前端过滤还是后端过滤——日志是 JSONL，按行扫一遍就能同时产出统计，不必专门建索引。',
          },
          { kind: 'tool', name: 'read_file', brief: 'main.go（日志结构与统计聚合）', args: '{"path": "main.go", "limit": 200}', done: true },
          {
            kind: 'text',
            text: `可以。日志每条都带 \`key_id\`，所以**按密钥筛选只是多一个维度的聚合**，不需要改写入格式。

1. 后端：读日志时按 \`key_id\` 分组，一次扫描同时产出「每小时请求数」「每日 token 数」和「按密钥汇总」
2. 前端：表格上方加一个下拉，选中后 URL 带上 \`?key=\`，刷新不会丢筛选
3. 空态：该密钥还没有请求时显示「这段时间没有记录」，而不是空表格

\`\`\`go
type Bucket struct {
    Hour   int            \`json:"hour"\`
    Reqs   int            \`json:"reqs"\`
    Tokens map[string]int \`json:"tokens"\` // key_id → token 数
}
\`\`\`

验证方式：拿生产日志的副本跑一遍聚合，把「各密钥之和」和「总条数」对账；再在页面上切换两个密钥，
确认请求条数跟 \`grep -c\` 的结果一致。`,
          },
        ],
      },
    ],
  },

  {
    id: 'c3',
    title: '磁盘告警排查',
    source: 'telegram',
    model: 'deepseek-v4.1-flash',
    message_count: 2,
    last_active: today(60 * 26),
    preview: '服务器又提示磁盘快满了，帮我看看是哪块长的',
    agents: [
      { id: 'a1', state: 'completed', goal: '找出 /var 里增长最快的目录', seconds: 12 },
      { id: 'a2', state: 'completed', goal: '核对 journald 的保留策略', seconds: 8 },
      { id: 'a3', state: 'in_progress', goal: '评估清理脚本的影响范围', seconds: null },
    ],
    compactions: [{ at: today(60 * 30), before_tokens: 142000, after_tokens: 31000, seconds: 38.5 }],
    messages: [
      { role: 'user', ts: today(60 * 26), text: '服务器又提示磁盘快满了，帮我看看是哪块长的，别动生产数据。' },
      {
        role: 'assistant',
        ts: today(60 * 26),
        elapsed: 58.9,
        ttft: 2.1,
        out_tokens: 2980,
        gen_seconds: 56.4,
        parts: [
          {
            kind: 'reason',
            text: '先量再动。只看总量没意义，要按目录找出增长点；然后判断是日志、备份还是镜像缓存。清理方案先不动手，因为删文件不可逆，需要用户点头。',
          },
          {
            kind: 'tool',
            name: 'terminal',
            brief: 'df -h / && du -xh --max-depth=1 /var',
            args: '{"command": "df -h / | tail -1 && du -xh --max-depth=1 /var 2>/dev/null | sort -h | tail -6"}',
            result:
              'Filesystem  Size Used Avail Use%\n/dev/sda1    98G  91G  6.6G  94%\n\n18G  /var/log\n4.1G /var/lib/docker\n1.8G /var/backups',
            done: true,
          },
          {
            kind: 'text',
            text: `## 结论

**\`/var/log\` 吃掉了 18G**，其中 \`journald\` 占了 12G —— 没有设置上限，一直按天累积。

### 建议按这个顺序处理

- 先给 journald 设上限：\`SystemMaxUse=1G\`，它会自己回收，不用手动删
- 再看 \`/var/log/app/*.log\`：有 4.3G 是三个月前的构建日志，可以清
- \`docker\` 的 4.1G 里有 2.7G 是悬空镜像，\`docker image prune\` 就能回收

> 清理脚本需要你确认后才会执行，我不会擅自动生产目录。`,
          },
        ],
      },
    ],
  },

  {
    id: 'c4',
    title: '这张收据帮我记一笔',
    source: 'webui',
    model: 'deepseek-v4.1-pro',
    message_count: 2,
    last_active: today(60 * 24 * 3),
    preview: '刚买的东西，帮我记进账本，分类你看着办。',
    messages: [
      { role: 'user', ts: today(60 * 24 * 3), text: '刚买的东西，帮我记进账本，分类你看着办。', images: [RECEIPT] },
      {
        role: 'assistant',
        ts: today(60 * 24 * 3),
        elapsed: 22.6,
        ttft: 1.05,
        out_tokens: 960,
        gen_seconds: 21.4,
        parts: [
          {
            kind: 'reason',
            text: '收据上是五件日用品和食品，总额 1,340 日元，含税 121。按记账 App 的分类规则，食品和日用品应该拆开或归到「日用」。金额和日期都能读到，但分类有多种合理选择，先给一个默认，再让用户确认。',
          },
          { kind: 'tool', name: 'read_image', brief: '识别收据金额与日期', args: '{"path": "uploads/c4/receipt-1932.jpg"}', done: true },
          {
            kind: 'text',
            text: `识别到一笔支出：

- 金额：**¥1,340**（含税 ¥121）
- 日期：2026-10-18 19:24
- 商家类型：超市（食品 + 日用品）

我按「日用」先记了。如果要拆成「食品 / 日用」两笔，告诉我比例就行。`,
          },
        ],
      },
    ],
  },

  {
    id: 'c5',
    title: '苏州还是广州',
    source: 'webui',
    model: 'deepseek-v4.1-flash',
    message_count: 2,
    last_active: today(60 * 24 * 12),
    preview: '几年后回国，苏州和广州选哪个？',
    messages: [
      { role: 'user', ts: today(60 * 24 * 12), text: '几年后回国，苏州和广州选哪个？主要看落户难度和 IT 岗位。' },
      {
        role: 'assistant',
        ts: today(60 * 24 * 12),
        elapsed: 63.7,
        ttft: 1.62,
        out_tokens: 2410,
        gen_seconds: 61.2,
        parts: [
          {
            kind: 'text',
            text: `两个城市的取舍不在「哪个更好」，而在**你的时间线和落户方式**。

### 硬门槛对比

| 维度 | 苏州 | 广州 |
| --- | --- | --- |
| 落户方式 | 人才引进（学历 / 职称 / 社保） | 学历入户 + 积分入户 |
| 门槛倾向 | 看学历与单位资质 | 看社保年限与年龄 |
| IT 岗位密度 | 制造业信息化、外企研发 | 互联网、游戏、跨境电商 |
| 生活成本 | 中等，房租压力小 | 偏高，但岗位溢价也高 |

### 如果是我会这样判断

1. 先确认学历能不能直接走人才引进 —— 这决定要不要攒社保年限
2. 岗位方向：做后端 / 数据选广州，做工业软件、汽车电子选苏州
3. 房子 20 万首付在苏州的可选面明显更宽，广州要往增城、从化看

> 结论：**优先看 offer 落在哪边**，落户政策随时会调，但一份三年期的岗位决定你这三年的收入曲线。`,
          },
        ],
      },
    ],
  },
]

/* ───────────────────────────── 工作台假数据 ───────────────────────────── */

const SKILLS: Skill[] = [
  { name: 'hermes-relay', description: '改 Hermes Relay 前端或后端时用', category: 'software-development', path: 'skills/hermes-relay' },
  { name: 'ai-write-flow', description: '写、改、审中文长文', category: 'ai-write-flow', path: 'skills/ai-write-flow' },
  { name: 'systematic-debugging', description: '四阶段根因排查', category: 'software-development', path: 'skills/systematic-debugging' },
  { name: 'github-pr-workflow', description: 'GitHub PR 全流程（分支到合并）', category: 'github', path: 'skills/github-pr-workflow' },
  { name: 'llm-gateway-verification', description: '自建 LLM 网关验收', category: 'devops', path: 'skills/llm-gateway-verification' },
  { name: 'obsidian', description: '读写 Obsidian 笔记库', category: 'note-taking', path: 'skills/obsidian' },
  { name: 'youtube-content', description: 'YouTube 转写与摘要', category: 'media', path: 'skills/youtube-content' },
  { name: 'weekly-review-planning', description: '每周复盘与下周计划', category: 'productivity', path: 'skills/weekly-review-planning' },
]

const KANBAN: KanbanTask[] = [
  {
    id: 't1',
    title: '把网关日志的筛选维度补齐',
    body: '按密钥 / 模型 / 状态码三维筛选，URL 保持可分享。',
    assignee: 'hermes',
    status: 'running',
    priority: 2,
    created_at: today(300),
    started_at: today(120),
  },
  {
    id: 't2',
    title: '静态演示站上线 GitHub Pages',
    body: '用真实前端 + 假数据导出，别另写一套渲染。',
    status: 'done',
    priority: 1,
    created_at: today(600),
    started_at: today(400),
    completed_at: today(30),
  },
  {
    id: 't3',
    title: '折叠块展开时上方内容位移 0.375px',
    body: '容器 scrollTop 只有整数精度，内容高度是小数。',
    status: 'todo',
    priority: 3,
    created_at: today(60 * 24 * 5),
  },
  {
    id: 't4',
    title: '给备份脚本加异地上传的失败重试',
    status: 'ready',
    priority: 2,
    created_at: today(60 * 24 * 2),
    workspace_kind: 'local',
  },
  {
    id: 't5',
    title: '检查 Umami 统计的每日回填',
    status: 'triage',
    priority: 4,
    created_at: today(60 * 8),
  },
  {
    id: 't6',
    title: '清理三个月前的构建缓存',
    status: 'blocked',
    priority: 3,
    created_at: today(60 * 24 * 3),
    consecutive_failures: 2,
    last_failure_error: 'Permission denied: /var/cache/build',
  },
]

const CRON: CronJob[] = [
  {
    id: 'j1',
    name: '每日备份上传',
    prompt: '把本机备份目录同步到对象存储，失败就告诉我。',
    schedule: { kind: 'cron', expr: '0 4 * * *', display: '每天 04:00' },
    enabled: true,
    state: 'scheduled',
    next_run_at: new Date((today(-1) + 86400) * 1000).toISOString(),
    last_run_at: new Date(today(60 * 13) * 1000).toISOString(),
    last_status: 'success',
    recent_execution: { id: 'e1', status: 'success', started_at: new Date(today(60 * 13) * 1000).toISOString(), finished_at: new Date(today(60 * 13 - 2) * 1000).toISOString() },
  },
  {
    id: 'j2',
    name: '本地备份清理',
    schedule: { kind: 'cron', expr: '0 4 * * *', display: '每天 04:00' },
    enabled: true,
    state: 'scheduled',
    last_status: 'success',
  },
  {
    id: 'j3',
    name: '论坛每日签到',
    schedule: { kind: 'cron', expr: '10 9 * * *', display: '每天 09:10' },
    enabled: true,
    state: 'scheduled',
    last_status: 'success',
  },
  {
    id: 'j4',
    name: '周报草稿',
    schedule: { kind: 'cron', expr: '0 20 * * 0', display: '每周日 20:00' },
    enabled: false,
    state: 'disabled',
    last_status: 'skipped',
  },
]

const PROCESSES: ProcessItem[] = [
  { pid: 912, ppid: 1, user: 'root', cpu: 3.1, mem: 4.8, elapsed: '3-04:12:33', command: 'python server.py', name: 'python', type: 'hermes' },
  { pid: 1088, ppid: 912, user: 'root', cpu: 1.2, mem: 2.1, elapsed: '02:41:09', command: 'node server.js', name: 'node', type: 'web' },
  { pid: 4201, ppid: 1, user: 'www-data', cpu: 0.4, mem: 0.6, elapsed: '5-11:02:41', command: 'nginx: worker process', name: 'nginx', type: 'system' },
  { pid: 5233, ppid: 1, user: 'root', cpu: 0.2, mem: 1.4, elapsed: '1-08:33:12', command: '/opt/cliproxyapi/cliproxyapi', name: 'cliproxyapi', type: 'system' },
  { pid: 6301, ppid: 1, user: 'ubuntu', cpu: 7.6, mem: 6.2, elapsed: '04:10:55', command: 'node current/index.js', name: 'node', type: 'web' },
  { pid: 7712, ppid: 1, user: 'root', cpu: 0.1, mem: 0.9, elapsed: '2-19:45:01', command: '/usr/local/bin/umami', name: 'umami', type: 'web' },
]

const ARTIFACTS: ArtifactFile[] = [
  { path: '/srv/artifacts/report-2026-10.html', name: 'report-2026-10.html', ext: 'html', kind: 'html', size: 48213, mtime: today(120), is_html: true },
  { path: '/srv/artifacts/architecture.svg', name: 'architecture.svg', ext: 'svg', kind: 'svg', size: 18220, mtime: today(300), is_svg: true },
  { path: '/srv/artifacts/weekly-review.md', name: 'weekly-review.md', ext: 'md', kind: 'markdown', size: 6120, mtime: today(600), is_markdown: true },
  { path: '/srv/artifacts/fold-timing.ts', name: 'fold-timing.ts', ext: 'ts', kind: 'code', size: 3410, mtime: today(60 * 24) },
  { path: '/srv/artifacts/nginx-relay.conf', name: 'nginx-relay.conf', ext: 'conf', kind: 'text', size: 2280, mtime: today(60 * 40) },
  { path: '/srv/artifacts/disk-report.html', name: 'disk-report.html', ext: 'html', kind: 'html', size: 22100, mtime: today(60 * 50), is_html: true },
]

const MEMORY_FILES: MemoryFile[] = [
  {
    key: 'memory',
    label: '记忆',
    path: 'memories/MEMORY.md',
    chars: 1180,
    limit: 5000,
    mtime: today(240),
    content: `服务器：Linux，网页前端与网关都跑在本机。
项目目录：~/workspace（前端在 web/，后端只有三个 Python 文件）。
部署：systemd 管服务，nginx 做反代。

示例内容（演示站）：真实记忆不会出现在这里。`,
  },
  {
    key: 'user',
    label: '用户档案',
    path: 'memories/USER.md',
    chars: 860,
    limit: 2500,
    mtime: today(240),
    content: `- 中文交流，喜欢先给结论再给理由。
- 界面文案一律中文；看不懂命令，所以审批卡片要写清「要做什么 / 风险」。
- 做新工具先搜现成方案，再决定自研。
（演示数据）`,
  },
  {
    key: 'soul',
    label: '人格',
    path: 'SOUL.md',
    chars: 420,
    limit: null,
    mtime: today(600),
    content: `直接、克制、不发散。
不确定就说不确定，不用语气词凑字数。
（演示数据）`,
  },
]

const LOG_LINES = [
  '2026-10-20 14:02:11 INFO  turn start session=c1 model=deepseek-v4.1-flash',
  '2026-10-20 14:02:12 INFO  tool read_file path=web/components/chat/messages.tsx 41ms',
  '2026-10-20 14:02:13 INFO  tool terminal cmd="grep -n tps" 88ms',
  '2026-10-20 14:03:24 INFO  turn done session=c1 chunks=2741 out_tokens=4390 gen=70.8s',
  '2026-10-20 14:05:02 WARN  approval required session=c3 req=ap-8812',
  '2026-10-20 14:05:19 INFO  approval resolved choice=once',
  '2026-10-20 14:11:40 INFO  context compress session=c3 142000 -> 31000 tokens',
]

/* ───────────────────────────── 可变状态 ───────────────────────────── */

const chats = CHATS.map((c) => ({ ...c, messages: c.messages.map((m) => ({ ...m })) }))
let currentModel = { key: 'deepseek-v4.1-flash', effort: 'medium' }
let pendingApproval = false
let pendingClarify = false

const liveChat = (id: string) => chats.find((c) => c.id === id)

/* ───────────────────────────── SSE ───────────────────────────── */

type Step = { wait: number; ev: TurnEvent | null; gate?: 'approval' | 'clarify' }

/** 一轮对话的事件脚本：思考 → 工具 → 审批 / 反问 → 正文 → done → eof */
function buildTurnScript(sessionId: string, prompt: string): Step[] {
  const base: Step[] = [
    {
      wait: 260,
      ev: {
        type: 'reasoning',
        text:
          '收到。这是静态演示站，没有真实模型在后面；但我按线上同一套事件把这一轮走一遍：' +
          '先思考、再调用工具、最后出正文，前端收到的东西与 server.py 发出来的完全一样。',
      },
    },
    {
      wait: 320,
      ev: {
        type: 'tool_start',
        name: 'search_files',
        brief: '在项目里找相关实现',
        args: '{"pattern": "fold-body|animateFold", "path": "web/"}',
      },
    },
    {
      wait: 420,
      ev: { type: 'tool_end', name: 'search_files', ok: true, result: 'web/components/chat/messages.tsx:48\nweb/app/globals.css:212' },
    },
  ]

  if (base.length) {
    /* 第一个会话走审批流程，第四个会话走反问流程，其余就是普通回复 */
    if (sessionId === 'c3') {
      return [
        ...base,
        {
          wait: 260,
          ev: {
            type: 'approval',
            request_id: 'ap-' + Math.random().toString(36).slice(2, 8),
            command: "find /var/log/app -name '*.log' -mtime +90 -delete",
            description: 'recursive delete; find -delete',
            timeout_sec: 300,
            deadline: nowSec() + 300,
          },
          gate: 'approval',
        },
        {
          wait: 200,
          ev: { type: 'tool_start', name: 'terminal', brief: "find /var/log/app -name '*.log' -mtime +90 -delete", args: '{"command": "find /var/log/app -name \'*.log\' -mtime +90 -delete"}' },
        },
        { wait: 300, ev: { type: 'tool_end', name: 'terminal', ok: true, result: '（已删除 214 个文件，回收 4.3G）' } },
        {
          wait: 120,
          ev: {
            type: 'delta',
            text: `清理完成，根分区从 **94%** 降到 **61%**：

| 项目 | 回收 | 方式 |
| --- | --- | --- |
| journald | 11.2G | 设上限后自动回收 |
| 旧构建日志 | 4.3G | 按 90 天清理 |
| 悬空镜像 | 2.7G | \`docker image prune -f\` |

后续不用再手动清 —— journald 现在自己封顶了，超过 1G 会自动轮转。`,
          },
        },
        { wait: 120, ev: { type: 'done', usage: { prompt_tokens: 18200, completion_tokens: 640 }, ttft: 0.9, out_tokens: 640, gen_seconds: 6.4 } },
        { wait: 40, ev: { type: 'eof' } },
      ]
    }

    if (sessionId === 'c4') {
      return [
        ...base,
        {
          wait: 200,
          ev: {
            type: 'delta',
            text: `识别到一笔支出：**¥1,340**（含税 ¥121），超市，食品 + 日用品。

先按「日用」记了，如果要分类就告诉我。`,
          },
        },
        {
          wait: 240,
          ev: {
            type: 'clarify',
            clarify_id: 'cl-' + Math.random().toString(36).slice(2, 8),
            questions: [
              {
                qid: 'q1',
                question: '这笔 1,340 日元记到哪个分类？',
                choices: ['日用（超市） (Recommended)', '食品', '拆成食品 + 日用'],
                multi_select: false,
              } as ClarifyQuestion,
            ],
            batch: false,
            timeout_seconds: 300,
          },
          gate: 'clarify',
        },
        { wait: 120, ev: { type: 'delta', text: '\n\n好，已经按你选的分类入库，月报的分类会立刻更新。' } },
        { wait: 100, ev: { type: 'done', usage: { prompt_tokens: 9100, completion_tokens: 420 }, ttft: 1.1, out_tokens: 420, gen_seconds: 4.2 } },
        { wait: 40, ev: { type: 'eof' } },
      ]
    }
  }

  return [
    ...base,
    {
      wait: 140,
      ev: {
        type: 'delta',
        text: `收到「${prompt.slice(0, 40)}${prompt.length > 40 ? '…' : ''}」。

这是一个**静态演示**，没有真实模型在后面，但我把这一轮的样子完整演了一遍：

1. 一段思考（折叠成一行，点开能看全文）
2. 一次工具调用（工具名 + 参数，点开有参数和结果）
3. 一段正文（Markdown：标题、列表、代码、表格都支持）

> 侧栏里换一个会话可以看到审批卡片和反问卡片；右上角是切换模型与思考强度的面板。`,
      },
    },
    { wait: 120, ev: { type: 'done', usage: { prompt_tokens: 12000, completion_tokens: 380 }, ttft: 0.92, out_tokens: 380, gen_seconds: 4.6 } },
    { wait: 40, ev: { type: 'eof' } },
  ]
}

function sseResponse(steps: Step[], signal?: AbortSignal | null, onDone?: () => void): Response {
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      let aborted = false
      signal?.addEventListener('abort', () => {
        aborted = true
      })
      for (const step of steps) {
        if (aborted) break
        await sleep(step.wait)
        if (aborted) break
        if (step.gate === 'approval') {
          pendingApproval = true
          ctrl.enqueue(enc.encode(`data: ${JSON.stringify(step.ev)}\n\n`))
          while (pendingApproval && !aborted) await sleep(120)
          continue
        }
        if (step.gate === 'clarify') {
          pendingClarify = true
          ctrl.enqueue(enc.encode(`data: ${JSON.stringify(step.ev)}\n\n`))
          while (pendingClarify && !aborted) await sleep(120)
          ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'clarify_end', clarify_id: 'cl' })}\n\n`))
          continue
        }
        ctrl.enqueue(enc.encode(`data: ${JSON.stringify(step.ev)}\n\n`))
      }
      if (!aborted) onDone?.()
      try {
        ctrl.close()
      } catch {
        /* 已经被取消了 */
      }
    },
  })
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

/** 把事件脚本折叠成一条助手消息的 parts：连续 reasoning / delta 各自并成一段，
 *  工具按 tool_start/tool_end 配对。答完之后前端会重新拉一次会话详情，
 *  所以这条必须要落进 messages，否则回复「刷新就没」。 */
function collectParts(steps: Step[]): Part[] {
  const parts: Part[] = []
  const pushText = (kind: 'text' | 'reason', text: string) => {
    const last = parts[parts.length - 1]
    if (last && last.kind === kind) last.text += text
    else parts.push({ kind, text })
  }
  const tools: Record<string, number> = {}

  for (const s of steps) {
    const ev = s.ev
    if (!ev) continue
    if (ev.type === 'reasoning') pushText('reason', ev.text)
    else if (ev.type === 'delta') pushText('text', ev.text)
    else if (ev.type === 'tool_start') {
      parts.push({ kind: 'tool', name: ev.name, brief: ev.brief, args: ev.args, done: false })
      tools[ev.name] = parts.length - 1
    } else if (ev.type === 'tool_end') {
      const i = tools[ev.name]
      const target = i != null ? parts[i] : undefined
      if (target && target.kind === 'tool') {
        target.result = ev.result
        target.done = true
      }
    }
  }
  return parts
}

/* ───────────────────────────── 路由 ───────────────────────────── */

const MODELS: ModelsPayload = {
  models: [
    { key: 'cline-pass/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', model_id: 'deepseek-v4.1-flash', provider: 'cline-pass', source: 'hermes', channel_name: 'cline-pass', is_default: true, context_length: 1048576 },
    { key: 'cline-pass/deepseek-v4.1-pro', name: 'DeepSeek V4.1 Pro', model_id: 'deepseek-v4.1-pro', provider: 'cline-pass', source: 'hermes', channel_name: 'cline-pass', context_length: 1048576 },
    { key: 'custom/llm-gateway/claude-opus-4.6', name: 'Claude Opus 4.6', model_id: 'claude-opus-4.6', provider: 'custom', source: 'custom', channel_id: 'llm-gateway', channel_name: 'llm-gateway', context_length: 200000 },
    { key: 'custom/llm-gateway/gpt-5.5', name: 'GPT-5.5', model_id: 'gpt-5.5', provider: 'custom', source: 'custom', channel_id: 'llm-gateway', channel_name: 'llm-gateway', context_length: 400000 },
  ],
  custom: [],
  channels: [
    {
      id: 'llm-gateway',
      name: 'llm-gateway',
      base_url: 'https://gw.example.dev/v1',
      models: [
        { model_id: 'claude-opus-4.6', key: 'custom/llm-gateway/claude-opus-4.6', name: 'Claude Opus 4.6', context_length: 200000 },
        { model_id: 'gpt-5.5', key: 'custom/llm-gateway/gpt-5.5', name: 'GPT-5.5', context_length: 400000 },
      ],
      has_key: true,
    },
  ],
  current: currentModel,
  efforts: [
    { value: 'none', label: '关', hint: '不思考，最快' },
    { value: 'low', label: '低', hint: 'low' },
    { value: 'medium', label: '中', hint: 'medium' },
    { value: 'high', label: '高', hint: 'high' },
    { value: 'max', label: '最高', hint: 'max，最慢' },
  ],
  default_effort: 'medium',
  default_model: 'deepseek-v4.1-flash',
  default_provider: 'cline-pass',
}

function contextFor(id: string): ContextStats {
  const c = liveChat(id)
  const used = id === 'c1' ? 131072 : id === 'c3' ? 31000 : 42000
  return {
    model: c?.model ?? 'deepseek-v4.1-flash',
    used,
    used_source: 'anchor',
    window: 1048576,
    window_source: 'config',
    percent: (used / 1048576) * 100,
    messages: c?.messages.length ?? 2,
    compress_at: Math.round(1048576 * 0.8),
    compress_threshold: 0.8,
    compress_enabled: true,
    calls: 12,
    input_tokens: 288000,
    output_tokens: 14300,
    cache_read: 246000,
    cache_write: 12000,
    cache_hit_rate: 0.88,
    cache_scope: 'model',
    turn_stats: { turns: 12, cache_read: 246000, cache_write: 12000, prompt_total: 288000, hit_rate: 0.88, reported: true },
  }
}

const PREVIEW_FILES: Record<string, string> = {
  'web/components/chat/messages.tsx': `'use client'

/** 把片段按「正文」和「思考/工具」切成交替的几串（一串非正文就是一个折叠单位）。 */
function intoGroups(parts: Part[]): Part[][] {
  const out: Part[][] = []
  for (const p of parts) {
    const last = out[out.length - 1]
    if (last && (last[0].kind !== 'text') === (p.kind !== 'text')) last.push(p)
    else out.push([p])
  }
  return out
}

/** 答完之后整串收成一颗胶囊：思考 N 段 · 工具 M 次 */
function LeadingChain({ lead }: { lead: Part[] }) {
  const [open, setOpen] = useState(false)
  const thinks = lead.filter((p) => p.kind === 'reason').length
  const tools = lead.filter((p) => p.kind === 'tool').length
  return <FoldGrid open={open}>{/* ... */}</FoldGrid>
}`,
  'web/app/globals.css': `/* 6. 折叠块（思考 / 工具行 / 折叠链）：CSS Grid 硬件加速零 JS 驱动 */
.fold-grid {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 180ms cubic-bezier(0.16, 1, 0.3, 1);
}

.fold-grid[data-open="true"] {
  grid-template-rows: 1fr;
}

.fold-grid-inner {
  overflow: hidden;
  min-height: 0;
}`,
  'main.go': `type Bucket struct {
	Hour   int            \`json:"hour"\`
	Reqs   int            \`json:"reqs"\`
	Tokens map[string]int \`json:"tokens"\` // key_id → token 数
}

func aggregate(rows []LogRow) map[int]*Bucket {
	out := map[int]*Bucket{}
	for _, r := range rows {
		b := out[r.Hour]
		if b == nil {
			b = &Bucket{Hour: r.Hour, Tokens: map[string]int{}}
			out[r.Hour] = b
		}
		b.Reqs++
		b.Tokens[r.KeyID] += r.CompletionTokens
	}
	return out
}`,
}

function route(pathname: string, url: URL, init?: RequestInit): Response | Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase()
  const p = pathname

  /* 会话列表 / 详情 / 改名 / 删除 */
  if (p === '/api/chats' && method === 'GET') {
    const q = (url.searchParams.get('q') ?? '').trim()
    const limit = Number(url.searchParams.get('limit') ?? 100)
    const list = chats
      .filter((c) => !q || c.title.includes(q) || (c.preview ?? '').includes(q))
      .slice(0, limit)
      .map(({ messages, ...rest }) => rest)
    return json({ chats: list })
  }
  if (p === '/api/chats' && method === 'POST') {
    const id = 'n' + nowSec()
    const fresh: DemoChat = {
      id,
      title: '',
      source: 'webui',
      model: 'deepseek-v4.1-flash',
      message_count: 0,
      last_active: nowSec(),
      preview: '',
      messages: [],
    }
    chats.unshift(fresh)
    return json({ id })
  }

  let m = p.match(/^\/api\/chats\/([^/]+)(\/[a-z]+)?$/)
  if (m) {
    const id = decodeURIComponent(m[1])
    const sub = m[2] ?? ''
    const c = liveChat(id)

    if (!sub && method === 'GET') {
      return json({
        id,
        title: c?.title ?? '',
        messages: c?.messages ?? [],
        compactions: c?.compactions ?? [],
        has_more: false,
        turns: c?.messages.length ?? 0,
      })
    }
    if (!sub && method === 'PATCH') {
      try {
        const body = JSON.parse(String(init?.body ?? '{}'))
        if (c && body.title) c.title = String(body.title)
      } catch {
        /* 空 body 就什么都不改 */
      }
      return ok()
    }
    if (!sub && method === 'DELETE') {
      const i = chats.findIndex((x) => x.id === id)
      if (i >= 0) chats.splice(i, 1)
      return ok()
    }
    if (sub === '/turn' || sub === '/regenerate') {
      let prompt = ''
      try {
        prompt = String(JSON.parse(String(init?.body ?? '{}')).text ?? '')
      } catch {
        prompt = ''
      }
      if (c && prompt) {
        if (sub === '/regenerate') {
          // 重新生成：把最后一轮助手的回复去掉，用同一个提问再演一遍
          for (let i = c.messages.length - 1; i >= 0; i--) {
            if (c.messages[i].role === 'assistant') {
              c.messages.splice(i, 1)
              break
            }
          }
        } else {
          c.messages.push({ role: 'user', text: prompt, ts: nowSec() })
          c.preview = prompt
          if (!c.title) c.title = prompt.slice(0, 14)
        }
        c.last_active = nowSec()
        c.message_count = c.messages.length
      }

      const steps = buildTurnScript(id, prompt)
      const started = Date.now()
      return sseResponse(steps, (init?.signal as AbortSignal | undefined) ?? null, () => {
        if (!c) return
        const parts = collectParts(steps)
        if (!parts.length) return
        const genSeconds = Math.max(0.8, (Date.now() - started) / 1000 - 0.9)
        const chars = parts.reduce((n, x) => n + ('text' in x && x.text ? x.text.length : 0), 0)
        c.messages.push({
          role: 'assistant',
          ts: nowSec(),
          parts,
          elapsed: Math.round(((Date.now() - started) / 1000) * 10) / 10,
          ttft: 0.9,
          out_tokens: Math.round(chars / 1.7),
          gen_seconds: Math.round(genSeconds * 10) / 10,
        })
        c.message_count = c.messages.length
        c.last_active = nowSec()
      })
    }
    if (sub === '/stream') {
      return sseResponse([{ wait: 30, ev: { type: 'eof' } }], (init?.signal as AbortSignal | undefined) ?? null)
    }
    if (sub === '/context') return json(contextFor(id))
    if (sub === '/interrupt') return ok()
    if (sub === '/steer') return json({ ok: true })
    if (sub === '/compress') {
      const before = 142000
      return json({ ok: true, before, after: 31000, seconds: 38.5 })
    }
  }

  /* 审批 / 反问的回答 */
  if (p === '/api/approvals') {
    pendingApproval = false
    return json({ resolved: 1 })
  }
  if (p === '/api/clarify') {
    pendingClarify = false
    return json({ resolved: true })
  }

  /* 模型与渠道 */
  if (p === '/api/models') return json(MODELS)
  if (p === '/api/models/select') {
    try {
      const body = JSON.parse(String(init?.body ?? '{}'))
      currentModel = {
        key: body.key ?? currentModel.key,
        effort: body.effort ?? currentModel.effort,
      }
      MODELS.current = currentModel
    } catch {
      /* 空 body */
    }
    return json({ ok: true, current: currentModel })
  }
  if (p === '/api/models/test') return json({ ok: true, ms: 412, model: 'deepseek-v4.1-flash', models: ['deepseek-v4.1-flash', 'deepseek-v4.1-pro'] })
  if (p === '/api/models/add' || p === '/api/models/update') return ok()
  if (p === '/api/models/remove' || p === '/api/channels/add' || p === '/api/channels/sync' || p === '/api/channels/remove') return ok()

  /* 其它 */
  if (p === '/api/config') return json({ model: currentModel.key, provider: 'cline-pass' })
  if (p === '/api/skills') return json({ skills: SKILLS })
  if (p === '/api/upload') return json({ path: '/uploads/demo.png', name: 'demo.png', mime: 'image/png' })
  if (p === '/api/kanban/tasks' && method === 'GET') return json({ tasks: KANBAN })
  if (p === '/api/kanban/tasks' && method === 'POST') return ok({ task: KANBAN[0] })
  if (p.startsWith('/api/kanban/tasks/')) return ok({ task: KANBAN[0] })
  if (p === '/api/cron/jobs') return json({ jobs: CRON })
  if (p === '/api/cron/toggle' || p === '/api/cron/run') return ok({ dispatched: 'demo' })
  if (p === '/api/system/processes')
    return json({
      loadavg: [0.42, 0.38, 0.35],
      memory: { total_mb: 12288, available_mb: 7310, used_mb: 4978, used_percent: 40.5 },
      processes: PROCESSES,
    })
  if (p === '/api/system/logs') return json({ ok: true, file: url.searchParams.get('file') ?? 'agent.log', lines: LOG_LINES, mtime: today(2), size: 481231 })
  if (p === '/api/artifacts/files') return json({ files: ARTIFACTS })
  if (p === '/api/health') return json({ ok: true })

  /* /local-api：真实项目里由 Next 的 route handler 读盘，演示站在内存里给 */
  if (p === '/local-api/memory') {
    if (method === 'PUT') {
      const key = url.searchParams.get('key') ?? ''
      const f = MEMORY_FILES.find((x) => x.key === key)
      if (f) {
        try {
          f.content = String(JSON.parse(String(init?.body ?? '{}')).content ?? f.content)
          f.chars = f.content.length
        } catch {
          /* 空 body */
        }
      }
      return json({ ok: true, chars: f?.chars ?? 0, limit: f?.limit ?? null, backup: null })
    }
    return json({ files: MEMORY_FILES })
  }
  if (p === '/local-api/hermes-status') return json({ ok: true })
  if (p === '/local-api/file') {
    const raw = url.searchParams.get('path') ?? ''
    const name = raw.split('/').pop() ?? raw
    const ext = name.includes('.') ? name.split('.').pop()! : ''
    const content =
      PREVIEW_FILES[raw] ??
      `// ${name}\n//\n// 演示站只内置了几个文件的片段；真实项目里这个面板读的是服务器上的实际文件。`
    return json({
      ok: true,
      path: raw,
      realPath: raw,
      name,
      ext,
      kind: ext === 'md' ? 'markdown' : ext === 'html' ? 'html' : 'text',
      size: content.length,
      mtime: today(30),
      content,
    })
  }

  return json({ ok: false, error: `演示站没有实现这个接口：${method} ${p}` })
}

/* ───────────────────────────── 安装 ───────────────────────────── */

function install() {
  const raw = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const u = new URL(url, location.href)
    // basePath 由 next build 决定（GitHub Pages 项目站），这里只剥掉前缀
    const pathname = u.pathname.replace(/^\/hermes-relay(?=\/)/, '')
    if (pathname.startsWith('/api/') || pathname.startsWith('/local-api/')) {
      return route(pathname, u, init)
    }
    return raw(input as RequestInfo, init)
  }
}

if (typeof window !== 'undefined' && !(window as unknown as { __demoMock?: boolean }).__demoMock) {
  ;(window as unknown as { __demoMock?: boolean }).__demoMock = true
  install()
}
