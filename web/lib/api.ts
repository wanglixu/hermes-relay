// 后端接口封装。一条消息 = 一次流式请求，不做轮询。
export type Chat = {
  id: string
  title: string
  source: string
  model: string
  message_count: number
  last_active: number
  preview: string
  /** 这个会话派出去的子代理（delegate_task） */
  agents?: AgentRun[]
  /** 会话级的压缩记录：渲染在整条时间线的最下面 */
  compactions?: Compaction[]
}

/** 一次上下文压缩的记录（Hermes 原生压缩，我们只负责展示） */
export type Compaction = {
  at?: number
  before?: number | null
  after?: number | null
  seconds?: number | null
  before_tokens?: number | null
  after_tokens?: number | null
  /* 下面四个是 Hermes 的 summarize_manual_compression() 给出的判定（详见后端 compress.py），
     界面按它决定怎么说，不自己猜。老记录里没有这几个键。 */
  /** 摘要比原文长，Hermes 原地放弃、一条消息都没删 */
  refused_would_grow?: boolean | null
  /** 摘要生成失败，消息没动 */
  aborted?: boolean | null
  /** 摘要失败，用降级上下文硬压的 */
  fallback_used?: boolean | null
  /** 跟没压一样 */
  noop?: boolean | null
}

export type AgentRun = {
  id: string
  state: string
  goal: string
  seconds: number | null
}

export type ToolPart = {
  kind: 'tool'
  name: string
  brief?: string
  args?: string
  result?: string
  done?: boolean
}

export type Part = { kind: 'text'; text: string } | { kind: 'reason'; text: string } | ToolPart

export type Msg = {
  role: 'user' | 'assistant'
  text?: string
  ts?: number
  elapsed?: number | null // 这一回合的总耗时（秒），只挂在回合最后一条助手消息上
  ttft?: number | null // 首字响应时间（秒）：从发出到第一个片段（通常是思考）到达
  parts?: Part[] // 按真实发生顺序排的片段：思考 / 工具 / 正文
  stopped?: boolean // 这一轮是被「停止」打断的（没进数据库，只在当前页面可见）
  images?: string[] // 本地预览地址，仅当前会话有效
  out_tokens?: number | null // 这一轮输出的 token 数（算 tok/s 用）
  gen_seconds?: number | null // 这一轮「真正在收字」的秒数：tok/s 的分母（首字等待和跑工具的时间都不算）
  compactions?: {
    before?: number | null
    after?: number | null
    seconds?: number | null
    before_tokens?: number | null
    after_tokens?: number | null
    refused_would_grow?: boolean | null
    aborted?: boolean | null
    fallback_used?: boolean | null
    noop?: boolean | null
  }[] // 这一轮之后压过上下文
}

export type Attachment = { path: string; name: string; mime: string }

/** 当前会话的上下文用量（后端估算 + 库里真实的缓存/调用累计值） */
export type ContextStats = {
  model: string
  used: number
  /** 'anchor' = Hermes 记的最近一次调用实测值；'estimate' = 按消息文本估的兜底 */
  used_source?: 'anchor' | 'estimate'
  window: number
  /** 'config' | 'provider' | 'custom' | 'same-name' | ''（空 = 没查到） */
  window_source?: string
  percent: number
  messages: number
  compress_at: number
  compress_threshold: number
  compress_enabled: boolean
  calls: number
  input_tokens: number
  output_tokens: number
  cache_read: number
  cache_write: number
  cache_hit_rate: number | null
  /** 'model' = 只算当前模型；'session' = 这个模型还没跑过，退回全会话 */
  cache_scope?: 'model' | 'session' | ''
  /** 本会话用过的其他模型（换模型后缓存基线要重算，所以不算它们） */
  cache_other_models?: string[]
  /** 逐轮实测：Hermes 每轮当场报的计数（只覆盖加了埋点之后跑的轮次）。 */
  turn_stats?: {
    turns: number
    cache_read: number
    cache_write: number
    prompt_total: number
    hit_rate: number
    /** 这几轮里上游是否返回过缓存字段（false 且 turns>0 = 上游没返回，不是没命中）。 */
    reported: boolean
  }
}

export type Skill = { name: string; description: string; category: string; path: string; last_used?: number | null }

export type KanbanTask = {
  id: string
  title: string
  body?: string
  assignee?: string
  status: 'triage' | 'todo' | 'ready' | 'running' | 'blocked' | 'done'
  priority?: number
  created_at: number
  started_at?: number | null
  completed_at?: number | null
  workspace_kind?: string
  consecutive_failures?: number
  last_failure_error?: string | null
}

