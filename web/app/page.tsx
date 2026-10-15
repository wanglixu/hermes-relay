'use client'

import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { List, RotateCw } from 'lucide-react'
import { Composer } from '@/components/chat/composer'
import { ApprovalCard, ClarifyCard } from '@/components/chat/cards'
import { FilePreview, type PreviewTarget } from '@/components/chat/file-preview'
import { ImageZoom, zoomImage } from '@/components/chat/image-zoom'
import {
  AssistantMessage,
  ErrorMessage,
  StreamingMessage,
  UserMessage,
  fmtDur,
  fmtK,
  stripAttachmentMarks,
} from '@/components/chat/messages'
import { Sidebar } from '@/components/chat/Sidebar'
import { SettingsDialog } from '@/components/chat/settings-dialog'
import { ActivityBar, type NavTab } from '@/components/layout/activity-bar'
import { KanbanView } from '@/components/workbench/kanban-view'
import { ProcessView } from '@/components/workbench/process-view'
import { CronView } from '@/components/workbench/cron-view'
import { ArtifactsView } from '@/components/workbench/artifacts-view'
import { cn } from '@/lib/cn'
import {
  CollapseFab,
  SoonButton,
  SteerNote,
  SystemNotice,
} from '@/components/chat/statusbar'
import { isToday, useSessions } from '@/hooks/use-sessions'
import { useTurnStream } from '@/hooks/use-turn-stream'
import { api, type Compaction, type ModelsPayload, type Msg, type Skill } from '@/lib/api'

/** 压缩提示怎么说。
 *
 * 四种情形由 Hermes 的 summarize_manual_compression() 判定（后端 compress.py 调它，用法与
 * CLI /compress 一致），这里只把它翻成中文，不自己猜：refused_would_grow = 摘要比原文长、
 * Hermes 原地放弃一条没删；aborted = 摘要生成失败；fallback_used = 用降级摘要硬压的；noop = 没变化。
 * 老记录里没带这几个键，就按「条数没减少」当被拒处理。 */
function compNotice(rec: Compaction) {
  const before = rec.before ?? 0
  const after = rec.after ?? 0
  // 只要带上了 Hermes 判定的任一个键，就走官方结论，不再按条数猜
  const judged =
    typeof rec.refused_would_grow === 'boolean' || typeof rec.aborted === 'boolean' ||
    typeof rec.fallback_used === 'boolean' || typeof rec.noop === 'boolean'
  if (rec.refused_would_grow || (!judged && before > 0 && after >= before)) {
    return `压缩被拒 · 摘要比原文长，消息一条没删 · 仍是 ${rec.after ?? '?'} 条`
  }
  if (rec.aborted) return `压缩中止 · 摘要生成失败，消息一条没删 · 仍是 ${rec.after ?? '?'} 条`
  if (rec.noop) return `压缩没变化 · 仍是 ${rec.after ?? '?'} 条消息`
  const head = rec.fallback_used ? '压缩完成（用的是降级摘要）' : '上下文已压缩'
  let line =
    `${head} · ${rec.before ?? '?'} → ${rec.after ?? '?'} 条消息 · ` +
    `约 ${fmtK(rec.before_tokens)} → 约 ${fmtK(rec.after_tokens)}`
  // Hermes 官方注解：压缩把记录改写成更密的摘要时，条数变少而估算值反而会变大，这不算异常
  if (after < before && (rec.after_tokens ?? 0) > (rec.before_tokens ?? 0)) {
    line += '（摘要更密，估算值反而变大）'
  }
  return line
}

