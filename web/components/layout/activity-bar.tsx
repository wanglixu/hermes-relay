'use client'

import * as Tooltip from '@radix-ui/react-tooltip'
import {
  Box,
  Clock,
  Cpu,
  Kanban,
  MessageSquare,
  Settings,
} from 'lucide-react'
import { cn } from '@/lib/cn'

export type NavTab = 'chat' | 'kanban' | 'processes' | 'cron' | 'artifacts'

interface ActivityBarProps {
  currentTab: NavTab
  onSelectTab: (tab: NavTab) => void
  onOpenSettings: () => void
}

const TABS: { id: NavTab; label: string; icon: typeof MessageSquare }[] = [
  { id: 'chat', label: '聊天', icon: MessageSquare },
  { id: 'kanban', label: '任务看板', icon: Kanban },
  { id: 'processes', label: '后台进程', icon: Cpu },
  { id: 'cron', label: '定时任务', icon: Clock },
  { id: 'artifacts', label: '产物沙箱', icon: Box },
]

export function ActivityBar({ currentTab, onSelectTab, onOpenSettings }: ActivityBarProps) {
  return (
    <Tooltip.Provider delayDuration={200}>
      <aside
        className="flex w-[54px] flex-none flex-col items-center border-r border-line bg-panel py-3 select-none z-10"
        aria-label="功能导航栏"
      >
        {/* 顶部 Hermes Relay 印章微标 */}
        <div className="mb-4 flex flex-col items-center">
          <div
            className="grid size-8 place-items-center rounded-lg bg-accent/90 shadow-[0_1px_3px_rgba(45,45,42,0.12)] transition-transform hover:scale-105"
            title="Hermes Relay"
          >
            <span className="font-title text-[13.5px] font-bold tracking-tight text-on-accent">
              R
            </span>
          </div>
        </div>

        {/* 主功能导航项 */}
        <nav className="flex flex-1 flex-col items-center gap-1.5 w-full px-1.5" aria-label="应用视图切换">
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = currentTab === id
            return (
              <Tooltip.Root key={id}>
                <Tooltip.Trigger asChild>
                  <button
                    type="button"
                    onClick={() => onSelectTab(id)}
                    className={cn(
                      'group relative flex size-10 items-center justify-center rounded-lg transition-all cursor-pointer',
                      active
                        ? 'bg-accent/15 text-accent-text font-medium shadow-[inset_0_0_0_1px_rgba(140,90,59,0.14)]'
                        : 'text-muted hover:bg-raised hover:text-ink active:scale-[0.98]',
                    )}
                    aria-label={label}
                    aria-current={active ? 'page' : undefined}
                  >
                    {active && (
                      <span
                        aria-hidden="true"
                        className="absolute left-0 top-2 bottom-2 w-[2.5px] rounded-r-full bg-accent"
                      />
                    )}
                    <Icon
                      size={19}
                      strokeWidth={active ? 2.2 : 1.8}
                      className={cn(
                        'transition-transform group-hover:scale-105',
                        active && 'scale-105 text-accent-text',
                      )}
                    />
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    side="right"
                    sideOffset={10}
                    className="z-50 rounded-md border border-line-strong/60 bg-input px-2.5 py-1 text-[12px] font-ui text-ink shadow-[0_3px_10px_rgba(45,45,42,0.12)] animate-fade-in"
                  >
                    {label}
                    <Tooltip.Arrow className="fill-line-strong/60" />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            )
          })}
        </nav>

        {/* 底部：设置按钮 */}
        <div className="flex flex-col items-center pt-2 border-t border-line/80 w-full px-1.5">
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button
                type="button"
                onClick={onOpenSettings}
                className="group relative flex size-10 items-center justify-center rounded-lg text-muted transition-all cursor-pointer hover:bg-raised hover:text-ink active:scale-[0.98]"
                aria-label="设置"
              >
                <Settings
                  size={19}
                  strokeWidth={1.8}
                  className="transition-transform group-hover:rotate-45"
                />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                side="right"
                sideOffset={10}
                className="z-50 rounded-md border border-line-strong/60 bg-input px-2.5 py-1 text-[12px] font-ui text-ink shadow-[0_3px_10px_rgba(45,45,42,0.12)] animate-fade-in"
              >
                设置
                <Tooltip.Arrow className="fill-line-strong/60" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </div>
      </aside>
    </Tooltip.Provider>
  )
}