export type CronJob = {
  id: string
  name: string
  prompt?: string
  script?: string
  schedule?: { kind: string; expr: string; display: string }
  enabled: boolean
  state?: string
  next_run_at?: string
  last_run_at?: string
  last_status?: string
  recent_execution?: {
    id: string
    status: string
    started_at: string
    finished_at: string
    error?: string | null
  }
}

export type ProcessItem = {
  pid: number
  ppid: number
  user: string
  cpu: number
  mem: number
  elapsed: string
  command: string
  name: string
  type: 'hermes' | 'web' | 'system'
}

export type SystemProcessesPayload = {
  loadavg: number[]
  memory: {
    total_mb: number
    available_mb: number
    used_mb: number
    used_percent: number
  }
  processes: ProcessItem[]
  hermes_managed?: any[]
}

export type ArtifactFile = {
  path: string
  name: string
  ext: string
  kind: 'html' | 'svg' | 'markdown' | 'code' | 'text'
  size: number
  mtime: number
  is_html?: boolean
  is_svg?: boolean
  is_markdown?: boolean
}

/** 模型反过来问用户（原生 clarify 工具）的一道题。choices 里第一项带「(Recommended)」后缀。 */
export type ClarifyQuestion = {
  qid: string
  question: string
  choices?: string[] | null
  multi_select?: boolean
}

export type Clarify = {
  clarify_id: string
  questions: ClarifyQuestion[]
  batch?: boolean
  timeout_seconds?: number
}

