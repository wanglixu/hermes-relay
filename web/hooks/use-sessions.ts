'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Chat, type Compaction, type ContextStats, type Msg } from '@/lib/api'

// ── 展示窗口的几个常量 ────────────────────────────────────────
const FIRST_TURNS = 3 // 打开会话先给最近几个回合
const OLD_TURNS = 1 // 不是今天的会话，只给 1 个回合
const PAGE_TURNS = 3 // 点一次「展开更早」往前多要几个回合
const CACHE_MAX = 8 // 本地最多留几个会话的数据（按最近使用时间淘汰）
const CACHE_IDLE_MS = 3 * 60 * 1000 // 今日用过的会话闲置这么久，本地就只留最后一个回合
// ── 侧栏会话列表的分页 ────────────────────────────────────────
const LIST_FIRST = 10 // 首屏只拉这么多条标题（以前是一次 100 条）
const LIST_MORE = 20 // 点一次「更多」再加这么多
const SEARCH_LIMIT = 100 // 搜索是主动检索，一次给够（不做分页）

/** 这条会话是不是今天的（只按本地日期算）。page.tsx 也用它决定首屏要不要自动打开。 */
export function isToday(ts?: number): boolean {
  if (!ts) return false
  const d = new Date(ts * 1000)
  const n = new Date()
  return (
    d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
  )
}

/** 只取最后一个回合（从最后一条用户消息开始），给「闲置后只剩 1 个回合」用 */
function lastTurn(msgs: Msg[]): Msg[] {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'user') return msgs.slice(i)
  }
  return msgs
}

type CacheEntry = {
  messages: Msg[]
  compactions: Compaction[]
  hasMore: boolean
  turns: number
  at: number
}

/**
 * 会话列表 + 当前会话的展示窗口。
 * 只切「显示」，不动数据库、不动 Hermes 自己的上下文管理
 * （模型每轮拿到的历史仍是完整的）。
 */
