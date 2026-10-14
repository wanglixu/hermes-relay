'use client'

import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChevronDown, Ellipsis, Loader2, Plus, Search, Settings, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { Chat } from '@/lib/api'

function when(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

/** 按时间分组，避免一长串会话糊成一片 */
function groupOf(ts: number): string {
  if (!ts) return '更早'
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000
  if (ts >= startOfToday) return '今天'
  if (ts >= startOfToday - 86400) return '昨天'
  if (ts >= startOfToday - 6 * 86400) return '本周'
  return '更早'
}

const GROUP_ORDER = ['今天', '昨天', '本周', '更早']

/** 子代理状态说人话 */
const STATE_TEXT: Record<string, string> = {
  completed: '完成',
  running: '跑着',
  in_progress: '跑着',
  failed: '失败',
  cancelled: '已取消',
}

const STATE_CLASS: Record<string, string> = {
  completed: 'text-accent-text',
  running: 'text-think',
  in_progress: 'text-think',
  failed: 'text-danger',
}

export function Sidebar({
  chats,
  query,
  current,
  open,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onOpenSettings,
  onClose,
  onQuery,
  hasMoreChats,
  loadingMoreChats,
  onLoadMoreChats,
}: {
  chats: Chat[]
  query: string
  current: string | null
  open: boolean
  onSelect: (id: string) => void
  onNew: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  onOpenSettings: () => void
  onClose: () => void
  onQuery: (v: string) => void
  /** 还有更早的会话没拉下来（搜索时不出现这个按钮） */
  hasMoreChats: boolean
  loadingMoreChats: boolean
  onLoadMoreChats: () => void
}) {
  const groups = new Map<string, Chat[]>()
  for (const c of chats) {
    const g = groupOf(c.last_active)
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(c)
  }

  return (
    <>
      <div
        className={cn(
          'hidden max-[900px]:fixed max-[900px]:inset-0 max-[900px]:z-10 max-[900px]:bg-black/45',
          open && 'max-[900px]:block',
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={cn(
          'flex min-h-0 min-w-0 flex-col border-r border-line bg-panel',
          'max-[900px]:fixed max-[900px]:inset-y-0 max-[900px]:left-0 max-[900px]:z-20 max-[900px]:w-[84vw]',
          'max-[900px]:max-w-[320px] max-[900px]:transition-transform',
          open ? 'max-[900px]:translate-x-0' : 'max-[900px]:-translate-x-full',
        )}
      >
        <div className="flex items-center gap-2 px-3.5 pt-3.5 pb-2.5">
          <span className="grid size-5 flex-none place-items-center rounded-md bg-accent font-title text-[12px] leading-none font-semibold text-on-accent">
            R
          </span>
          <span className="font-title text-[15px] leading-[1.7] font-semibold tracking-[0.005em]">
            Hermes Relay
          </span>
          <button
            className="ml-auto hidden rounded-md p-[6px] text-muted hover:bg-raised hover:text-ink max-[900px]:inline-flex"
            onClick={onClose}
            aria-label="收起会话列表"
          >
            <X size={17} />
          </button>
        </div>

        <button
          onClick={onNew}
          className="mx-3 mt-0.5 mb-2 flex h-[34px] items-center justify-center gap-1.5 rounded-lg bg-accent text-[12.5px] font-semibold text-on-accent transition-colors hover:bg-accent/86"
        >
          <Plus size={14} strokeWidth={2.6} />
          新对话
        </button>

        <div className="px-3 pb-1.5">
          <div className="relative">
            <Search
              size={13}
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="搜索会话"
              aria-label="搜索会话"
              className="h-[32px] w-full rounded-lg border border-line bg-page pr-8 pl-7 text-[12.5px] text-ink transition-colors placeholder:text-muted focus:border-line-strong focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => onQuery('')}
                aria-label="清空搜索"
                className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1 text-muted hover:bg-raised hover:text-ink"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-label="会话列表">
          {chats.length === 0 && (
            <p className="px-2 py-3 text-[12.5px] text-muted">
              {query ? `没找到带「${query}」的会话。` : '还没有对话，点上面「新对话」开始。'}
            </p>
          )}
          {GROUP_ORDER.filter((g) => groups.has(g)).map((g) => (
            <div key={g}>
              <div className="sticky top-0 z-[1] bg-panel px-2 pt-3 pb-[5px] text-[11px] font-medium tracking-[0.03em] text-muted">
                {g}
              </div>
              {groups.get(g)!.map((c) => (
                <div key={c.id} className="chat-item">
                  <div
                    className={cn(
                      // select-none：标题和时间戳都不该被拖选走（点会话时经常误选中）
                      'group relative flex h-[32px] cursor-pointer items-center gap-1.5 rounded-md pr-1.5 pl-[9px] transition-colors select-none hover:bg-raised',
                      c.id === current && 'bg-accent/15',
                    )}
                    onClick={() => onSelect(c.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') onSelect(c.id)
                    }}
                  >
                    {c.id === current && (
                      <span
                        aria-hidden="true"
                        className="absolute top-1.5 bottom-1.5 left-0 w-px rounded-full bg-accent-text"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div
                        className={cn('truncate text-[12.5px] leading-normal', c.id === current && 'text-ink')}
                        title={c.title || '未命名对话'}
                      >
                        {c.title || '未命名对话'}
                      </div>
                    </div>
                    <span
                      className="flex-none font-mono text-[11px] leading-[1.7] tabular-nums text-muted transition-opacity group-hover:opacity-0"
                      title={`${c.message_count} 条消息`}
                    >
                      {when(c.last_active)}
                      {c.source && c.source !== 'webui' ? ` · ${c.source}` : ''}
                    </span>

                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger asChild>
                        <button
                          /* 高度占满整行：Radix 的菜单挂在 trigger 的下边缘下方，
                             按钮只有 22px 居中时菜单会压在行的下半部、盖住右侧的时间戳。 */
                          /* Radix 关菜单时会把焦点 .focus() 还回这个按钮，Chrome 把程序化聚焦
                             判成 focus-visible，于是收起后一直挂着一圈描边。这里去掉它。 */
                          className="absolute inset-y-0 right-0 inline-flex w-[30px] cursor-pointer items-center justify-center rounded-md text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-ink/8 hover:text-ink focus-visible:outline-none data-[state=open]:bg-ink/8 data-[state=open]:text-ink data-[state=open]:opacity-100"
                          aria-label={`会话操作：${c.title || '未命名对话'}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Ellipsis size={16} strokeWidth={2.4} />
                        </button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content
                          align="end"
                          sideOffset={4}
                          className="z-40 flex min-w-[108px] flex-col rounded-lg border border-line-strong bg-raised p-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <DropdownMenu.Item
                            className="cursor-pointer rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-ink-2 outline-none data-[highlighted]:bg-ink/8 data-[highlighted]:text-ink"
                            onSelect={() => {
                              const t = window.prompt('会话名称', c.title || '')
                              if (t !== null) onRename(c.id, t.trim())
                            }}
                          >
                            重命名
                          </DropdownMenu.Item>
                          <DropdownMenu.Item
                            className="cursor-pointer rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-danger outline-none data-[highlighted]:bg-ink/8"
                            onSelect={() => {
                              if (window.confirm('删除这个会话？记录会从 Hermes 会话库里删掉。'))
                                onDelete(c.id)
                            }}
                          >
                            删除
                          </DropdownMenu.Item>
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  </div>
                  {/* 这个会话派出去的子代理：原生 details，展开收起不用状态 */}
                  {c.agents && c.agents.length > 0 && (
                    <details className="group pr-3 pb-0.5 pl-6">
                      {/* summary 用 flex 而不是 inline-flex：inline-level 会在它上面留出一条行盒空间
                          （实测标题行底 → 折叠行顶 4.7px），块级化之后这段空白消失。 */}
                      <summary className="flex cursor-pointer list-none items-center gap-[5px] text-[11.5px] leading-[1.35] text-muted transition-colors hover:text-ink-2 [&::-webkit-details-marker]:hidden">
                        <span
                          aria-hidden="true"
                          className="inline-block text-[9px] leading-none transition-transform group-open:rotate-90"
                        >
                          ▸
                        </span>
                        {c.agents.length} 个子代理
                      </summary>
                      <ul className="mt-0.5 list-none p-0">
                        {c.agents.map((a) => (
                          <li
                            key={a.id}
                            className="flex items-baseline gap-1.5 py-0.5 text-[11.5px] text-muted"
                          >
                            <span
                              className={cn(
                                'flex-none font-mono text-[10px]',
                                STATE_CLASS[a.state] ?? 'text-muted',
                              )}
                            >
                              {STATE_TEXT[a.state] || a.state}
                            </span>
                            <span className="min-w-0 flex-1 truncate" title={a.goal || a.id}>
                              {a.goal || a.id}
                            </span>
                            {a.seconds != null && (
                              <span className="flex-none font-mono tabular-nums">{a.seconds}s</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              ))}
            </div>
          ))}
          {/* 更早的会话不预加载标题：点这里再往前多拉 LIST_MORE 条 */}
          {hasMoreChats && (
            <button
              type="button"
              onClick={onLoadMoreChats}
              disabled={loadingMoreChats}
              className="mt-1 mb-1 flex h-[32px] w-full cursor-pointer items-center justify-center gap-1.5 rounded-md text-[12.5px] text-muted transition-colors hover:bg-raised hover:text-ink disabled:cursor-default disabled:opacity-60"
            >
              {loadingMoreChats ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  加载中
                </>
              ) : (
                <>
                  <ChevronDown size={13} />
                  更多
                </>
              )}
            </button>
          )}
        </nav>

        {/* 底部：设置入口 */}
        <div className="flex-none border-t border-line px-2 pt-1.5 pb-2">
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex h-[32px] w-full cursor-pointer items-center gap-2.5 rounded-md px-2 text-left text-[12.5px] text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            <Settings size={14} />
            设置
          </button>
        </div>
      </aside>
    </>
  )
}
