'use client'

import { Fragment, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type StatusCell = { key: string; node: ReactNode }

/** 输入框上面那条细状态条：只有有内容的格子才渲染，整条空了就整条不显示。 */
export function StatusBar({ cells }: { cells: StatusCell[] }) {
  if (cells.length === 0) return null
  return (
    <div className="flex min-h-4 w-full flex-none items-center justify-start gap-2.5 px-10 pb-2 font-mono text-[12.5px] leading-[1.35] tabular-nums text-muted max-[900px]:px-5">
      {cells.map((c, i) => (
        <Fragment key={c.key}>
          {i > 0 && <span className="text-line-strong">|</span>}
          {c.node}
        </Fragment>
      ))}
    </div>
  )
}

/** 上下文压缩这类系统提示：消息流里的一条普通块级元素，随消息一起滚走。 */
export function SystemNotice({ children }: { children: ReactNode }) {
  return (
    <div className="-my-3.5 flex items-center gap-2 py-0.5 font-mono text-[12.5px] leading-[1.5] tabular-nums text-faint">
      <span aria-hidden="true" className="size-[5px] flex-none rounded-full bg-current" />
      {children}
    </div>
  )
}

/** 生成中插的话 / 压缩期间排队的消息 */
export function SteerNote({
  tag,
  text,
  hint,
  title,
}: {
  tag: string
  text: string
  hint?: ReactNode
  title?: string
}) {
  return (
    <div
      className="my-0.5 mb-2.5 border-l border-think-line py-[5px] pr-2.5 pl-3 text-[13px] leading-[1.7] text-muted"
      title={title}
    >
      <span className="mr-2 inline-block rounded-ctl border border-line-strong px-1.5 font-mono text-[10.5px] text-accent-text">
        {tag}
      </span>
      {text}
      {hint}
    </div>
  )
}

/** 长消息展开后右下角的「收起」：固定在正文栏右下角，不跟着消息滚。 */
export function CollapseFab({ onCollapse }: { onCollapse: () => void }) {
  return (
    <button
      className="absolute right-2 bottom-[30px] z-[5] inline-flex cursor-pointer items-center gap-[7px] rounded-ctl border border-line-strong bg-raised py-[7px] pr-[13px] pl-[11px] font-ui text-[12.5px] text-ink-2 transition-colors hover:border-muted hover:bg-panel hover:text-ink"
      onClick={onCollapse}
      title="收起这条长消息"
    >
      <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true">
        <path
          d="M1.2 5.6 4.5 2.6 7.8 5.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
      </svg>
      收起
    </button>
  )
}

export function SoonButton({
  loading,
  onClick,
}: {
  loading: boolean
  onClick: () => void
}) {
  return (
    <div className="flex justify-center">
      <button
        className={cn(
          'rounded-ctl border border-line bg-transparent px-3 py-[5px] font-ui text-[12.5px] text-muted transition-colors hover:border-line-strong hover:text-ink-2 disabled:cursor-default disabled:opacity-50',
        )}
        onClick={onClick}
        disabled={loading}
      >
        {loading ? '加载更早…' : '展开更早'}
      </button>
    </div>
  )
}
