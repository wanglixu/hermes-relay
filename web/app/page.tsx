'use client'

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { List, Quote, RotateCw } from 'lucide-react'
import { Composer } from '@/components/chat/composer'
import { EmptyState } from '@/components/chat/empty-state'
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
import { useRelayConfig } from '@/hooks/use-relay-config'
import { useTurnStream } from '@/hooks/use-turn-stream'
import { api, type Compaction, type ModelsPayload, type Msg, type Skill } from '@/lib/api'
import { ConfirmHost } from '@/components/ui/confirm'
import { ToastHost, notify } from '@/components/ui/toast'

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

  // 当前模型 / 可选模型 / 技能清单：加载与失败提示都在 use-relay-config.ts
  const { model, models, skills, loadModels, loadSkills } = useRelayConfig()
  const [navTab, setNavTab] = useState<NavTab>('chat')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // 右侧预览的文件（null = 不占第三栏）
  const [preview, setPreview] = useState<PreviewTarget | null>(null)
  // 哪条长消息正展开着（只可能有一条）：右下角那个固定的「收起」按钮就是给它的
  const [openLong, setOpenLong] = useState<string | null>(null)
  const scrollBox = useRef<HTMLDivElement>(null)
  const [suggestionSeed, setSuggestionSeed] = useState(0)

  // 划词引用状态
  const [quotePopup, setQuotePopup] = useState<{ text: string; top: number; left: number } | null>(null)
  const [quoteIncoming, setQuoteIncoming] = useState<string | null>(null)

  const handleQuote = (text: string) => {
    if (!text || !text.trim()) return
    setQuoteIncoming(text.trim())
    setQuotePopup(null)
    window.getSelection()?.removeAllRanges()
    // 平滑视口对准输入框
    const composerBox = document.querySelector('.composer-box')
    if (composerBox) {
      composerBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }

  // 动态智能建议：结合最近会话的主题、当前安装的高频技能与常用工程任务自动生成，支持「换一批」洗牌
  const dynamicSuggestions = useMemo(() => {
    const list: string[] = []

    // 1. 基于最近对话的主题（如果有近期对话）
    const recent = (chats || []).filter((c) => c?.title && !c.title.includes('新对话') && !c.title.includes('未命名'))
    if (recent.length > 0) {
      const topTitle = recent[suggestionSeed % recent.length].title
      list.push(`继续探讨「${topTitle.slice(0, 16)}」的相关事项`)
    }

    // 2. 基于实际安装的特色技能
    const usefulSkills = (skills || []).filter((s) => s?.name && !s.name.startsWith('_'))
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
    loadChats().then((list) => {
      // 只自动打开「今天」的会话（正文是这一屏要用的）。
      // 更早的会话不预加载对话数据：侧栏点标题时才去服务端取（非今日只给 1 个回合）。
      const first = list[0]
      if (first && isToday(first.last_active))
        selectChatRef.current(first.id).catch((e) => notify(`打开最近的会话失败：${String((e as Error)?.message || e)}`))
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

  /** 消息流上下那两条 28px 渐隐：只有那一侧真的还藏着内容时才张开。
   *  以前是常开的，结果一小段正文（内容不满一屏）上下也会被啃掉一截 —— 2026-10-19 修。 */
  const syncStreamFade = useCallback(() => {
    const box = scrollBox.current
    if (!box) return
    const distTop = box.scrollTop
    const distBottom = box.scrollHeight - (box.scrollTop + box.clientHeight)
    box.style.setProperty('--fade-top', distTop > 2 ? 'var(--stream-fade)' : '0px')
    box.style.setProperty('--fade-bottom', distBottom > 2 ? 'var(--stream-fade)' : '0px')
  }, [])

  // 内容长高 / 变矮、窗口缩放、切会话都要重算（内容高度变了但盒子尺寸没变，scroll 事件不会来）
  useEffect(() => {
    const box = scrollBox.current
    if (!box) return
    syncStreamFade()
    const ro = new ResizeObserver(() => syncStreamFade())
    Array.from(box.children).forEach((el) => ro.observe(el))
    window.addEventListener('resize', syncStreamFade)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', syncStreamFade)
    }
  }, [syncStreamFade, current])

  // 自动吸底：用户往上翻了就不抢。
  useEffect(() => {
    const box = scrollBox.current
    if (!box || !stick.current) return
    box.scrollTop = box.scrollHeight
    syncStreamFade()
  }, [messages, stream?.items, error, stick, syncStreamFade])

  function onScroll() {
    const box = scrollBox.current
    if (!box) return
    // 正向自上而下流：scrollTop + clientHeight 距离 scrollHeight 差距在 80px 内视为吸底态
    const distToBottom = box.scrollHeight - (box.scrollTop + box.clientHeight)
    stick.current = distToBottom <= 80
    syncStreamFade()
  }

  // 记录展开更早消息前的首个可见元素，保证历史消息载入后视口绝不跳动
  const earlierAnchor = useRef<{ key: string; top: number; expiresAt: number } | null>(null)

  useLayoutEffect(() => {
    if (earlierAnchor.current && scrollBox.current) {
      const box = scrollBox.current
      const anchor = earlierAnchor.current
      let rafId = 0
      const fix = () => {
        if (!anchor) return
        const targetEl = box.querySelector<HTMLElement>(`[data-timeline-key="${anchor.key}"]`)
        if (targetEl && targetEl.isConnected) {
          const delta = targetEl.getBoundingClientRect().top - anchor.top
          if (Math.abs(delta) > 0.5) {
            box.scrollTop += delta
          }
        }
        if (Date.now() < anchor.expiresAt) {
          rafId = requestAnimationFrame(fix)
        } else {
          earlierAnchor.current = null
        }
      }
      fix()
      rafId = requestAnimationFrame(fix)
      return () => {
        if (rafId) cancelAnimationFrame(rafId)
      }
    }
  }, [messages, compactions])

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

  // 监听划词选区，弹出「引用」悬浮条
  useEffect(() => {
    const handleSelection = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) {
        setQuotePopup(null)
        return
      }

      const text = sel.toString().trim()
      if (!text || text.length < 1) {
        setQuotePopup(null)
        return
      }

      const box = scrollBox.current
      if (!box) return

      const anchorNode = sel.anchorNode
      const focusNode = sel.focusNode
      if (!anchorNode || !focusNode) return
      if (!box.contains(anchorNode) || !box.contains(focusNode)) {
        setQuotePopup(null)
        return
      }

      const anchorEl = anchorNode instanceof Element ? anchorNode : anchorNode.parentElement
      const focusEl = focusNode instanceof Element ? focusNode : focusNode.parentElement
      if (
        anchorEl?.closest('.tiptap, input, textarea, button, [contenteditable="true"]') ||
        focusEl?.closest('.tiptap, input, textarea, button, [contenteditable="true"]')
      ) {
        setQuotePopup(null)
        return
      }

      if (sel.rangeCount === 0) return
      const range = sel.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) {
        setQuotePopup(null)
        return
      }

      // 如果选区不在当前视口内，不弹出
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) {
        setQuotePopup(null)
        return
      }

      // 计算悬浮条位置，居中在选区上方（安全限制在视口内部）
      const preferredTop = rect.top - 42
      const top = Math.max(
        16,
        Math.min(
          window.innerHeight - 56,
          preferredTop < 56 ? rect.bottom + 8 : preferredTop,
        ),
      )
      const left = Math.max(48, Math.min(window.innerWidth - 48, rect.left + rect.width / 2))

      setQuotePopup({ text, top, left })
    }

    const onMouseUp = () => {
      setTimeout(handleSelection, 15)
    }

    const onScroll = () => {
      setQuotePopup(null)
    }

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-quote-popup]')) {
        setQuotePopup(null)
      }
    }

    const box = scrollBox.current
    document.addEventListener('mouseup', onMouseUp)
    if (box) {
      box.addEventListener('scroll', onScroll, { passive: true })
    }
    document.addEventListener('mousedown', onMouseDown)

    return () => {
      document.removeEventListener('mouseup', onMouseUp)
      if (box) {
        box.removeEventListener('scroll', onScroll)
      }
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [])

  // 时间线 = 消息 + 压缩记录。压缩记录不是固定在底部的特殊节点，
  // 而是一条按时间插进消息流的系统提示，跟着历史一起滚走。
  // 「重新生成」挂在最后一条提问之后的那条回复上（回滚旧回答并在原地重新发起生成）
  const regenerateTarget = useMemo(() => {
    let hasUser = false
    let replyKey = ''
    messages.forEach((m, i) => {
      if (m.role === 'user') {
        hasUser = true
        replyKey = '' // 出现新提问：上一条回复不再提供「重新生成」
      } else if (m.role === 'assistant' && hasUser) {
        replyKey = m.ts ? `${m.role}-${m.ts}` : `m-${i}`
      }
    })
    return replyKey ? { key: replyKey } : null
  }, [messages])

  const timeline = useMemo(() => {
    type Item = { kind: 'msg'; msg: Msg; key: string } | { kind: 'notice'; rec: Compaction; key: string }
    const items: Item[] = messages.map((m, i) => ({
      kind: 'msg',
      msg: m,
      key: m.ts ? `${m.role}-${m.ts}` : `m-${i}`,
    }))
    // 压缩记录只显示「窗口里够得着」的那条：比窗口最早那条消息还早的先不显示
    const oldest = messages.length ? (typeof messages[0].ts === 'number' ? messages[0].ts : 0) : Infinity
    ;(compactions || [])
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

  // 正在生成的那一轮：历史里已经落了半截（后端边跑边写库），但它还没答完。
  // 这一轮交给 StreamingMessage 展开显示，历史里那条不再渲染 —— 否则会同时出现
  // 「收起的胶囊」和「展开的思维链」（刷新 / 切走再切回时最明显）。
  // 胶囊的口径是「答完之后收成一行」，所以未完成时不该有它。
  const pendingKey = useMemo(() => {
    if (!stream) return null
    for (let i = timeline.length - 1; i >= 0; i--) {
      const it = timeline[i]
      if (it.kind === 'notice') continue
      return it.msg.role === 'assistant' ? it.key : null
    }
    return null
  }, [stream, timeline])

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
          loadSkills()
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
            className="msg-stream flex min-h-0 flex-1 flex-col overflow-y-auto [overflow-anchor:none]"
          >
            {/* 顶部弹性占位：当消息少于一屏时撑开，将内容推至贴底；超过一屏时自然压缩为 0，正向平稳滚动 */}
            <div className="flex-1 min-h-0" />
            <div className="mx-auto flex w-full max-w-read flex-none flex-col gap-[34px] px-10 pt-[34px] pb-14 max-[900px]:px-5 max-[900px]:py-6">
              {timeline.length === 0 && !stream && (
                <EmptyState
                  suggestions={dynamicSuggestions}
                  onPick={(prompt) => void turn.send(prompt, [])}
                  onShuffle={() => setSuggestionSeed((v) => v + 1)}
                />
              )}
              {hasMore && (
                <SoonButton
                  loading={loadingEarlier}
                  onClick={() => {
                    const box = scrollBox.current
                    if (box) {
                      const items = Array.from(box.querySelectorAll<HTMLElement>('[data-timeline-key]'))
                      const visible = items.find((el) => el.getBoundingClientRect().bottom > 0) || items[0]
                      if (visible) {
                        const key = visible.getAttribute('data-timeline-key') || ''
                        const top = visible.getBoundingClientRect().top
                        earlierAnchor.current = { key, top, expiresAt: Date.now() + 450 }
                      }
                      stick.current = false
                    }
                    void loadEarlier()
                  }}
                />
              )}
              {timeline.map((it) => (
                <div key={it.key} data-timeline-key={it.key}>
                  {it.kind === 'notice' ? (
                    <SystemNotice>
                      {compNotice(it.rec)}
                      {it.rec.seconds ? `（耗时 ${fmtDur(it.rec.seconds)}）` : ''}
                    </SystemNotice>
                  ) : it.msg.role === 'user' ? (
                    <UserMessage
                      msg={it.msg}
                      open={openLong === it.key}
                      onToggle={() => setOpenLong(openLong === it.key ? null : it.key)}
                    />
                  ) : (
                    it.kind === 'msg' && it.key === pendingKey ? null : (
                      <AssistantMessage
                        msg={it.msg}
                        onRegenerate={
                          !stream && regenerateTarget && it.key === regenerateTarget.key
                            ? () => void turn.regenerate()
                            : undefined
                        }
                      />
                    )
                  )}
                </div>
              ))}

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
                />
              ))}

              {queued && (
                <SteerNote
                  tag="排队"
                  text={queued.text}
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
          onRefreshSkills={loadSkills}
          models={models}
          onModelsChanged={loadModels}
          onSend={(text, attachments) => void turn.send(text, attachments)}
          onStop={() => void turn.stop()}
          onSteer={(t) => void turn.steer(t)}
          onCompress={() => void turn.compressCtx()}
          compress={compress}
          quoteIncoming={quoteIncoming}
          onQuoteIncomingHandled={() => setQuoteIncoming(null)}
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

      {/* 划词选中助手回复时的微型「引用」悬浮条 */}
      {quotePopup && (
        <div
          data-quote-popup="true"
          style={{
            position: 'fixed',
            top: quotePopup.top,
            left: quotePopup.left,
            transform: 'translateX(-50%)',
            zIndex: 70,
          }}
          onMouseDown={(e) => e.preventDefault()}
          className="pointer-events-auto animate-in fade-in zoom-in-95 duration-100"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              handleQuote(quotePopup.text)
            }}
            className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line-strong/80 bg-panel px-3 py-1 font-ui text-[12px] font-medium text-ink shadow-[0_4px_16px_rgba(45,45,42,0.12)] backdrop-blur-md transition-all hover:border-accent hover:bg-raised hover:text-accent-text active:scale-95 select-none"
          >
            <Quote size={12} className="text-accent-text" />
            <span>引用</span>
          </button>
        </div>
      )}

      {/* 设置：记忆 / 用户档案 / 人格三份文件的聚合入口 */}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {/* 站内确认框与轻提示的宿主：一个页面挂一次，组件里用 confirmAction() / notify() 触发 */}
      <ConfirmHost />
      <ToastHost />
    </div>
  )
}