export function useSessions() {
  const [chats, setChats] = useState<Chat[]>([])
  const [query, setQueryState] = useState('') // 侧栏搜索词
  const queryRef = useRef('')
  const [current, setCurrent] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [compactions, setCompactions] = useState<Compaction[]>([])
  const [ctx, setCtx] = useState<ContextStats | null>(null)

  const [hasMore, setHasMore] = useState(false)
  const [loadedTurns, setLoadedTurns] = useState(0)
  const [loadingEarlier, setLoadingEarlier] = useState(false)

  // 侧栏列表：还有更早的会话没拉下来（点「更多」往前扩），以及正在拉
  const [hasMoreChats, setHasMoreChats] = useState(false)
  const [loadingMoreChats, setLoadingMoreChats] = useState(false)

  const cacheRef = useRef<Map<string, CacheEntry>>(new Map())
  const chatsRef = useRef<Chat[]>([])
  const loadedRef = useRef(0)
  const viewRef = useRef<string | null>(null)
  /** 侧栏已经拉到第几条（loadChats 的依赖是空的，只能从 ref 读最新值） */
  const listLimitRef = useRef(LIST_FIRST)
  const loadingMoreRef = useRef(false)
  /** 会话在跑时把连接挂上去：由流状态机注入，这里只在加载完之后叫一声 */
  const liveRef = useRef<((id: string) => Promise<void>) | null>(null)
  chatsRef.current = chats // 每次渲染同步一份，给回调里读会话元数据（是不是今天的）

  const loadChats = useCallback(async () => {
    const q = queryRef.current
    // 搜索：一次给够；平时用「已经拉到第几条」——这样发完一轮后的自动刷新
    // 不会把用户点开的「更多」又缩回 10 条。
    const limit = q ? SEARCH_LIMIT : listLimitRef.current
    try {
      const { chats: list } = await api.listChats(q || undefined, { limit })
      setChats(list)
      // 同步给 ref：下面可能马上要按「是不是今天的会话」决定拉几个回合，
      // 而 setChats 要等下一次渲染才生效，别读到空的列表。
      chatsRef.current = list
      setHasMoreChats(!q && list.length >= limit)
      return list
    } catch {
      return []
    }
  }, [])

  /** 侧栏底部「更多」：窗口从第 N 条扩到第 N+20 条（重新取前 N+20，顺序与去重交给服务端） */
  const loadMoreChats = useCallback(async () => {
    if (loadingMoreRef.current) return
    loadingMoreRef.current = true
    setLoadingMoreChats(true)
    const next = listLimitRef.current + LIST_MORE
    try {
      const { chats: list } = await api.listChats(queryRef.current || undefined, { limit: next })
      setChats(list)
      chatsRef.current = list
      listLimitRef.current = next
      setHasMoreChats(list.length >= next)
    } catch {
      /* 拉不动就保持原样，还能再点一次 */
    } finally {
      loadingMoreRef.current = false
      setLoadingMoreChats(false)
    }
  }, [])

  /** 侧栏搜索词：立刻反映到输入框，220ms 后再去问服务端（打字时不打请求） */
  const setQuery = useCallback((v: string) => {
    queryRef.current = v
    setQueryState(v)
  }, [])

  const searchMounted = useRef(false)
  useEffect(() => {
    if (!searchMounted.current) {
      searchMounted.current = true // 首次挂载不重复拉（初始加载已经拉过一遍）
      return
    }
    const t = setTimeout(() => void loadChats(), 220)
    return () => clearTimeout(t)
  }, [query, loadChats])

  /** 把服务端给的这个展示窗口装进页面，顺便更新本地留的那份 */
  const applyChat = useCallback(
    (
      id: string,
      chat: { messages: Msg[]; compactions?: Compaction[]; has_more?: boolean; turns?: number },
    ) => {
      setMessages(chat.messages)
      setCompactions(chat.compactions ?? [])
      setHasMore(!!chat.has_more)
      setLoadedTurns(chat.turns ?? 0)
      loadedRef.current = chat.turns ?? 0
      if (isToday(chatsRef.current.find((c) => c.id === id)?.last_active)) {
        cacheRef.current.set(id, {
          messages: chat.messages,
          compactions: chat.compactions ?? [],
          hasMore: !!chat.has_more,
          turns: chat.turns ?? 0,
          at: Date.now(),
        })
        // 本地只留最近用过的几个会话，别越攒越多
        while (cacheRef.current.size > CACHE_MAX) {
          const oldest = [...cacheRef.current.entries()]
            .filter(([k]) => k !== id)
            .sort((a, b) => a[1].at - b[1].at)[0]
          if (!oldest) break
          cacheRef.current.delete(oldest[0])
        }
      } else {
        cacheRef.current.delete(id) // 非今日的会话本地不留
      }
    },
    [],
  )

  const loadChat = useCallback(
    async (id: string, keepWindow = false) => {
      const today = isToday(chatsRef.current.find((c) => c.id === id)?.last_active)
      // 今日的会话本地留过就先摆出来，切回来不闪空；随后照样跟服务端对一次
      const cached = today ? cacheRef.current.get(id) : undefined
      if (cached) {
        setMessages(cached.messages)
        setCompactions(cached.compactions)
        setHasMore(cached.hasMore)
        setLoadedTurns(cached.turns)
        loadedRef.current = cached.turns
      }
      // 要几个回合：刚跑完一轮时保住你已经展开的窗口；否则今日 3 个、非今日 1 个
      const want = keepWindow
        ? Math.max(loadedRef.current, FIRST_TURNS)
        : cached
          ? Math.max(cached.turns, FIRST_TURNS)
          : today
            ? FIRST_TURNS
            : OLD_TURNS
      const chat = await api.getChat(id, { turns: want })
      // 请求期间用户可能已经切走/新建了会话：这一份就别再写回页面上了
      if (viewRef.current !== id) return
      applyChat(id, chat)
      // 上下文用量跟会话一起刷新（不额外阻塞渲染）
      api
        .context(id)
        .then((c) => {
          if (viewRef.current === id) setCtx(c)
        })
        .catch(() => {
          if (viewRef.current === id) setCtx(null)
        })
      // 这个会话有一轮还在跑？接上它（同一次请求里就告诉我们了，不用再问一遍）。
      // 这不是轮询：接上之后就是一条长连接，服务端在这一轮结束时主动断开。
      if (chat.live && liveRef.current) {
        // 故意不 await：接上一轮是一条长连接，会一直挂到这一轮结束。
        // 一旦在这里 await，loadChat 的调用方（切换会话、压缩后的重载、发完一轮的收尾）
        // 全都会卡住 —— 压缩后排队的消息就是这么发不出去的。
        void liveRef.current(id).catch(() => {
          /* 接不上就算了，页面已经拿到落库的内容 */
        })
      }
    },
    [applyChat],
  )

  /** 点「展开更早」：往前要一页，接到窗口最前面。服务端只给这一段，老的不会堆在本地。 */
  const loadEarlier = useCallback(async () => {
    const id = viewRef.current
    if (!id || !hasMore || loadingEarlier) return
    setLoadingEarlier(true)
    try {
      const page = await api.getChat(id, { turns: PAGE_TURNS, before: loadedTurns })
      if (!page.messages.length) {
        setHasMore(false)
        return
      }
      const merged = [...page.messages, ...messages]
      setMessages(merged)
      setCompactions((prev) => {
        const seen = new Set(prev.map((r) => JSON.stringify(r)))
        return [...(page.compactions ?? []).filter((r) => !seen.has(JSON.stringify(r))), ...prev]
      })
      const turns = loadedTurns + (page.turns ?? 0)
      setLoadedTurns(turns)
      loadedRef.current = turns
      setHasMore(!!page.has_more)
      const entry = cacheRef.current.get(id)
      if (entry)
        cacheRef.current.set(id, {
          ...entry,
          messages: merged,
          turns,
          hasMore: !!page.has_more,
          at: Date.now(),
        })
    } catch {
      /* 拉失败就保持原样，按钮还能再点 */
    } finally {
      setLoadingEarlier(false)
    }
  }, [hasMore, loadingEarlier, loadedTurns, messages])

  // 今日用过的会话闲置 3 分钟后，本地只留最后一个回合（再往前看要重新向服务端拉）
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now()
      for (const [id, e] of cacheRef.current) {
        if (id === viewRef.current || e.turns <= 1 || now - e.at < CACHE_IDLE_MS) continue
        cacheRef.current.set(id, {
          ...e,
          messages: lastTurn(e.messages),
          turns: 1,
          hasMore: true,
          at: now,
        })
      }
    }, 20000)
    return () => window.clearInterval(timer)
  }, [])

  // 记住当前显示的是哪个会话
  useEffect(() => {
    viewRef.current = current
  }, [current])

  const selectChat = useCallback(
    async (id: string) => {
      if (id === current) return
      // 离开时把「点了新对话但一个字没发」的草稿从内存列表里去掉：它本来就没落库
      //（后端懒创建），留在列表里会变成一条悬空的「未命名对话」。
      setChats((cs) => cs.filter((c) => c.id === id || c.message_count > 0))
      viewRef.current = id
      setCurrent(id)
      await loadChat(id).catch(() => setMessages([]))
    },
    [current, loadChat],
  )

  const newChat = useCallback(async () => {
    const { id } = await api.newChat()
    setChats((c) => [
      {
        id,
        title: '',
        source: 'webui',
        model: '',
        message_count: 0,
        last_active: Date.now() / 1000,
        preview: '',
      },
      // 上一个还没发消息的草稿（连点两次「新对话」时）在这里被换掉，不留残影
      ...c.filter((x) => x.message_count > 0),
    ])
    viewRef.current = id
    setCurrent(id)
    setMessages([])
    setCompactions([])
    // 清掉上一个会话留下的「展开更早」状态，新会话里不该有它
    setHasMore(false)
    setLoadedTurns(0)
    loadedRef.current = 0
    setCtx(null)
    return id
  }, [])

  const renameChat = useCallback(async (id: string, title: string) => {
    await api.rename(id, title)
    setChats((cs) => cs.map((c) => (c.id === id ? { ...c, title } : c)))
  }, [])

  const deleteChat = useCallback(async (id: string) => {
    await api.remove(id)
    const rest = await loadChatsRef.current()
    if (id === viewRef.current) {
      const next = rest[0]?.id ?? null
      setCurrent(next)
      setMessages([])
      setCompactions([])
      if (next) await loadChatRef.current(next).catch(() => {})
    }
  }, [])

  // 给 deleteChat 用：避免把 loadChats/loadChat 放进依赖里造成连环重建
  const loadChatsRef = useRef(loadChats)
  loadChatsRef.current = loadChats
  const loadChatRef = useRef(loadChat)
  loadChatRef.current = loadChat

  return {
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
    setCompactions,
    setCtx,
    setHasMore,
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
    viewRef,
  }
}