export type TurnEvent =
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool' | 'tool_start'; name: string; brief?: string; args?: string }
  | { type: 'tool_end'; name: string; ok?: boolean | null; result?: string }
  | { type: 'status'; kind: string; text: string }
  | {
      type: 'approval'
      request_id: string
      command: string
      description: string
      timeout_sec?: number
      deadline?: number
    }
  | { type: 'clarify'; clarify_id: string; questions: ClarifyQuestion[]; batch?: boolean; timeout_seconds?: number }
  | { type: 'clarify_end'; clarify_id: string }
  | { type: 'error'; message: string; detail?: string }
  | { type: 'done'; usage: Record<string, unknown>; ttft?: number | null; out_tokens?: number | null; gen_seconds?: number | null }
  | { type: 'eof' }
  | { type: 'reset' } // 断点之前的回放被截断了：把已渲染的片段清掉重来

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`)
  return res.json() as Promise<T>
}

/** 设置里能编辑的三份文件：记忆 / 用户档案 / 智能体灵魂（就是磁盘上那两个 memories/*.md 加 SOUL.md） */
export type MemoryFile = {
  key: 'memory' | 'user' | 'soul'
  label: string
  path: string
  content: string
  chars: number
  /** 记忆 5,000 / 用户档案 2,500（来自 config.yaml）；人格没有上限，为 null */
  limit: number | null
  mtime: number | null
}

/** 页面上可选的模型 / 思考强度。存在 relay 自己的配置文件里，只作用于这个网页。 */
export type RelayModel = {
  key: string
  name: string
  model_id: string
  provider?: string
  /** hermes = 命令行那边已配好的渠道；custom = 在这个页面上加的 */
  source: 'hermes' | 'custom'
  base_url?: string
  has_key?: boolean
  is_default?: boolean
  /** 属于哪个渠道（在「添加渠道」里一次收进来的模型才有这两个字段） */
  channel_id?: string
  channel_name?: string
  /** 添加时查到的上下文长度（词元）。没有这个字段 = 接口和公开目录都没给出确切数字 */
  context_length?: number
}

/** 页面上添加的一个渠道：一份连接信息（地址 + 密钥）挂着一批模型。密钥只留在后端，不下发。 */
export type RelayChannel = {
  id: string
  name: string
  base_url: string
  models: { model_id: string; key: string; name: string; context_length?: number }[]
  has_key: boolean
  added_at?: number
  synced_at?: number
}

export type EffortOption = { value: string; label: string; hint: string }

export type ModelsPayload = {
  models: RelayModel[]
  custom: RelayModel[]
  /** 在「添加渠道」里加过的渠道（一条连接信息 + 它下面的全部模型） */
  channels: RelayChannel[]
  /** 页面上选过的；key 为空 = 还没选过（用 Hermes 的默认模型） */
  current: { key: string; effort: string }
  efforts: EffortOption[]
  default_effort: string
  default_model: string
  default_provider: string
}

export const api = {
  config: () => fetch('/api/config').then((r) => j<{ model: string; provider: string; error?: string }>(r)),
  models: () => fetch('/api/models').then((r) => j<ModelsPayload>(r)),
  /** 选模型 / 换思考强度（两个字段各自可单独更新） */
  selectModel: (body: { key?: string; effort?: string }) =>
    fetch('/api/models/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => j<{ ok: boolean; current: { key: string; effort: string } }>(r)),
  /** 测一下这个接口地址 / 密钥 / 模型 ID 对不对（真发一次很小的请求） */
  testModel: (body: { base_url: string; api_key: string; model_id: string }) =>
    fetch('/api/models/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => j<{ ok: boolean; ms?: number; model?: string; models?: string[]; error?: string }>(r)),
  addModel: (body: { name: string; base_url: string; api_key: string; model_id: string; context_length?: string }) =>
    fetch('/api/models/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => j<{ ok: boolean; model?: RelayModel; error?: string }>(r)),
  updateModel: (body: { key: string; name: string; model_id: string; context_length?: string }) =>
    fetch('/api/models/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => j<{ ok: boolean; model?: RelayModel; error?: string }>(r)),
  removeModel: (key: string) =>
    fetch('/api/models/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    }).then((r) => j<{ ok: boolean; error?: string }>(r)),
  /** 加一个渠道：给地址 + 密钥，后端去拉这个接口下的模型，一次全存下来（不用逐个勾选） */
  addChannel: (body: { name: string; base_url: string; api_key: string }) =>
    fetch('/api/channels/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => j<{ ok: boolean; channel?: RelayChannel; error?: string }>(r)),
  /** 重新问一次这个接口现在有哪些模型 */
  syncChannel: (id: string) =>
    fetch('/api/channels/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).then((r) => j<{ ok: boolean; channel?: RelayChannel; error?: string }>(r)),
  /** 删掉整个渠道（连同它下面那批模型） */
  removeChannel: (id: string) =>
    fetch('/api/channels/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).then((r) => j<{ ok: boolean; error?: string }>(r)),
  /** 会话列表。q 非空时交给服务端按关键词搜（标题 / 预览），不是只筛当前这一页。
   *  limit 由调用方给：侧栏首屏 10 条、点「更多」往上加，搜索时一次给够。 */
  listChats: (q?: string, opts: { limit?: number; offset?: number } = {}) => {
    const qs = new URLSearchParams({ limit: String(opts.limit ?? 100) })
    if (opts.offset) qs.set('offset', String(opts.offset))
    if (q) qs.set('q', q)
    return fetch(`/api/chats?${qs.toString()}`).then((res) => j<{ chats: Chat[] }>(res))
  },
  /** 取一个会话。turns/before 是「展示窗口」：只取最近几个回合，或往前翻一页（默认整份历史）。 */
  getChat: (id: string, opts: { turns?: number; before?: number } = {}) => {
    const qs = new URLSearchParams()
    if (opts.turns != null) qs.set('turns', String(opts.turns))
    if (opts.before) qs.set('before', String(opts.before))
    const q = qs.toString()
    return fetch(`/api/chats/${id}${q ? `?${q}` : ''}`).then((r) =>
      j<{
        id: string
        title: string
        messages: Msg[]
        live?: boolean
        compactions?: Compaction[]
        has_more?: boolean
        turns?: number
      }>(r),
    )
  },
  newChat: () =>
    fetch('/api/chats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(
      (r) => j<{ id: string }>(r),
    ),
  /** 生成中插话：不打断这一轮，文字等这批工具跑完送到模型面前。ok=false 表示没在跑 */
  steer: (id: string, text: string) =>
    fetch(`/api/chats/${id}/steer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).then((r) => j<{ ok: boolean; reason?: string }>(r)),
  /** 手动压缩上下文（等价 CLI 的 /compress）：同步压，这个请求会一直挂到压完（几十秒） */
  compress: (id: string) =>
    fetch(`/api/chats/${id}/compress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).then((r) =>
      j<{ ok: boolean; before?: number; after?: number; seconds?: number; error?: string }>(r),
    ),
  rename: (id: string, title: string) =>
    fetch(`/api/chats/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    }).then((r) => j<{ ok: boolean }>(r)),
  remove: (id: string) => fetch(`/api/chats/${id}`, { method: 'DELETE' }).then((r) => j<{ ok: boolean }>(r)),
  context: (id: string) => fetch(`/api/chats/${id}/context`).then((r) => j<ContextStats>(r)),
  skills: () => fetch('/api/skills').then((r) => j<{ skills: Skill[] }>(r)),
  /** 三份文件的现状（Next 自己读盘，不走 Python 后端） */
  memoryFiles: () => fetch('/local-api/memory').then((r) => j<{ files: MemoryFile[] }>(r)),
  /** 整份替换一份文件；服务端会先备份、再原子替换 */
  saveMemoryFile: (key: string, content: string) =>
    fetch(`/local-api/memory?key=${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }).then((r) => j<{ ok: boolean; chars: number; limit: number | null; backup: string | null }>(r)),
  interrupt: (id: string) => fetch(`/api/chats/${id}/interrupt`, { method: 'POST' }),
  approve: (session_id: string, request_id: string, choice: string) =>
    fetch('/api/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id, request_id, choice }),
    }).then((r) => j<{ resolved: number }>(r)),
  /** 回答模型提出来的问题（原生 clarify）：单个问题传答案原文，批量传 {"answers":{qid:答案}} 的 JSON 串 */
  clarify: (session_id: string, clarify_id: string, response: string) =>
    fetch('/api/clarify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id, clarify_id, response }),
    }).then((r) => j<{ resolved: boolean }>(r)),
  upload: (session: string, file: File) =>
    fetch(`/api/upload?session=${encodeURIComponent(session)}&name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    }).then((r) => j<Attachment>(r)),
  // ── 工作台核心扩展 ────────────────────────────────────
  kanbanTasks: (status?: string) => {
    const q = status ? `?status=${encodeURIComponent(status)}` : ''
    return fetch(`/api/kanban/tasks${q}`).then((r) => j<{ tasks: KanbanTask[] }>(r))
  },
  createKanbanTask: (data: Partial<KanbanTask>) =>
    fetch('/api/kanban/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => j<{ ok: boolean; task: KanbanTask }>(r)),
  updateKanbanTask: (id: string, updates: Partial<KanbanTask>) =>
    fetch(`/api/kanban/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    }).then((r) => j<{ ok: boolean; task?: KanbanTask }>(r)),
  deleteKanbanTask: (id: string) =>
    fetch(`/api/kanban/tasks/${id}`, { method: 'DELETE' }).then((r) => j<{ ok: boolean }>(r)),
  cronJobs: () => fetch('/api/cron/jobs').then((r) => j<{ jobs: CronJob[] }>(r)),
  toggleCron: (id: string, enabled: boolean) =>
    fetch('/api/cron/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, enabled }),
    }).then((r) => j<{ ok: boolean }>(r)),
  runCron: (id: string) =>
    fetch('/api/cron/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).then((r) => j<{ ok: boolean; dispatched?: string; error?: string; note?: string }>(r)),
  systemProcesses: () => fetch('/api/system/processes').then((r) => j<SystemProcessesPayload>(r)),
  systemLogs: (file = 'agent.log', lines = 150) =>
    fetch(`/api/system/logs?file=${encodeURIComponent(file)}&lines=${lines}`).then((r) =>
      j<{ ok: boolean; file: string; lines: string[]; mtime?: number; size?: number }>(r),
    ),
  artifacts: () => fetch('/api/artifacts/files').then((r) => j<{ files: ArtifactFile[] }>(r)),
}

/** 读一条 SSE 流，逐事件回调。断开不重连：一轮对话只有一条连接。 */
async function pumpSSE(res: Response, onEvent: (ev: TurnEvent) => void): Promise<void> {
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      const line = chunk.split('\n').find((l) => l.startsWith('data: '))
      if (!line) continue
      try {
        onEvent(JSON.parse(line.slice(6)) as TurnEvent)
      } catch {
        /* 半条 JSON 丢掉即可 */
      }
    }
  }
}

async function checkStream(res: Response): Promise<void> {
  if (!res.ok || !res.body) {
    let msg = `HTTP ${res.status}`
    try {
      msg = (await res.json()).error || msg
    } catch {
      /* 保持原样 */
    }
    throw new Error(msg)
  }
}

/** 发一条消息并读取 SSE 流。断开 = 停止接收（后台那一轮仍会跑完并落库）。 */
export async function runTurn(
  sessionId: string,
  text: string,
  attachments: Attachment[],
  onEvent: (ev: TurnEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/chats/${sessionId}/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, attachments }),
    signal,
  })
  await checkStream(res)
  await pumpSSE(res, onEvent)
}

/** 接上正在跑（或刚跑完）的那一轮：先补发断线期间错过的内容，再继续实时收。
 *  after=0 表示从头补。轮次跑完服务端会发 eof 并把连接关掉，不会挂着不放。 */
export async function runStream(
  sessionId: string,
  after: number,
  onEvent: (ev: TurnEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/chats/${sessionId}/stream?after=${after}`, { signal })
  await checkStream(res)
  await pumpSSE(res, onEvent)
}

/** 重新生成最后一轮：先在后端回滚上一轮问答，再以原提问重新发起推理并读取 SSE 流。 */
export async function runRegenerate(
  sessionId: string,
  onEvent: (ev: TurnEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/chats/${sessionId}/regenerate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    signal,
  })
  await checkStream(res)
  await pumpSSE(res, onEvent)
}
