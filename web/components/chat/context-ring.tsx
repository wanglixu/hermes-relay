'use client'

import { useEffect, useRef, useState } from 'react'
import type { ContextStats } from '@/lib/api'
import { cn } from '@/lib/cn'

/** 一万以上改用「万」，中文里比 k/M 好读 */
function fmt(n: number): string {
  if (!n) return '0'
  if (n >= 1e8) return (n / 1e8).toFixed(1) + ' 亿'
  if (n >= 1e4) return (n / 1e4).toFixed(n >= 1e6 ? 0 : 1) + ' 万'
  return String(n)
}


/** 上下文圆环：一圈代表窗口，实心弧是已用。点一下浮层常驻（点别处收起），鼠标悬停也能看 */
export function ContextRing({
  stats,
  onCompress,
  compress,
  busy,
}: {
  stats: ContextStats | null
  onCompress: () => void
  compress: { running: boolean; msg: string } | null
  busy: boolean
}) {
  const pct = stats ? Math.max(0, Math.min(100, stats.percent)) : 0
  const r = 9
  const circ = 2 * Math.PI * r
  const [pinned, setPinned] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // 点开之后点页面别处就收起来
  useEffect(() => {
    if (!pinned) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setPinned(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPinned(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [pinned])

  if (!stats) return null
  return (
    <div className="group relative flex size-9 flex-none items-center justify-center" ref={wrapRef}>
      <div
        className="relative grid size-[26px] cursor-default place-items-center rounded-full"
        tabIndex={0}
        role="button"
        aria-expanded={pinned}
        aria-label={`上下文已用 ${pct.toFixed(0)}%，点开看详情`}
        onClick={() => setPinned((p) => !p)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setPinned((p) => !p)
          }
        }}
      >
        <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
          <circle cx="13" cy="13" r={r} fill="none" stroke="var(--color-line)" strokeWidth="2.6" />
          <circle
            cx="13"
            cy="13"
            r={r}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeDasharray={`${(circ * pct) / 100} ${circ}`}
            transform="rotate(-90 13 13)"
          />
        </svg>
        <span className="absolute inset-0 grid place-items-center font-mono text-[9.5px] tabular-nums text-ink-2">
          {pct < 1 ? pct.toFixed(1) : Math.round(pct)}
        </span>
      </div>
      <div
        role="tooltip"
        className={cn(
          'invisible absolute right-[-4px] bottom-[calc(100%+10px)] z-30 w-[268px] rounded-card border border-line-strong bg-raised px-3.5 py-3 font-ui text-[12px] leading-[1.6] text-ink-2 opacity-0 shadow-[0_12px_32px_rgb(0_0_0/0.5)] transition-[opacity,transform] translate-y-1',
          'before:absolute before:inset-x-0 before:-bottom-2.5 before:h-2.5 before:content-[""]',
          'group-hover:visible group-hover:translate-y-0 group-hover:opacity-100',
          pinned && 'visible translate-y-0 opacity-100',
        )}
      >
        <div className="mb-2 flex items-center justify-between border-b border-line pb-1.5">
          <span className="font-semibold text-ink">上下文用量</span>
          <span className="font-mono text-[11.5px] tabular-nums text-muted">{pct.toFixed(1)}%</span>
        </div>
        <div className="space-y-1 font-mono text-[11.5px] tabular-nums">
          <div className="flex justify-between">
            <span className="font-ui text-muted">已用 / 总量</span>
            <span>{fmt(stats.used)} / {stats.window > 0 ? fmt(stats.window) : '未设'}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-ui text-muted">剩余容量</span>
            <span>{stats.window > 0 ? fmt(Math.max(0, stats.window - stats.used)) : '-'}</span>
          </div>
          {stats.compress_enabled && (
            <div className="flex justify-between">
              <span className="font-ui text-muted">压缩阈值</span>
              <span>{Math.round(stats.compress_threshold * 100)}%（{fmt(stats.compress_at)}）</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="font-ui text-muted">缓存命中</span>
            <span>{stats.cache_hit_rate === null ? '无数据' : `${Math.round(stats.cache_hit_rate * 100)}%`}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-ui text-muted">缓存读 / 写</span>
            <span>{fmt(stats.cache_read)} / {fmt(stats.cache_write)}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-ui text-muted">当前模型</span>
            <span className="truncate max-w-[140px]" title={stats.model}>{stats.model}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-ui text-muted">调用次数</span>
            <span>{stats.calls} 次</span>
          </div>
        </div>
        <div className="mt-2.5 flex items-center gap-2 border-t border-line pt-2">
          <button
            type="button"
            className="flex-1 cursor-pointer rounded-card border border-line-strong bg-transparent py-1 text-center font-ui text-[12px] text-ink-2 transition-colors hover:border-accent-text hover:text-accent-text disabled:cursor-default disabled:opacity-45"
            onClick={onCompress}
            disabled={busy || !!compress?.running}
          >
            {compress?.running ? '压缩中…' : busy ? '等待回复完毕' : '压缩上下文'}
          </button>
          {compress?.msg && (
            <span className="text-[11px] leading-[1.3] text-muted">
              {compress.msg}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

