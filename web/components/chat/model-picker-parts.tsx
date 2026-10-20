/** 模型选择面板的公共件：面板阴影 / 文案层级 / 按钮样式 / 行组件。
 *  从 model-picker.tsx 拆出来（2026-10-19），那边八百多行，这些是不带状态的小积木。
 */
import type { RelayModel } from '@/lib/api'
import { cn } from '@/lib/cn'
export const PANEL_SHADOW =
  'shadow-[0_0_0_1px_rgba(45,45,42,0.05),0_4px_10px_rgba(45,45,42,0.10),0_24px_56px_-16px_rgba(45,45,42,0.38)]'

export const PANEL_TITLE = 'px-3 pt-2.5 pb-1 font-mono text-[11.5px] tracking-[0.03em] text-faint'

export const BTN_GHOST =
  'cursor-pointer rounded-ctl border border-line-strong bg-input px-3 py-1.5 font-ui text-[12.5px] text-ink-2 transition-colors hover:border-muted hover:text-ink disabled:cursor-default disabled:opacity-50'
export const BTN_PRIMARY =
  'cursor-pointer rounded-ctl border border-accent bg-accent px-3 py-1.5 font-ui text-[12.5px] text-on-accent transition-colors hover:border-accent-text hover:bg-accent-text disabled:cursor-default disabled:opacity-50'

export type Channel = { id: string; label: string; hint?: string; models: RelayModel[]; channel?: boolean }
/** 左边子面板要显示的内容。`anchorY` = 触发它的那一行相对外层容器的 y，用来把子面板贴到那一行上。 */
export type SubTarget = { kind: 'models' | 'efforts'; channelId?: string; anchorY?: number }

export function hostOf(url?: string): string {
  if (!url) return ''
  try {
    return new URL(url).host
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0]
  }
}

export function buildChannels(models: RelayModel[]): Channel[] {
  const out: Channel[] = []
  const index = new Map<string, Channel>()
  for (const m of models) {
    const custom = m.source === 'custom'
    const host = custom ? hostOf(m.base_url) : ''
    // 渠道里带回来的模型（有 channel_id）单独成组，组名就是渠道名
    const inChannel = Boolean(m.channel_id)
    const id = inChannel ? `chan:${m.channel_id}` : custom ? `custom:${host || m.key}` : `hermes:${m.provider || ''}`
    const label = inChannel
      ? m.channel_name || host || '渠道'
      : custom
        ? host || m.name || '页面添加'
        : m.provider || '未标注渠道'
    let ch = index.get(id)
    if (!ch) {
      ch = { id, label, hint: custom ? m.base_url : undefined, models: [], channel: inChannel }
      index.set(id, ch)
      out.push(ch)
    }
    ch.models.push(m)
  }
  return out
}

export function Chevron({ dir = 'down' }: { dir?: 'down' | 'right' | 'left' }) {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 9 9"
      aria-hidden="true"
      className={cn('flex-none text-faint', dir === 'right' && '-rotate-90', dir === 'left' && 'rotate-90')}
    >
      <path d="M1.6 3.2 4.5 6.1 7.4 3.2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

export function Row({
  children,
  onClick,
  onMouseEnter,
  onMouseLeave,
  className,
}: {
  children: React.ReactNode
  onClick?: () => void
  onMouseEnter?: (e: React.MouseEvent<HTMLButtonElement>) => void
  onMouseLeave?: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        'flex w-full cursor-pointer items-center gap-2.5 border-0 bg-transparent px-3 py-2 text-left transition-colors hover:bg-panel',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function RowText({ name, sub }: { name: string; sub?: string }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate font-mono text-[12.5px] text-ink">{name}</span>
      {sub ? <span className="block truncate text-[11px] text-faint">{sub}</span> : null}
    </span>
  )
}

/** 模型在界面上的写法：**以真实模型 ID 为主**，渠道名另外摆（标题 / 按钮里），
 *  「gw-ds」这种页面上起的化名只在它跟 ID 不同时当副标题，别让它盖掉真身。
 *  渠道名跟 ID 前缀重复时（cline-pass/cline-pass/xxx）去掉那一截。 */
export function modelTitles(m: RelayModel, channelLabel?: string) {
  const raw = m.model_id || m.name || ''
  const id = channelLabel && raw.startsWith(`${channelLabel}/`) ? raw.slice(channelLabel.length + 1) : raw
  const alias = m.name && m.name !== raw && m.name !== id ? m.name : ''
  return { id, alias }
}

export function Tick() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true" className="flex-none text-accent-text">
      <path d="M1.6 5.9 4.2 8.4 9.4 2.9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

