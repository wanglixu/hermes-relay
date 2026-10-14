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
import { List } from 'lucide-react'
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
import {
  CollapseFab,
  SoonButton,
  SteerNote,
  SystemNotice,
} from '@/components/chat/statusbar'
import { isToday, useSessions } from '@/hooks/use-sessions'
import { useTurnStream } from '@/hooks/use-turn-stream'
import { api, type Compaction, type ModelsPayload, type Msg, type Skill } from '@/lib/api'

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
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // 右侧预览的文件（null = 不占第三栏）
  const [preview, setPreview] = useState<PreviewTarget | null>(null)
  // 哪条长消息正展开着（只可能有一条）：右下角那个固定的「收起」按钮就是给它的
  const [openLong, setOpenLong] = useState<string | null>(null)
  const scrollBox = useRef<HTMLDivElement>(null)
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

  // 切会话时把展开着的长消息收起来（那个「收起」按钮是跟着会话的）
  useEffect(() => {
    setOpenLong(null)
  }, [current])

  // 自动吸底：用户往上翻了就不抢。容器是贴底锚定的，scrollTop = 0 就是最底部。
  useEffect(() => {
    const box = scrollBox.current
    if (!box || !stick.current) return
    box.scrollTop = 0
  }, [messages, stream?.items, stream?.approval, error, stick])

  function onScroll() {
    const box = scrollBox.current
    if (!box) return
    // 贴底锚定的容器里 scrollTop 越小越靠底：0 = 到底，往上翻是负值
    stick.current = box.scrollTop >= -80
  }

  /* 预览面板一开一关，聊天区宽度就变了（272 + 内容 + 面板三栏 ←→ 两栏）：
     消息跟着重新换行、总高度变化，**滚动位置会整个跑掉**（实测贴底状态从 scrollTop 0 跳到 -4643，
     视口停在一片空白里）。所以开合前先记一个锚点，布局提交后（useLayoutEffect 里、绘制之前）还回去：
     本来贴着底就仍然贴底，正在看历史就记住视口顶那条正文块的位置。 */
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
    // 一次校正不够：宽度一变，消息要重新换行，布局可能在随后几帧里才稳定下来
    // （图片落位、字体度量修正都会再推一下）。所以头几帧和 120ms 后各补一次。
    const fix = () => {
      if (a.stick || !a.el || a.top == null) {
        box.scrollTop = 0
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
    <div
      className="app-shell grid h-dvh grid-cols-[272px_minmax(0,1fr)] overflow-hidden max-[900px]:grid-cols-[minmax(0,1fr)]"
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
          {/* 消息流：贴底滚动，输入框变高只会压小它，内容仍然贴着底边 */}
          <div
            ref={scrollBox}
            onScroll={onScroll}
            onClick={onStreamClick}
            className="msg-stream flex min-h-0 flex-1 flex-col-reverse overflow-y-auto [overflow-anchor:none]"
          >
            <div className="mx-auto flex min-h-full w-full max-w-read flex-none flex-col gap-[34px] px-10 pt-[34px] pb-5 max-[900px]:px-5 max-[900px]:py-6">
              {hasMore && <SoonButton loading={loadingEarlier} onClick={() => void loadEarlier()} />}
              {timeline.map((it) =>
                it.kind === 'notice' ? (
                  <SystemNotice key={it.key}>
                    上下文已压缩 · {it.rec.before ?? '?'} → {it.rec.after ?? '?'} 条消息 ·{' '}
                    {fmtK(it.rec.before_tokens)} → {fmtK(it.rec.after_tokens)}
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

              {stream?.approval && <ApprovalCard data={stream.approval} onDecide={(c) => void turn.decide(c)} />}

              {stream?.clarify && (
                <ClarifyCard data={stream.clarify} onSubmit={(r) => void turn.answerClarify(r)} />
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

      {/* 点图片全屏放大看 */}
      <ImageZoom />

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

      {/* 设置：记忆 / 用户档案 / 人格三份文件的聚合入口 */}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
