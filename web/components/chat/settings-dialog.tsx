'use client'

import { AlertTriangle, BookOpen, Check, ChevronRight, Cpu, Loader2, Palette, Pencil, Plus, Sparkles, Trash2, User, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type MemoryFile, type ModelsPayload } from '@/lib/api'
import { cn } from '@/lib/cn'
import { confirmAction } from '@/components/ui/confirm'
import { notify } from '@/components/ui/toast'
import { THEMES, THEME_META, useTheme } from '@/hooks/use-theme'

const ICONS: Record<string, typeof BookOpen> = { memory: BookOpen, user: User, soul: Sparkles }

function hostOf(url?: string): string {
  if (!url) return ''
  try {
    return new URL(url).host
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0]
  }
}

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

/** 左栏菜单的分组结构：模型与渠道置于首位，方便用户随时进入管理与删除 */
const NAV_GROUPS: { id: string; label: string; keys: string[] }[] = [
  { id: 'models', label: '模型与渠道', keys: ['models'] },
  { id: 'memory', label: '记忆文件', keys: ['memory', 'user', 'soul'] },
  { id: 'interface', label: '界面外观', keys: ['appearance'] },
]
/** 已经被分组列到的 key。后端将来多出别的记忆文件时，它会补进「记忆」组，不会从菜单里消失。 */
const GROUPED_KEYS = new Set(NAV_GROUPS.flatMap((g) => g.keys))
const APPEARANCE_KEY = 'appearance'
const MODELS_KEY = 'models'

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
  const [modelsPayload, setModelsPayload] = useState<ModelsPayload | null>(null)
  const [active, setActive] = useState(MODELS_KEY)
  const [openGroups, setOpenGroups] = useState<string[]>([]) // 展开着的一级菜单（默认一个都不展开）
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const [error, setError] = useState('')
  const { theme } = useTheme()

  // 内联添加渠道与模型状态
  const [addKind, setAddKind] = useState<'none' | 'channel' | 'model'>('none')
  const [addName, setAddName] = useState('')
  const [addBaseUrl, setAddBaseUrl] = useState('')
  const [addApiKey, setAddApiKey] = useState('')
  const [addModelId, setAddModelId] = useState('')
  const [addContext, setAddContext] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')

  // 修改自定义模型弹窗状态
  const [editingModel, setEditingModel] = useState<{
    key: string
    name: string
    model_id: string
    context_length: string
  } | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')

  const file = files.find((f) => f.key === active)
  const chars = editing ? countChars(active, draft) : (file?.chars ?? 0)
  const over = !!file?.limit && chars > file.limit
  const dirty = editing && !!file && draft !== file.content

  // 左栏菜单：分组结构取自 NAV_GROUPS（没有搜索/过滤，用户要求去掉）
  const navItems = useMemo(() => {
    const entry = (key: string): NavEntry | null => {
      if (key === APPEARANCE_KEY) return { key, label: '外观', icon: Palette }
      if (key === MODELS_KEY) return { key, label: '模型与渠道', icon: Cpu }
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
    async (key: string) => {
      if (key === active) return
      if (
        dirty &&
        !(await confirmAction({
          title: '这份文件还有没保存的改动',
          body: '切到别的文件就丢了，确定要切走？',
          confirmText: '切走',
        }))
      )
        return
      setActive(key)
      setEditing(false)
      setSavedMsg('')
      setAddKind('none')
      setAddError('')
    },
    [active, dirty],
  )

  const leaveEdit = useCallback(
    async (force = false) => {
      if (
        !force &&
        dirty &&
        !(await confirmAction({
          title: '退出编辑？',
          body: '有没保存的改动，退出编辑就丢了。',
          confirmText: '丢掉改动',
          danger: true,
        }))
      )
        return false
      setEditing(false)
      return true
    },
    [dirty],
  )

  // 每次打开：拉一次文件，并默认停在「模型与渠道」管理页
  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError('')
    setSavedMsg('')
    setEditing(false)
    setActive(MODELS_KEY)
    setAddKind('none')
    setAddError('')
    setOpenGroups([])
    api
      .memoryFiles()
      .then((r) => setFiles(r.files))
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => setLoading(false))
    api
      .models()
      .then(setModelsPayload)
      .catch(() => {})
  }, [open])

  useEffect(() => {
    const f = files.find((x) => x.key === active)
    if (f) setDraft(f.content)
  }, [active, files])

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

  const handleSaveEdit = useCallback(async () => {
    if (!editingModel || editSaving) return
    if (!editingModel.model_id.trim()) {
      setEditError('模型真实 ID 不能为空')
      return
    }
    setEditSaving(true)
    setEditError('')
    try {
      const res = await api.updateModel({
        key: editingModel.key,
        name: editingModel.name.trim(),
        model_id: editingModel.model_id.trim(),
        context_length: editingModel.context_length.trim() || undefined,
      })
      if (!res.ok) throw new Error(res.error || '保存修改失败')
      const updated = await api.models()
      setModelsPayload(updated)
      setEditingModel(null)
    } catch (err) {
      setEditError(String((err as Error)?.message || err))
    } finally {
      setEditSaving(false)
    }
  }, [editingModel, editSaving])

  // Esc：编辑中就退出编辑，否则关掉弹层；Cmd/Ctrl+S：快捷保存
  useEffect(() => {
    if (!open) return
    const onKey = async (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (editing && dirty && !saving) {
          void save()
        }
        return
      }
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (editingModel) {
        setEditingModel(null)
        return
      }
      if (editing) {
        void leaveEdit()
        return
      }
      if (
        dirty &&
        !(await confirmAction({
          title: '关掉设置？',
          body: '有没保存的改动，关掉就丢了。',
          confirmText: '丢掉改动关掉',
          danger: true,
        }))
      )
        return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, editing, dirty, saving, save, leaveEdit, onClose])

  const close = useCallback(async () => {
    if (
      dirty &&
      !(await confirmAction({
        title: '关掉设置？',
        body: '有没保存的改动，关掉就丢了。',
        confirmText: '丢掉改动关掉',
        danger: true,
      }))
    )
      return
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
            /* 右栏（还没选）：概览控制台，给个完整的入口卡片列表 */
            <section className="min-w-0 flex-1 overflow-y-auto px-6 pt-7" aria-label="设置概览">
              <h3 className="m-0 font-title text-[17px] font-semibold tracking-[0.005em]">系统设置概览</h3>
              <p className="mt-2 mb-4 max-w-[52ch] text-[12.5px] leading-relaxed text-muted">
                管理接入渠道、自定义模型、长期记忆及个性化外观。
              </p>
              <div className="space-y-3 border-t border-line pt-4">
                {/* 1. 模型与渠道入口卡片 */}
                <button
                  type="button"
                  onClick={() => pick(MODELS_KEY)}
                  className="flex w-full cursor-pointer items-center justify-between rounded-card border border-accent/40 bg-accent/[0.02] p-3.5 text-left transition-all hover:border-accent hover:bg-accent/[0.05]"
                >
                  <div className="flex items-center gap-3">
                    <div className="grid size-9 place-items-center rounded-md bg-accent/15 text-accent-text">
                      <Cpu size={18} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-ui text-[14px] font-semibold text-ink">模型与渠道管理</span>
                        <span className="rounded bg-accent/15 px-1.5 py-0.2 font-mono text-[10.5px] text-accent-text">首选主阵地</span>
                      </div>
                      <div className="mt-0.5 text-[12px] text-muted">
                        当前使用：<span className="font-mono text-ink-2">{modelsPayload?.current?.key || modelsPayload?.default_model || '系统默认'}</span>
                        {` · 共 ${modelsPayload?.models?.length || 0} 个模型`}
                      </div>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-muted" />
                </button>

                {/* 2. 长期记忆文件列表 */}
                <div className="rounded-card border border-line bg-page p-3.5">
                  <div className="mb-2 font-ui text-[13px] font-semibold text-ink">长期记忆与行为设定 (~/.hermes/)</div>
                  <ul className="m-0 list-none divide-y divide-line/60 p-0">
                    {files.map((f) => {
                      const Ico = ICONS[f.key] ?? BookOpen
                      return (
                        <li key={f.key}>
                          <button
                            type="button"
                            onClick={() => pick(f.key)}
                            className="flex w-full cursor-pointer items-center justify-between py-2.5 text-left transition-colors hover:text-accent-text"
                          >
                            <span className="flex items-center gap-2">
                              <Ico size={14} className="text-muted" />
                              <span className="font-ui text-[13px] font-medium text-ink">{f.label}</span>
                              <span className="hidden text-[11.5px] text-muted sm:inline">{FILE_NOTE[f.key]}</span>
                            </span>
                            <span className="font-mono text-[11px] tabular-nums text-muted">{fmtK(countChars(f.key, f.content))} 字</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              </div>
            </section>
          ) : active === MODELS_KEY ? (
            /* 右栏（模型与渠道）：展示已配置的渠道与模型概览、增删管理 */
            <section className="flex min-w-0 flex-1 flex-col" aria-label="模型与渠道">
              <div className="flex flex-none items-center justify-between border-b border-line px-5 py-3">
                <div className="flex flex-col gap-0.5">
                  <span className="font-title text-[15px] font-semibold text-ink">模型与渠道管理</span>
                  <span className="font-mono text-[11.5px] text-muted">
                    当前使用模型：<span className="font-medium text-accent-text">{modelsPayload?.current?.key || modelsPayload?.default_model || '系统默认'}</span>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAddKind(addKind === 'channel' ? 'none' : 'channel')
                      setAddError('')
                    }}
                    className={cn(
                      'inline-flex cursor-pointer items-center gap-1 rounded-md px-2.5 py-1.5 font-ui text-[12px] font-medium transition-all active:scale-[0.98]',
                      addKind === 'channel'
                        ? 'bg-accent text-on-accent'
                        : 'border border-line-strong bg-panel text-ink hover:bg-raised',
                    )}
                  >
                    <Plus size={13} />
                    <span>添加渠道</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddKind(addKind === 'model' ? 'none' : 'model')
                      setAddError('')
                    }}
                    className={cn(
                      'inline-flex cursor-pointer items-center gap-1 rounded-md px-2.5 py-1.5 font-ui text-[12px] font-medium transition-all active:scale-[0.98]',
                      addKind === 'model'
                        ? 'bg-accent text-on-accent'
                        : 'border border-line-strong bg-panel text-ink hover:bg-raised',
                    )}
                  >
                    <Plus size={13} />
                    <span>添加单模型</span>
                  </button>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
                {/* 内联添加渠道表单 */}
                {addKind === 'channel' && (
                  <div className="rounded-lg border border-accent/40 bg-accent/[0.03] p-4 shadow-sm">
                    <div className="mb-2.5 flex items-center justify-between">
                      <span className="font-title text-[13.5px] font-semibold text-accent-text">添加 OpenAI 兼容渠道</span>
                      <button
                        type="button"
                        onClick={() => setAddKind('none')}
                        className="cursor-pointer text-muted hover:text-ink"
                      >
                        <X size={15} />
                      </button>
                    </div>
                    <div className="grid gap-2.5 text-[12.5px]">
                      <div>
                        <label className="mb-1 block font-medium text-ink-2">渠道名称（可选，留空默认提取主机名）</label>
                        <input
                          type="text"
                          placeholder="例如：Moonshot、SiliconFlow、中转聚合"
                          value={addName}
                          onChange={(e) => setAddName(e.target.value)}
                          className="w-full rounded-md border border-line bg-page px-3 py-1.5 font-ui text-[13px] text-ink outline-none focus:border-accent"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block font-medium text-ink-2">接口地址 Base URL（必填，以 http/https 开头）</label>
                        <input
                          type="text"
                          placeholder="https://api.openai.com/v1"
                          value={addBaseUrl}
                          onChange={(e) => setAddBaseUrl(e.target.value)}
                          className="w-full rounded-md border border-line bg-page px-3 py-1.5 font-mono text-[12.5px] text-ink outline-none focus:border-accent"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block font-medium text-ink-2">API 密钥 API Key（选填）</label>
                        <input
                          type="password"
                          placeholder="sk-..."
                          value={addApiKey}
                          onChange={(e) => setAddApiKey(e.target.value)}
                          className="w-full rounded-md border border-line bg-page px-3 py-1.5 font-mono text-[12.5px] text-ink outline-none focus:border-accent"
                        />
                      </div>
                      {addError && <div className="text-[12px] text-danger">{addError}</div>}
                      <div className="mt-1 flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setAddKind('none')}
                          className="cursor-pointer rounded-md px-3 py-1 text-[12px] text-muted hover:bg-raised"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          disabled={adding}
                          onClick={async () => {
                            if (!addBaseUrl.trim()) {
                              setAddError('接口地址不能为空')
                              return
                            }
                            setAdding(true)
                            setAddError('')
                            try {
                              const res = await api.addChannel({
                                name: addName.trim(),
                                base_url: addBaseUrl.trim(),
                                api_key: addApiKey.trim(),
                              })
                              if (!res.ok) throw new Error(res.error || '添加渠道失败')
                              const updated = await api.models()
                              setModelsPayload(updated)
                              setAddKind('none')
                              setAddName('')
                              setAddBaseUrl('')
                              setAddApiKey('')
                            } catch (err) {
                              setAddError(String((err as Error)?.message || err))
                            } finally {
                              setAdding(false)
                            }
                          }}
                          className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-accent px-3.5 py-1 text-[12px] font-medium text-on-accent transition-colors hover:bg-accent-text disabled:opacity-50"
                        >
                          {adding ? <Loader2 size={13} className="animate-spin" /> : null}
                          <span>确认添加渠道</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* 内联添加单模型表单 */}
                {addKind === 'model' && (
                  <div className="rounded-lg border border-accent/40 bg-accent/[0.03] p-4 shadow-sm">
                    <div className="mb-2.5 flex items-center justify-between">
                      <span className="font-title text-[13.5px] font-semibold text-accent-text">添加独立自定义模型</span>
                      <button
                        type="button"
                        onClick={() => setAddKind('none')}
                        className="cursor-pointer text-muted hover:text-ink"
                      >
                        <X size={15} />
                      </button>
                    </div>
                    <div className="grid gap-2.5 text-[12.5px]">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="mb-1 block font-medium text-ink-2">模型显示名称（可选）</label>
                          <input
                            type="text"
                            placeholder="例如：Claude 3.7 Sonnet"
                            value={addName}
                            onChange={(e) => setAddName(e.target.value)}
                            className="w-full rounded-md border border-line bg-page px-3 py-1.5 font-ui text-[13px] text-ink outline-none focus:border-accent"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block font-medium text-ink-2">模型真实 ID（必填）</label>
                          <input
                            type="text"
                            placeholder="claude-3-7-sonnet-20250219"
                            value={addModelId}
                            onChange={(e) => setAddModelId(e.target.value)}
                            className="w-full rounded-md border border-line bg-page px-3 py-1.5 font-mono text-[12.5px] text-ink outline-none focus:border-accent"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block font-medium text-ink-2">接口地址 Base URL（必填）</label>
                        <input
                          type="text"
                          placeholder="https://api.openai.com/v1"
                          value={addBaseUrl}
                          onChange={(e) => setAddBaseUrl(e.target.value)}
                          className="w-full rounded-md border border-line bg-page px-3 py-1.5 font-mono text-[12.5px] text-ink outline-none focus:border-accent"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="mb-1 block font-medium text-ink-2">API 密钥 API Key（选填）</label>
                          <input
                            type="password"
                            placeholder="sk-..."
                            value={addApiKey}
                            onChange={(e) => setAddApiKey(e.target.value)}
                            className="w-full rounded-md border border-line bg-page px-3 py-1.5 font-mono text-[12.5px] text-ink outline-none focus:border-accent"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block font-medium text-ink-2">上下文长度（可选，Token 数）</label>
                          <input
                            type="text"
                            placeholder="例如：128000"
                            value={addContext}
                            onChange={(e) => setAddContext(e.target.value)}
                            className="w-full rounded-md border border-line bg-page px-3 py-1.5 font-mono text-[12.5px] text-ink outline-none focus:border-accent"
                          />
                        </div>
                      </div>
                      {addError && <div className="text-[12px] text-danger">{addError}</div>}
                      <div className="mt-1 flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setAddKind('none')}
                          className="cursor-pointer rounded-md px-3 py-1 text-[12px] text-muted hover:bg-raised"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          disabled={adding}
                          onClick={async () => {
                            if (!addBaseUrl.trim() || !addModelId.trim()) {
                              setAddError('接口地址与模型 ID 必填')
                              return
                            }
                            setAdding(true)
                            setAddError('')
                            try {
                              const res = await api.addModel({
                                name: addName.trim(),
                                base_url: addBaseUrl.trim(),
                                api_key: addApiKey.trim(),
                                model_id: addModelId.trim(),
                                context_length: addContext.trim() || undefined,
                              })
                              if (!res.ok) throw new Error(res.error || '添加模型失败')
                              const updated = await api.models()
                              setModelsPayload(updated)
                              setAddKind('none')
                              setAddName('')
                              setAddBaseUrl('')
                              setAddApiKey('')
                              setAddModelId('')
                              setAddContext('')
                            } catch (err) {
                              setAddError(String((err as Error)?.message || err))
                            } finally {
                              setAdding(false)
                            }
                          }}
                          className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-accent px-3.5 py-1 text-[12px] font-medium text-on-accent transition-colors hover:bg-accent-text disabled:opacity-50"
                        >
                          {adding ? <Loader2 size={13} className="animate-spin" /> : null}
                          <span>确认添加模型</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* 分区一：用户自定义接入的渠道与模型（支持全功能删除） */}
                <div>
                  <div className="mb-2 flex items-center justify-between text-[12.5px] font-medium text-ink">
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-accent" />
                      <span>自定义接入渠道与模型</span>
                      <span className="rounded-full bg-accent/15 px-2 py-0.2 font-mono text-[10.5px] font-normal text-accent-text">
                        支持删除
                      </span>
                    </span>
                    <span className="font-normal text-[11px] text-muted">包含你自主添加的渠道与单模型</span>
                  </div>

                  {(() => {
                    const customChannels = modelsPayload?.channels || []
                    const standaloneCustomModels = (modelsPayload?.models || []).filter(
                      (m) => m.source === 'custom' && !m.channel_id,
                    )
                    const hasCustom = customChannels.length > 0 || standaloneCustomModels.length > 0

                    if (!hasCustom) {
                      return (
                        <div className="rounded-card border border-dashed border-line bg-page/60 p-4 text-center">
                          <p className="text-[12.5px] text-muted">暂无自定义渠道或模型。</p>
                          <p className="mt-1 text-[11px] text-faint">
                            可点击右上角「+ 添加渠道」或「+ 添加单模型」接入你自己的第三方 API。
                          </p>
                        </div>
                      )
                    }

                    return (
                      <div className="space-y-3">
                        {/* 1. 自定义渠道卡片 */}
                        {customChannels.map((ch) => {
                          const chModels = (modelsPayload?.models || []).filter((m) => m.channel_id === ch.id)
                          const isCurChan = chModels.some((m) => m.key === modelsPayload?.current?.key)
                          return (
                            <div
                              key={ch.id}
                              className={cn(
                                'rounded-card border p-3.5 transition-all bg-page shadow-[0_1px_2px_rgba(45,45,42,0.02)]',
                                isCurChan ? 'border-accent/40 bg-accent/[0.02]' : 'border-line',
                              )}
                            >
                              <div className="mb-2.5 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="font-ui text-[13.5px] font-semibold text-ink">{ch.name || ch.id}</span>
                                  <span className="rounded-md bg-accent/10 px-1.5 py-0.5 font-mono text-[10.5px] text-accent-text">
                                    自定义渠道
                                  </span>
                                  {isCurChan && (
                                    <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10.5px] font-medium text-accent-text">
                                      在用
                                    </span>
                                  )}
                                  <span className="font-mono text-[11px] text-muted">
                                    ({chModels.length} 个模型 · {hostOf(ch.base_url)})
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  title="删除此渠道及全部关联模型"
                                  onClick={async (e) => {
                                    e.stopPropagation()
                                    if (
                                      !(await confirmAction({
                                        title: `删除渠道「${ch.name || ch.id}」？`,
                                        body: `该渠道下的全部 ${chModels.length} 个模型都将被彻底移除。`,
                                        confirmText: '删除',
                                        danger: true,
                                      }))
                                    )
                                      return
                                    try {
                                      await api.removeChannel(ch.id)
                                      const updated = await api.models()
                                      setModelsPayload(updated)
                                    } catch (err) {
                                      notify(`删除渠道失败：${String((err as Error)?.message || err)}`)
                                    }
                                  }}
                                  className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-danger/30 bg-danger/5 px-2.5 py-1 text-[11.5px] font-medium text-danger transition-all hover:bg-danger hover:text-white active:scale-[0.98]"
                                >
                                  <Trash2 size={12} />
                                  <span>删除渠道</span>
                                </button>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {chModels.map((m) => {
                                  const isCur = m.key === modelsPayload?.current?.key
                                  return (
                                    <span
                                      key={m.key}
                                      className={cn(
                                        'group/model inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11.5px] transition-colors',
                                        isCur
                                          ? 'border-accent bg-accent/10 font-medium text-accent-text'
                                          : 'border-line/70 bg-panel/60 text-ink-2',
                                      )}
                                    >
                                      <span>{m.name || m.key}</span>
                                      {m.context_length ? (
                                        <span className="text-[10px] opacity-60">({Math.round(m.context_length / 1000)}k)</span>
                                      ) : null}
                                      {isCur && (
                                        <span className="rounded bg-accent/20 px-1 py-0.2 text-[10px] font-medium text-accent-text">
                                          在用
                                        </span>
                                      )}
                                      <button
                                        type="button"
                                        title={`修改渠道模型「${m.name || m.key}」`}
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          setEditingModel({
                                            key: m.key,
                                            name: m.name || '',
                                            model_id: m.model_id || (m.key.includes('/') ? m.key.split('/')[1] : m.key),
                                            context_length: m.context_length ? String(m.context_length) : '',
                                          })
                                          setEditError('')
                                        }}
                                        className="ml-0.5 inline-flex size-4 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-accent/20 hover:text-accent-text active:scale-95"
                                      >
                                        <Pencil size={10} strokeWidth={2.5} />
                                      </button>
                                      <button
                                        type="button"
                                        title={isCur ? "此模型当前正在使用中，点击移除并恢复为系统默认模型" : `从渠道中移除模型「${m.name || m.key}」`}
                                        onClick={async (e) => {
                                          e.stopPropagation()
                                          if (
                                            !(await confirmAction({
                                              title: `移除模型「${m.name || m.key}」？`,
                                              body: isCur ? '这个模型当前正在使用中，移除后会自动恢复为系统默认模型。' : '',
                                              confirmText: '移除',
                                              danger: true,
                                            }))
                                          )
                                            return
                                          try {
                                            const res = await api.removeModel(m.key)
                                            if (!res.ok) {
                                              notify('没删掉：这条可能属于某个渠道，去渠道列表里删')
                                              return
                                            }
                                            const updated = await api.models()
                                            setModelsPayload(updated)
                                          } catch (err) {
                                            notify(`移除模型失败：${String((err as Error)?.message || err)}`)
                                          }
                                        }}
                                        className="ml-0.5 inline-flex size-4 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-danger/20 hover:text-danger active:scale-95"
                                      >
                                        <X size={11} strokeWidth={2.5} />
                                      </button>
                                    </span>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })}

                        {/* 2. 独立添加的自定义模型卡片 */}
                        {standaloneCustomModels.length > 0 && (
                          <div className="rounded-card border border-line bg-page p-3.5 shadow-[0_1px_2px_rgba(45,45,42,0.02)]">
                            <div className="mb-2.5 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="font-ui text-[13.5px] font-semibold text-ink">自定义独立模型</span>
                                <span className="rounded-md bg-accent/10 px-1.5 py-0.5 font-mono text-[10.5px] text-accent-text">
                                  独立添加
                                </span>
                                <span className="font-mono text-[11px] text-muted">
                                  ({standaloneCustomModels.length} 个模型)
                                </span>
                              </div>
                            </div>
                            <div className="space-y-2">
                              {standaloneCustomModels.map((m) => {
                                const isCur = m.key === modelsPayload?.current?.key
                                return (
                                  <div
                                    key={m.key}
                                    className={cn(
                                      'flex items-center justify-between gap-3 rounded-md border p-2.5 transition-colors',
                                      isCur
                                        ? 'border-accent/40 bg-accent/[0.04]'
                                        : 'border-line/70 bg-panel/50 hover:bg-panel',
                                    )}
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2">
                                        <span className="font-medium text-[13px] text-ink truncate">{m.name || m.key}</span>
                                        {isCur && (
                                          <span className="rounded bg-accent/20 px-1.5 py-0.2 text-[10px] font-medium text-accent-text shrink-0">
                                            在用
                                          </span>
                                        )}
                                      </div>
                                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] text-muted">
                                        <span className="text-ink-2">ID: {m.model_id || (m.key.startsWith('custom:') ? m.key.split('custom:')[1] : m.key)}</span>
                                        {m.context_length ? (
                                          <span>· 窗口: {m.context_length >= 1000 ? `${Math.round(m.context_length / 1000)}k` : m.context_length}</span>
                                        ) : null}
                                        {m.base_url ? <span>· {hostOf(m.base_url)}</span> : null}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      <button
                                        type="button"
                                        title={`修改模型「${m.name || m.key}」`}
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          setEditingModel({
                                            key: m.key,
                                            name: m.name || '',
                                            model_id: m.model_id || (m.key.startsWith('custom:') ? m.key.split('custom:')[1] : m.key),
                                            context_length: m.context_length ? String(m.context_length) : '',
                                          })
                                          setEditError('')
                                        }}
                                        className="inline-flex cursor-pointer items-center gap-1 rounded border border-line bg-page px-2.5 py-1 text-[11.5px] font-medium text-ink transition-colors hover:border-accent hover:text-accent-text active:scale-95"
                                      >
                                        <Pencil size={11} strokeWidth={2} />
                                        <span>修改</span>
                                      </button>
                                      <button
                                        type="button"
                                        title={isCur ? "此模型当前正在使用中，点击移除并恢复为系统默认模型" : `移除模型「${m.name || m.key}」`}
                                        onClick={async (e) => {
                                          e.stopPropagation()
                                          if (
                                            !(await confirmAction({
                                              title: `移除模型「${m.name || m.key}」？`,
                                              body: isCur ? '这个模型当前正在使用，移除后会自动恢复为系统默认模型。' : '',
                                              confirmText: '移除',
                                              danger: true,
                                            }))
                                          )
                                            return
                                          try {
                                            const res = await api.removeModel(m.key)
                                            if (!res.ok) {
                                              notify('没删掉：这条可能属于某个渠道，去渠道列表里删')
                                              return
                                            }
                                            const updated = await api.models()
                                            setModelsPayload(updated)
                                          } catch (err) {
                                            notify(`移除模型失败：${String((err as Error)?.message || err)}`)
                                          }
                                        }}
                                        className="inline-flex cursor-pointer items-center gap-1 rounded border border-danger/30 bg-danger/5 px-2.5 py-1 text-[11.5px] font-medium text-danger transition-colors hover:bg-danger hover:text-white active:scale-95"
                                      >
                                        <Trash2 size={11} strokeWidth={2} />
                                        <span>移除</span>
                                      </button>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </div>

                {/* 分区二：系统内置渠道（受 Hermes 配置文件保护） */}
                <div className="mt-2 border-t border-line/70 pt-4">
                  <div className="mb-2 flex items-center justify-between text-[12.5px] font-medium text-ink">
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-muted/60" />
                      <span>系统预设渠道与模型</span>
                      <span className="rounded-full bg-panel px-2 py-0.2 font-mono text-[10.5px] font-normal text-muted">
                        ~/.hermes/config.yaml
                      </span>
                    </span>
                    <span className="font-normal text-[11px] text-muted">系统内置项不可直接在网页删除</span>
                  </div>

                  <div className="space-y-2.5 opacity-90">
                    {Array.from(
                      new Set(
                        (modelsPayload?.models || [])
                          .filter((m) => m.source === 'hermes' || !m.source)
                          .map((m) => m.provider || '内置渠道'),
                      ),
                    ).map((prov) => {
                      const provModels = (modelsPayload?.models || []).filter(
                        (m) => (m.source === 'hermes' || !m.source) && (m.provider || '内置渠道') === prov,
                      )
                      const isCurProv = provModels.some((m) => m.key === modelsPayload?.current?.key)
                      return (
                        <div
                          key={prov}
                          className={cn(
                            'rounded-card border p-3 transition-all bg-page/70',
                            isCurProv ? 'border-accent/40 bg-accent/[0.02]' : 'border-line/70',
                          )}
                        >
                          <div className="mb-2 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="font-ui text-[13px] font-medium text-ink-2">{prov}</span>
                              {isCurProv && (
                                <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10.5px] font-medium text-accent-text">
                                  使用中
                                </span>
                              )}
                              <span className="font-mono text-[11px] text-muted">({provModels.length} 个模型)</span>
                            </div>
                            <span className="font-mono text-[10.5px] text-muted/70">内置预设</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {provModels.map((m) => {
                              const isCur = m.key === modelsPayload?.current?.key
                              return (
                                <span
                                  key={m.key}
                                  className={cn(
                                    'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px]',
                                    isCur
                                      ? 'border-accent bg-accent/10 font-medium text-accent-text'
                                      : 'border-line/60 bg-panel/40 text-muted',
                                  )}
                                >
                                  <span>{m.name || m.key}</span>
                                  {isCur && <span className="text-[10px] text-accent-text">· 在用</span>}
                                </span>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </section>
          ) : active === 'appearance' ? (
            /* 右栏（外观）：只剩一套，展示当前配色，不可切换 */
            <section className="flex min-w-0 flex-1 flex-col" aria-label="外观">
              <div className="flex flex-none items-baseline gap-2.5 px-5 pt-4 pb-2">
                <span className="font-title text-[15px] font-semibold">配色</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">目前只有这一套</span>
              </div>
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
                    title={`${chars.toLocaleString()} / ${file.limit.toLocaleString()} 字符`}
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
                      {file?.content?.includes('§') ? (
                        <div className="space-y-2.5">
                          {file.content
                            .split('\n§\n')
                            .map((s) => s.trim())
                            .filter(Boolean)
                            .map((entry, idx) => (
                              <div
                                key={idx}
                                className="rounded-card border border-line bg-page p-3.5 shadow-[0_1px_2px_rgba(45,45,42,0.02)] transition-colors hover:border-line-strong"
                              >
                                <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[11px] font-medium text-accent-text">
                                  <span className="size-1 rounded-full bg-accent-text" />
                                  条目 §{String(idx + 1).padStart(2, '0')}
                                </div>
                                <div className="font-read text-[14px] leading-[1.8] whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">
                                  {entry}
                                </div>
                              </div>
                            ))}
                        </div>
                      ) : (
                        <div className="rounded-card border border-line bg-page p-4 font-read text-[14.5px] leading-[1.9] whitespace-pre-wrap text-ink [overflow-wrap:anywhere] shadow-[0_1px_2px_rgba(45,45,42,0.02)]">
                          {file?.content || '（暂无内容）'}
                        </div>
                      )}
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
                    '保存后文件立刻更新；按 Cmd+S / Ctrl+S 快速保存，从下一段新对话读取生效。'
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

      {/* 修改自定义模型弹窗 */}
      {editingModel && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4 backdrop-blur-[1px] animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget && !editSaving) setEditingModel(null)
          }}
        >
          <div
            className="w-full max-w-[420px] rounded-lg border border-line bg-page p-5 shadow-xl animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3.5 flex items-center justify-between border-b border-line/60 pb-2.5">
              <div className="flex items-center gap-2">
                <Pencil size={15} className="text-accent-text" />
                <h3 className="font-title text-[14.5px] font-semibold text-ink">修改自定义模型</h3>
              </div>
              <button
                type="button"
                disabled={editSaving}
                onClick={() => setEditingModel(null)}
                className="cursor-pointer text-muted hover:text-ink disabled:opacity-40"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3 text-[12.5px]">
              <div>
                <label className="mb-1 block font-medium text-ink-2">模型显示名称（可选）</label>
                <input
                  type="text"
                  placeholder="例如：Claude 3.7 Sonnet"
                  value={editingModel.name}
                  onChange={(e) => setEditingModel({ ...editingModel, name: e.target.value })}
                  className="w-full rounded-md border border-line bg-panel px-3 py-1.5 font-ui text-[13px] text-ink outline-none transition-colors focus:border-accent"
                />
              </div>

              <div>
                <label className="mb-1 block font-medium text-ink-2">模型真实 ID（必填）</label>
                <input
                  type="text"
                  placeholder="例如：claude-3-7-sonnet-20250219"
                  value={editingModel.model_id}
                  onChange={(e) => setEditingModel({ ...editingModel, model_id: e.target.value })}
                  className="w-full rounded-md border border-line bg-panel px-3 py-1.5 font-mono text-[12.5px] text-ink outline-none transition-colors focus:border-accent"
                />
                <span className="mt-1 block text-[11px] text-muted">
                  请求上游 API 时使用的真实 model 参数值
                </span>
              </div>

              <div>
                <label className="mb-1 block font-medium text-ink-2">上下文窗口（可选，Token 数）</label>
                <input
                  type="text"
                  placeholder="例如：128000 或 200000"
                  value={editingModel.context_length}
                  onChange={(e) => setEditingModel({ ...editingModel, context_length: e.target.value })}
                  className="w-full rounded-md border border-line bg-panel px-3 py-1.5 font-mono text-[12.5px] text-ink outline-none transition-colors focus:border-accent"
                />
                <span className="mt-1 block text-[11px] text-muted">
                  留空将尝试向接口或公开目录自动探查；填数字则强制钉死此大小
                </span>
              </div>

              {editError && (
                <div className="rounded border border-danger/30 bg-danger/5 px-2.5 py-1.5 text-[12px] text-danger">
                  {editError}
                </div>
              )}

              <div className="mt-4 flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={editSaving}
                  onClick={() => setEditingModel(null)}
                  className="cursor-pointer rounded-md px-3 py-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-raised disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={editSaving}
                  onClick={handleSaveEdit}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-[12px] font-medium text-on-accent transition-colors hover:bg-accent-text disabled:opacity-50"
                >
                  {editSaving ? <Loader2 size={13} className="animate-spin" /> : null}
                  <span>保存修改</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
