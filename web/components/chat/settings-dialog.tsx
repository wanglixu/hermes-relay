'use client'

import { AlertTriangle, BookOpen, Check, ChevronRight, Loader2, Palette, Pencil, Sparkles, User, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type MemoryFile } from '@/lib/api'
import { cn } from '@/lib/cn'
import { THEMES, THEME_META, useTheme } from '@/hooks/use-theme'

const ICONS: Record<string, typeof BookOpen> = { memory: BookOpen, user: User, soul: Sparkles }

const FILE_NOTE: Record<string, string> = {
  memory: '每次对话都会读到的长期事实。整份就是磁盘上的 MEMORY.md，一条一条用 § 分开。',
  user: '关于你自己的偏好和习惯，整份就是 USER.md。',
  soul: '注入给 agent 的行为规则和说话方式，整份就是 SOUL.md。',
}

/** 和后端 countChars 一个口径（也就是 Hermes 自己的算法）：按完整分隔符 "\n§\n" 切开、
 *  去空白、去重，再用同一个分隔符拼回去数字符。条目内单独的 § 不算分隔符。 */
function countChars(key: string, text: string): number {
  if (key === 'soul') return text.trim().length
  const parts = Array.from(
    new Set(
      text
        .split('\n§\n')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  )
  return parts.join('\n§\n').length
}

const fmtK = (n: number) => n.toLocaleString('zh-CN')

/** 左栏菜单的分组结构：分组里有多项 → 一级菜单可展开收起（默认收起）；
 *  只有一项 → 不做二级菜单，这一项直接当一级菜单用。 */
const NAV_GROUPS: { id: string; label: string; keys: string[] }[] = [
  { id: 'memory', label: '记忆', keys: ['memory', 'user', 'soul'] },
  { id: 'interface', label: '界面', keys: ['appearance'] },
]
/** 已经被分组列到的 key。后端将来多出别的记忆文件时，它会补进「记忆」组，不会从菜单里消失。 */
const GROUPED_KEYS = new Set(NAV_GROUPS.flatMap((g) => g.keys))
const APPEARANCE_KEY = 'appearance'

type NavEntry = { key: string; label: string; icon: typeof BookOpen; chars?: number }

/** 菜单里的一行（一级菜单的单项、二级菜单的文件项，共用）。
 *  nested = 二级菜单：整体左缩进一格，让层级看得见。 */
function NavRow({
  entry,
  activeKey,
  onPick,
  nested = false,
}: {
  entry: NavEntry
  activeKey: string
  onPick: (key: string) => void
  nested?: boolean
}) {
  const on = entry.key === activeKey
  const Ico = entry.icon
  return (
    <button
      type="button"
      onClick={() => onPick(entry.key)}
      aria-current={on}
      className={cn(
        'flex h-[31px] w-full cursor-pointer items-center gap-2.5 rounded-md text-left text-[12.5px] transition-colors',
        nested ? 'pr-2 pl-[22px]' : 'px-2',
        on ? 'bg-raised text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)]' : 'text-ink-2 hover:bg-raised/60 hover:text-ink',
      )}
    >
      <Ico size={14} className={on ? 'text-accent-text' : 'text-muted'} />
      <span className="min-w-0 flex-1 truncate">{entry.label}</span>
      {entry.chars !== undefined && (
        <span className="flex-none font-mono text-[11px] tabular-nums text-muted">{fmtK(entry.chars)}</span>
      )}
    </button>
  )
}

/** 设置弹层：左栏是分组的菜单，右栏是内容区。
 *  菜单只有一份配置（NAV_GROUPS）：分组里有多项就是「可折叠的一级菜单」（默认收起），
 *  只有一项就省掉二级菜单，那一项自己当一级菜单。
 *  打开时右栏是空的——要自己点一项才展开，不默认把记忆全文糊出来。
 *  配色只剩一套暖纸，不再提供切换。 */
export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [files, setFiles] = useState<MemoryFile[]>([])
  const [active, setActive] = useState('')
  const [openGroups, setOpenGroups] = useState<string[]>([]) // 展开着的一级菜单（默认一个都不展开）
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const [error, setError] = useState('')
  const { theme } = useTheme()

  const file = files.find((f) => f.key === active)
  const chars = editing ? countChars(active, draft) : (file?.chars ?? 0)
  const over = !!file?.limit && chars > file.limit
  const dirty = editing && !!file && draft !== file.content

  // 左栏菜单：分组结构取自 NAV_GROUPS（没有搜索/过滤，用户要求去掉）
  const navItems = useMemo(() => {
    const entry = (key: string): NavEntry | null => {
      if (key === APPEARANCE_KEY) return { key, label: '外观', icon: Palette }
      const f = files.find((x) => x.key === key)
      return f ? { key, label: f.label, icon: ICONS[f.key] ?? BookOpen, chars: countChars(f.key, f.content) } : null
    }
    const extra = files.map((f) => f.key).filter((k) => !GROUPED_KEYS.has(k))
    return NAV_GROUPS.map((g) => {
      const keys = g.id === 'memory' ? [...g.keys, ...extra] : g.keys
      return {
        id: g.id,
        label: g.label,
        single: keys.length === 1, // 只有一项就不做二级菜单
        items: keys.map(entry).filter((e): e is NavEntry => !!e),
      }
    }).filter((g) => g.items.length > 0)
  }, [files])

  const toggleGroup = useCallback((id: string) => {
    setOpenGroups((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }, [])

  // 选中某一项时把它所在的分组展开，否则选中状态藏在收起的分组里看不到
  useEffect(() => {
    if (!active) return
    const id = NAV_GROUPS.find((g) => g.keys.includes(active))?.id ?? NAV_GROUPS[0].id
    setOpenGroups((prev) => (prev.includes(id) ? prev : [...prev, id]))
  }, [active])

  const pick = useCallback(
    (key: string) => {
      if (key === active) return
      if (dirty && !window.confirm('这份文件有没保存的改动，切走就丢了。继续？')) return
      setActive(key)
      setEditing(false)
      setSavedMsg('')
    },
    [active, dirty],
  )

  const leaveEdit = useCallback(
    (force = false) => {
      if (!force && dirty && !window.confirm('有没保存的改动，退出编辑就丢了。继续？')) return false
      setEditing(false)
      return true
    },
    [dirty],
  )

  // 每次打开：拉一次文件，并把右栏清空（不默认停在某一项上）
  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError('')
    setSavedMsg('')
    setEditing(false)
    setActive('')
    setOpenGroups([])
    api
      .memoryFiles()
      .then((r) => setFiles(r.files))
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => setLoading(false))
  }, [open])

  useEffect(() => {
    const f = files.find((x) => x.key === active)
    if (f) setDraft(f.content)
  }, [active, files])

  // Esc：编辑中就退出编辑，否则关掉弹层
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (editing) {
        leaveEdit()
        return
      }
      if (dirty && !window.confirm('有没保存的改动，关掉就丢了。继续？')) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, editing, dirty, leaveEdit, onClose])

  const save = useCallback(async () => {
    if (!file || saving) return
    setSaving(true)
    setError('')
    try {
      const r = await api.saveMemoryFile(file.key, draft)
      setFiles((list) => list.map((f) => (f.key === file.key ? { ...f, content: draft, chars: r.chars } : f)))
      setEditing(false)
      setSavedMsg('已保存')
      window.setTimeout(() => setSavedMsg(''), 2600)
    } catch (e) {
      setError(`保存失败：${String((e as Error)?.message || e)}`)
    } finally {
      setSaving(false)
    }
  }, [file, draft, saving])

  const close = useCallback(() => {
    if (dirty && !window.confirm('有没保存的改动，关掉就丢了。继续？')) return
    onClose()
  }, [dirty, onClose])

  // 打开过一次就一直挂着（关闭时不卸载）：这样关闭也有退场动画，第二次打开也不用重新挂载。
  // 显隐完全交给 globals.css 的 .pop-scrim / .pop-modal（纯 CSS，见那里的注释）。
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    if (open) setMounted(true)
  }, [open])
  if (!mounted) return null

  return (
    <div
      data-open={open ? 'true' : undefined}
      className="pop-scrim fixed inset-0 z-50 items-center justify-center bg-black/45 p-10 max-[1100px]:p-5"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div
        data-open={open ? 'true' : undefined}
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        className="pop-modal paper-lift h-[660px] max-h-[calc(100dvh-80px)] w-[1040px] max-w-[calc(100vw-80px)] flex-col overflow-hidden rounded-[9px] border border-line-strong bg-panel"
      >
        <header className="flex flex-none items-center border-b border-line px-4 py-3">
          <h2 className="m-0 font-title text-[14px] font-semibold">设置</h2>
          <button
            type="button"
            aria-label="关闭设置"
            onClick={close}
            className="ml-auto inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* 左栏：菜单。一级菜单默认收起、点标题展开；只有一项的分组不做二级菜单，那一项直接当一级菜单。 */}
          <nav className="flex w-[206px] flex-none flex-col border-r border-line" aria-label="设置分类">
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-1.5 pb-2.5">
              {navItems.map((g) => {
                const open = openGroups.includes(g.id)
                if (g.single) {
                  return (
                    <div key={g.id} className="mt-1.5 flex flex-col">
                      {g.items.map((e) => (
                        <NavRow key={e.key} entry={e} activeKey={active} onPick={pick} />
                      ))}
                    </div>
                  )
                }
                return (
                  <div key={g.id}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(g.id)}
                      aria-expanded={open}
                      className="mt-1.5 flex h-[31px] w-full cursor-pointer items-center gap-2.5 rounded-md px-2 text-left text-[12.5px] font-medium text-ink-2 transition-colors hover:bg-raised/60 hover:text-ink"
                    >
                      <ChevronRight
                        size={14}
                        aria-hidden="true"
                        className={cn('flex-none text-muted transition-transform', open && 'rotate-90')}
                      />
                      <span className="min-w-0 flex-1 truncate">{g.label}</span>
                    </button>
                    {open && (
                      <div className="flex flex-col">
                        {g.items.map((e) => (
                          <NavRow key={e.key} entry={e} activeKey={active} onPick={pick} nested />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </nav>

          {active === '' ? (
            /* 右栏（还没选）：刚打开时就是这一屏，给个轻量的入口列表 */
            <section className="min-w-0 flex-1 overflow-y-auto px-6 pt-7" aria-label="还没选">
              <h3 className="m-0 font-title text-[17px] font-semibold tracking-[0.005em]">记忆与外观</h3>
              <p className="mt-2 mb-4 max-w-[52ch] text-[12.5px] leading-relaxed text-muted">
                左边选一项开始。三份记忆文件整份就是磁盘上的文件，点开可查看和编辑。
              </p>
              <ul className="m-0 list-none border-t border-line p-0">
                {files.map((f) => {
                  const Ico = ICONS[f.key] ?? BookOpen
                  return (
                    <li key={f.key} className="border-b border-line">
                      <button
                        type="button"
                        onClick={() => pick(f.key)}
                        className="flex w-full cursor-pointer items-baseline gap-3 py-3 pr-1 pl-1 text-left transition-all hover:pl-2.5 hover:bg-panel"
                      >
                        <Ico size={15} className="flex-none translate-y-[2px] text-accent-text" />
                        <span className="w-[92px] flex-none font-title text-[14px] leading-normal font-semibold text-ink">
                          {f.label}
                        </span>
                        <span className="min-w-0 flex-1 text-[12.5px] leading-normal text-muted">
                          {FILE_NOTE[f.key]}
                        </span>
                        <span className="flex-none font-mono text-[11.5px] tabular-nums text-muted">
                          {fmtK(countChars(f.key, f.content))}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : active === 'appearance' ? (
            /* 右栏（外观）：只剩一套，展示当前配色，不可切换 */
            <section className="flex min-w-0 flex-1 flex-col" aria-label="外观">
              <div className="flex flex-none items-baseline gap-2.5 px-5 pt-4 pb-2">
                <span className="font-title text-[15px] font-semibold">配色</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">目前只有这一套</span>
              </div>
              <p className="m-0 flex-none px-5 pb-4 text-[12.5px] leading-relaxed text-muted">
                米白棉纸配赭石印泥，像信笺，长时间看也不刺眼。深色 / 冷纸两套已经移除。
              </p>
              <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-5 pb-5">
                {THEMES.map((t) => {
                  const m = THEME_META[t]
                  const on = theme === t
                  return (
                    <div
                      key={t}
                      aria-current={on}
                      className="flex items-center gap-4 rounded-lg border border-accent-text bg-raised p-3.5 text-left"
                    >
                      <span className="flex flex-none gap-1.5">
                        {m.swatches.map((c) => (
                          <span
                            key={c}
                            className="block size-7 rounded-md border border-line-strong"
                            style={{ background: c }}
                          />
                        ))}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-title text-[15px] font-semibold text-ink">{m.label}</span>
                        <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{m.note}</span>
                      </span>
                      <span className="flex flex-none items-center gap-1 text-[12px] text-accent-text">
                        <Check size={15} /> 当前
                      </span>
                    </div>
                  )
                })}
              </div>
            </section>
          ) : (
            /* 右栏（文件）：整份原文；点「编辑」才变成可改 */
            <section className="flex min-w-0 flex-1 flex-col">
              <div className="flex flex-none items-center gap-2.5 border-b border-line px-4.5 py-2.5">
                <span className="font-title text-[13.5px] font-semibold">{file?.label ?? ''}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted" title={file?.path}>
                  {file?.path ?? ''}
                </span>
                {file?.limit ? (
                  <span
                    className={cn(
                      'flex-none font-mono text-[11.5px] tabular-nums',
                      over ? 'text-danger-text' : 'text-muted',
                    )}
                    title={`按 Hermes 的口径数出来是 ${fmtK(chars)} 字符，上限 ${fmtK(file.limit)}。超了 agent 就没法再往里追加新内容。`}
                  >
                    {fmtK(chars)} / {fmtK(file.limit)}
                  </span>
                ) : (
                  <span className="flex-none font-mono text-[11.5px] tabular-nums text-muted">
                    {fmtK(chars)} 字符
                  </span>
                )}
              </div>

              {loading ? (
                <div className="flex flex-1 items-center justify-center text-muted">
                  <Loader2 size={18} className="animate-spin" />
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col px-4.5 pt-3 pb-1">
                  {editing ? (
                    <textarea
                      autoFocus
                      value={draft}
                      onChange={(e) => {
                        setDraft(e.target.value)
                        setSavedMsg('')
                      }}
                      spellCheck={false}
                      aria-label={`${file?.label ?? ''} 文件内容`}
                      className="block min-h-0 w-full flex-1 resize-none rounded-md border border-line-strong bg-page px-3.5 py-3 font-read text-[14.5px] leading-[1.9] text-ink outline-none transition-colors"
                    />
                  ) : (
                    <div className="min-h-0 flex-1 overflow-y-auto rounded-md px-3.5 py-3">
                      <pre className="m-0 font-read text-[14.5px] leading-[1.9] whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">
                        {file?.content ?? ''}
                      </pre>
                    </div>
                  )}
                  {over && (
                    <div className="mt-2 flex items-center gap-1.5 text-[12px] text-danger-text">
                      <AlertTriangle size={13} />
                      已超出上限 {fmtK(chars - (file?.limit ?? 0))} 字符。Hermes 不会拒绝这份文件，但它以后没法再自动往里追加新记忆了。
                    </div>
                  )}
                </div>
              )}

              <footer className="flex flex-none items-center gap-2.5 border-t border-line px-4.5 py-2.5">
                <span className="mr-auto text-[12px] leading-snug text-muted">
                  {error ? (
                    <span className="text-danger-text">{error}</span>
                  ) : savedMsg ? (
                    <span className="inline-flex items-center gap-1 text-accent-text">
                      <Check size={12} /> {savedMsg}
                    </span>
                  ) : editing ? (
                    '保存后文件立刻更新；正在进行的这段对话仍按旧内容走，从下一段新对话开始读取。'
                  ) : null}
                </span>
                {editing ? (
                  <>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => leaveEdit()}
                      className="inline-flex h-[30px] cursor-pointer items-center rounded-md border border-line px-3 text-[12.5px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      disabled={!dirty || saving}
                      onClick={() => void save()}
                      className="inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-md border-0 bg-accent px-3 text-[12.5px] font-semibold text-on-accent transition-colors hover:bg-accent/86 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {saving && <Loader2 size={13} className="animate-spin" />}
                      保存
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => {
                      const f = files.find((x) => x.key === active)
                      if (f) setDraft(f.content)
                      setEditing(true)
                    }}
                    className="inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-md border border-line px-3 text-[12.5px] text-ink transition-colors hover:border-accent-text hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Pencil size={12} />
                    编辑
                  </button>
                )}
              </footer>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