export default function Page() {
  const sessions = useSessions()
  const {
    chats,
    query,
    setQuery,
    current,
    messages,
    compactions,
    ctx,
    hasMore,
    loadingEarlier,
    setCurrent,
    setMessages,
    setCtx,
    loadChats,
    loadMoreChats,
    hasMoreChats,
    loadingMoreChats,
    loadChat,
    loadEarlier,
    selectChat,
    newChat,
    renameChat,
    deleteChat,
    liveRef,
  } = sessions

  const turn = useTurnStream({ current, messages, setCurrent, setMessages, setCtx, loadChat, loadChats })
  const { stick, stream, error, rate, steers, queued, compress } = turn
  // 会话加载完发现有一轮还在跑时，由它把连接接上（同一个函数，见 use-turn-stream）
  liveRef.current = turn.attach

  const [model, setModel] = useState('')
  // 页面上可选的模型 / 思考强度（只作用于这个网页，见 model-picker.tsx）
  const [models, setModels] = useState<ModelsPayload | null>(null)
  const loadModels = () => {
    api.models().then(setModels).catch(() => {})
  }
  const [skills, setSkills] = useState<Skill[]>([])
  const [navTab, setNavTab] = useState<NavTab>('chat')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // 右侧预览的文件（null = 不占第三栏）
  const [preview, setPreview] = useState<PreviewTarget | null>(null)
  // 哪条长消息正展开着（只可能有一条）：右下角那个固定的「收起」按钮就是给它的
  const [openLong, setOpenLong] = useState<string | null>(null)
  const scrollBox = useRef<HTMLDivElement>(null)
  const [suggestionSeed, setSuggestionSeed] = useState(0)

  // 动态智能建议：结合最近会话的主题、当前安装的高频技能与常用工程任务自动生成，支持「换一批」洗牌
  const dynamicSuggestions = useMemo(() => {
    const list: string[] = []

    // 1. 基于最近对话的主题（如果有近期对话）
    const recent = chats.filter((c) => c.title && !c.title.includes('新对话') && !c.title.includes('未命名'))
    if (recent.length > 0) {
      const topTitle = recent[suggestionSeed % recent.length].title
      list.push(`继续探讨「${topTitle.slice(0, 16)}」的相关事项`)
    }

    // 2. 基于实际安装的特色技能
    const usefulSkills = skills.filter((s) => s.name && !s.name.startsWith('_'))
    if (usefulSkills.length > 0) {
      const picked = usefulSkills[(suggestionSeed + 1) % usefulSkills.length]
      list.push(`/${picked.name} ${picked.description ? picked.description.slice(0, 20) : '执行该技能'}`)
    }

    // 3. 经典工程开发与系统排查池
    const pool = [
      '审查当前 Git 工作区修改并编写提交说明',
      '分析当前工程架构及潜在性能优化点',
      '写一段用于系统服务健康检查与监控的 Python 脚本',
      '总结一下最近的修改记录与待办项',
      '排查当前服务器进程与内存/磁盘占用情况',
      '解释 SQLite WAL 模式与并发性能调优方法',
    ]

    for (let i = 0; i < pool.length; i++) {
      const candidate = pool[(i + suggestionSeed) % pool.length]
      if (!list.includes(candidate)) list.push(candidate)
      if (list.length >= 3) break
    }

    return list.slice(0, 3)
  }, [chats, skills, suggestionSeed])

  // 首次加载要用它：selectChat 会先同步记住「现在看的是哪个会话」再去拉内容
  const selectChatRef = useRef(selectChat)
  selectChatRef.current = selectChat

  useEffect(() => {
    api.config().then((c) => setModel(c.model)).catch(() => {})
    api.models().then(setModels).catch(() => {})
    api.skills().then((r) => setSkills(r.skills)).catch(() => {})
    loadChats().then((list) => {
      // 只自动打开「今天」的会话（正文是这一屏要用的）。
      // 更早的会话不预加载对话数据：侧栏点标题时才去服务端取（非今日只给 1 个回合）。
      const first = list[0]
      if (first && isToday(first.last_active)) selectChatRef.current(first.id).catch(() => {})
    })
  }, [loadChats])

  // 切会话时把展开着的长消息收起来，并自动平滑滚动到底部
  useEffect(() => {
    setOpenLong(null)
    const box = scrollBox.current
    if (box) {
      stick.current = true
      box.scrollTop = box.scrollHeight
    }
  }, [current])

  // 自动吸底：用户往上翻了就不抢。
  useEffect(() => {
    const box = scrollBox.current
    if (!box || !stick.current) return
    box.scrollTop = box.scrollHeight
  }, [messages, stream?.items, error, stick])

  function onScroll() {
    const box = scrollBox.current
    if (!box) return
    // 正向自上而下流：scrollTop + clientHeight 距离 scrollHeight 差距在 80px 内视为吸底态
    const distToBottom = box.scrollHeight - (box.scrollTop + box.clientHeight)
    stick.current = distToBottom <= 80
  }

  // 记录展开更早消息前的滚动高度差，保证历史消息载入后视口绝不跳动
  const earlierAnchor = useRef<{ height: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (earlierAnchor.current && scrollBox.current) {
      const box = scrollBox.current
      const diff = box.scrollHeight - earlierAnchor.current.height
      if (diff > 0) {
        box.scrollTop = earlierAnchor.current.top + diff
      }
      earlierAnchor.current = null
    }
  }, [messages])

  /* 预览面板一开一关，聊天区宽度就变了：开合前先记一个锚点，布局提交后还回去 */
  const previewAnchor = useRef<{ stick: boolean; el?: HTMLElement; top?: number }>({ stick: true })

  function snapshotBeforePreview() {
    const box = scrollBox.current
    if (!box || stick.current) {
      previewAnchor.current = { stick: true }
      return
    }
    const el = [...box.querySelectorAll<HTMLElement>('.prose-relay')].find(
      (n) => n.getBoundingClientRect().bottom > 0,
    )
    previewAnchor.current = { stick: false, el: el || undefined, top: el ? el.getBoundingClientRect().top : undefined }
  }

  useLayoutEffect(() => {
    const box = scrollBox.current
    if (!box) return
    const a = previewAnchor.current
    const fix = () => {
      if (a.stick || !a.el || a.top == null) {
        if (a.stick) box.scrollTop = box.scrollHeight
        return
      }
      if (!a.el.isConnected) return
      const delta = a.el.getBoundingClientRect().top - a.top
      if (Math.abs(delta) > 0.5) box.scrollTop += delta
    }
    fix()
    const raf1 = requestAnimationFrame(() => {
      fix()
      raf2 = requestAnimationFrame(fix)
    })
    let raf2 = 0
    const timer = window.setTimeout(fix, 120)
    return () => {
      cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
      window.clearTimeout(timer)
    }
  }, [preview])

  // 正文里认出来的文件路径（markdown.ts 的 decorate 打了 data-file-path）点开看
  function onStreamClick(e: ReactMouseEvent<HTMLDivElement>) {
    const el = e.target as HTMLElement
    // 图片：点一下全屏放大（包在链接里的图片不拦，交给链接打开）
    if (el.tagName === 'IMG' && !el.closest('a')) {
      zoomImage((el as HTMLImageElement).src)
      return
    }
    // 站内的样张 / 文档页：在右侧面板里开，不另开窗口。
    // 按住 Ctrl / Cmd / Shift / Alt 点就交给浏览器的默认行为（新标签页 / 新窗口）。
    const link = el.closest('[data-preview-url]')
    const u = link?.getAttribute('data-preview-url')
    if (u && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      snapshotBeforePreview()
      setPreview({ url: u, name: decodeURIComponent(u.split('/').pop() || u) })
      return
    }
    const hit = el.closest('[data-file-path]')
    const p = hit?.getAttribute('data-file-path')
    if (p) {
      snapshotBeforePreview()
      setPreview({ path: p })
    }
  }

  // 时间线 = 消息 + 压缩记录。压缩记录不是固定在底部的特殊节点，
  // 而是一条按时间插进消息流的系统提示，跟着历史一起滚走。
  // 「重新生成」挂在**最后一条提问之后的那条回复**上（保底方案——把上一条提问原样再发一次，不改历史）。
  // 注意定位的是「那条回复」的下标：按钮长在助手消息上，拿提问的下标去比永远对不上（上一版就是这么哑的）。
  const regenerateTarget = useMemo(() => {
    let text = ''
    let replyIdx = -1
    messages.forEach((m, i) => {
      if (m.role === 'user') {
        text = stripAttachmentMarks(m.text || '').trim()
        replyIdx = -1 // 出现新提问：上一条回复不再提供「重新生成」
      } else if (m.role === 'assistant' && text) {
        replyIdx = i
      }
    })
    return replyIdx >= 0 ? { key: `m-${replyIdx}`, text } : null
  }, [messages])

  const timeline = useMemo(() => {
    type Item = { kind: 'msg'; msg: Msg; key: string } | { kind: 'notice'; rec: Compaction; key: string }
    const items: Item[] = messages.map((m, i) => ({ kind: 'msg', msg: m, key: `m-${i}` }))
    // 压缩记录只显示「窗口里够得着」的那条：比窗口最早那条消息还早的先不显示
    const oldest = messages.length ? (typeof messages[0].ts === 'number' ? messages[0].ts : 0) : Infinity
    compactions
      .filter((rec) => messages.length > 0 && (typeof rec.at === 'number' ? rec.at : Infinity) >= oldest)
      .forEach((rec, i) => {
        const at = typeof rec.at === 'number' ? rec.at : Number.MAX_SAFE_INTEGER
        // 插到「第一条晚于压缩时刻的消息」前面；本地刚发出、还没时间戳的消息也按晚于它算。
        let pos = items.length
        for (let j = 0; j < items.length; j++) {
          const it = items[j]
          if (it.kind !== 'msg') continue
          const ts = typeof it.msg.ts === 'number' ? it.msg.ts : null
          if (ts === null || ts > at) {
            pos = j
            break
          }
          pos = j + 1
        }
        items.splice(pos, 0, { kind: 'notice', rec, key: `c-${i}` })
      })
    return items
  }, [messages, compactions])

  const title = chats.find((c) => c.id === current)?.title || '新对话'

  // 统计条的内容：有值才出现。没有内容的格子不渲染，分隔符也跟着少一个。
  // tok/s 不在这儿了：它是「每条回复自己的数」，画在每条回复末尾（见 messages.tsx 的 Tail）。
  // 输入框上方那条状态条 2026-10-13 整个去掉了（用户要求）：缓存命中与压缩提示都挪到
  // 输入框下面那一行（见 composer.tsx 的 meta 行），这里不再有 StatusCell。

  return (
    <div className="flex h-dvh w-screen overflow-hidden bg-page">
      {/* 最左侧 ActivityBar 功能栏 */}
      <ActivityBar
        currentTab={navTab}
        onSelectTab={setNavTab}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/* 主工作区与视图分流 */}
      <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden relative">
        {/* 聊天视图：保持状态与流式连接持续 */}
        <div
          className={cn(
            'app-shell h-full w-full grid grid-cols-[260px_minmax(0,1fr)] overflow-hidden max-[900px]:grid-cols-[minmax(0,1fr)]',
            navTab !== 'chat' && 'hidden',
          )}
          data-preview={preview ? '1' : undefined}
        >
      <Sidebar
        chats={chats}
        query={query}
        onQuery={setQuery}
        current={current}
        open={sidebarOpen}
        onSelect={(id) => {
          setSidebarOpen(false)
          turn.detach()
          void selectChat(id)
        }}
        onNew={() => {
          setSidebarOpen(false)
          turn.detach()
          turn.reset()
          void newChat()
        }}
        onRename={(id, t) => void renameChat(id, t)}
        onDelete={(id) => void deleteChat(id)}
        onOpenSettings={() => setSettingsOpen(true)}
        onClose={() => setSidebarOpen(false)}
        hasMoreChats={hasMoreChats}
        loadingMoreChats={loadingMoreChats}
        onLoadMoreChats={() => void loadMoreChats()}
      />

      <main className="flex min-h-0 min-w-0 flex-col">
        <header className="flex items-center gap-3 px-10 py-3.5 max-[900px]:px-5">
          <button
            className="hidden cursor-pointer rounded-ctl p-[7px] text-muted hover:bg-raised hover:text-ink max-[900px]:inline-flex"
            onClick={() => setSidebarOpen(true)}
            aria-label="打开会话列表"
          >
            <List size={20} />
          </button>
          <h1 className="m-0 truncate font-read text-[16px] font-semibold">{title}</h1>
          <span
            className="ml-auto inline-flex items-center gap-1.5 font-ui text-[12px] whitespace-nowrap text-muted max-[900px]:hidden"
            title={
              turn.link === 'down'
                ? '和后端的连接断了'
                : turn.link === 'live'
                  ? '正在接收这一轮'
                  : '运行中'
            }
          >
            <span
              aria-hidden="true"
              className={
                'size-[7px] rounded-full ' +
                (turn.link === 'down' ? 'bg-danger' : 'bg-ok')
              }
            />
            {turn.link === 'down' ? '连接中断' : turn.link === 'live' ? '接收中' : '运行中'}
          </span>
        </header>

        <div className="relative flex min-h-0 flex-1 flex-col">
          {/* 消息流：正向自上而下滚动，通过顶部弹性占位在消息较少时平稳贴底 */}
          <div
            ref={scrollBox}
            onScroll={onScroll}
            onClick={onStreamClick}
            className="msg-stream flex min-h-0 flex-1 flex-col overflow-y-auto"
          >
            {/* 顶部弹性占位：当消息少于一屏时撑开，将内容推至贴底；超过一屏时自然压缩为 0，正向平稳滚动 */}
            <div className="flex-1 min-h-0" />
            <div className="mx-auto flex w-full max-w-read flex-none flex-col gap-[34px] px-10 pt-[34px] pb-14 max-[900px]:px-5 max-[900px]:py-6">
              {timeline.length === 0 && !stream && (
                <div className="flex flex-1 flex-col items-center justify-center py-16 text-center select-none">
                  <div className="mb-3.5 grid size-11 place-items-center rounded-2xl border border-line bg-panel shadow-[0_2px_8px_rgba(45,45,42,0.04)]">
                    <span className="font-title text-[18px] font-semibold text-accent-text">R</span>
                  </div>
                  <h2 className="font-title text-[17px] font-medium tracking-tight text-ink">
                    随时告诉我你的想法
                  </h2>
                  <p className="mt-1.5 max-w-[420px] font-read text-[13.5px] leading-relaxed text-muted">
                    提问、分析代码、检索资料，或输入 <span className="font-mono text-[12.5px] text-accent-text">/</span> 查看可用技能
                  </p>
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                    {dynamicSuggestions.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => void turn.send(prompt, [])}
                        className="cursor-pointer rounded-full border border-line-strong/60 bg-input px-3.5 py-1.5 font-ui text-[12px] text-ink-2 shadow-[0_1px_2px_rgba(45,45,42,0.03)] transition-all hover:border-accent/50 hover:bg-raised hover:text-ink active:scale-[0.99]"
                      >
                        {prompt}
                      </button>
                    ))}
                    <button
                      type="button"
                      title="换一批建议"
                      onClick={() => setSuggestionSeed((s) => s + 1)}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-line-strong/40 bg-transparent px-2.5 py-1.5 font-ui text-[11.5px] text-muted transition-colors hover:border-accent/40 hover:bg-raised/70 hover:text-accent-text"
                    >
                      <RotateCw className="size-3 transition-transform active:rotate-180" />
                      <span>换一批</span>
                    </button>
                  </div>
                </div>
              )}
              {hasMore && (
                <SoonButton
                  loading={loadingEarlier}
                  onClick={() => {
                    const box = scrollBox.current
                    if (box) {
                      earlierAnchor.current = { height: box.scrollHeight, top: box.scrollTop }
                    }
                    void loadEarlier()
                  }}
                />
              )}
              {timeline.map((it) =>
                it.kind === 'notice' ? (
                  <SystemNotice key={it.key}>
                    {compNotice(it.rec)}
                    {it.rec.seconds ? `（耗时 ${fmtDur(it.rec.seconds)}）` : ''}
                  </SystemNotice>
                ) : it.msg.role === 'user' ? (
                  <UserMessage
                    key={it.key}
                    msg={it.msg}
                    open={openLong === it.key}
                    onToggle={() => setOpenLong(openLong === it.key ? null : it.key)}
                  />
                ) : (
                  <AssistantMessage
                    key={it.key}
                    msg={it.msg}
                    onRegenerate={
                      !stream && regenerateTarget && it.key === regenerateTarget.key
                        ? () => void turn.send(regenerateTarget.text, [])
                        : undefined
                    }
                  />
                ),
              )}

              {stream && (
                <StreamingMessage
                  parts={stream.items}
                  liveTps={rate?.tps ?? null}
                  live={!!rate?.live}
                />
              )}

              {steers.map((t, i) => (
                <SteerNote
                  key={i}
                  tag="插话"
                  text={t}
                  title="这一轮不打断，文字会在下一批工具跑完后送到模型面前"
                />
              ))}

              {queued && (
                <SteerNote
                  tag="排队"
                  text={queued.text}
                  title="压缩期间不接受新的一轮，这条先排着，压完自动发出"
                  hint={<span className="ml-1.5 text-line-strong">（压缩完成后自动发送）</span>}
                />
              )}

              {error && <ErrorMessage text={error} />}
            </div>
          </div>

          {/* 「收起」按钮与统计条：跟消息内容列同宽、同一条左边缘。
              滚动容器现在铺满整列了（为了让滚动条贴到视口最右），这两样不能再直接挂在外层。 */}
          <div className="relative mx-auto w-full max-w-read flex-none">
            {openLong && <CollapseFab onCollapse={() => setOpenLong(null)} />}
          </div>
        </div>

        {/* 需要你点头 / 回答的卡片：贴住输入框上方，不塞进消息流。
            审批常发生在流式输出中途，放在流里会夹进正文、还可能被滚出视口。 */}
        {stream?.approval && (
          <div className="mx-auto w-full max-w-read flex-none px-10 pb-2 max-[900px]:px-5">
            <ApprovalCard data={stream.approval} onDecide={(c) => void turn.decide(c)} />
          </div>
        )}
        {stream?.clarify && (
          <div className="mx-auto w-full max-w-read flex-none px-10 pb-2 max-[900px]:px-5">
            <ClarifyCard
              key={stream.clarify.clarify_id}
              data={stream.clarify}
              onSubmit={(r) => void turn.answerClarify(r)}
            />
          </div>
        )}

        {/* key 按会话变：切换会话时输入框重挂载，草稿各自独立 */}
        <Composer
          key={current ?? 'new'}
          sessionId={current}
          busy={!!stream}
          clarifyPending={!!stream?.clarify}
          context={ctx}
          skills={skills}
          models={models}
          onModelsChanged={loadModels}
          onSend={(text, attachments) => void turn.send(text, attachments)}
          onStop={() => void turn.stop()}
          onSteer={(t) => void turn.steer(t)}
          onCompress={() => void turn.compressCtx()}
          compress={compress}
        />
      </main>

          {/* 点正文里的文件路径时从右边滑出来的预览栏 */}
          {preview && (
            <FilePreview
              target={preview}
              onClose={() => {
                snapshotBeforePreview()
                setPreview(null)
              }}
            />
          )}
        </div>

        {/* 任务看板与进度跟踪器 */}
        {navTab === 'kanban' && <KanbanView />}

        {/* 后台进程与控制台视窗 */}
        {navTab === 'processes' && <ProcessView />}

        {/* 定时任务调度器 */}
        {navTab === 'cron' && <CronView />}

        {/* 交互式产物实时沙箱 */}
        {navTab === 'artifacts' && <ArtifactsView />}
      </div>

      {/* 点图片全屏放大看 */}
      <ImageZoom />

      {/* 设置：记忆 / 用户档案 / 人格三份文件的聚合入口 */}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
