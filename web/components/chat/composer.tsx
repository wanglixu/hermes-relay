'use client'

import { FileText, Paperclip, Pencil, Quote, SendHorizontal, Square, Trash2, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
} from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import { Placeholder } from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'

import { api, type Attachment, type ContextStats, type ModelsPayload, type Skill } from '@/lib/api'
import { cn } from '@/lib/cn'
import { DRAFT_PREFIX, loadDraft, saveDraft, serverUrl, uploadDir, type PastedSnippet, type Pending } from '@/lib/composer-draft'
import { fuzzyMatch } from '@/lib/skills-match'
import { ContextRing } from './context-ring'
import { SnippetDialog } from './snippet-dialog'
import { zoomImage } from './image-zoom'
import { ModelPicker } from './model-picker'

function getMarkdownText(editorInstance: any): string {
  if (!editorInstance) return ''
  const mdStorage = (editorInstance.storage as Record<string, any>)?.markdown
  if (typeof mdStorage?.getMarkdown === 'function') {
    return mdStorage.getMarkdown()
  }
  return editorInstance.getText() || ''
}

export function Composer({
  sessionId,
  busy,
  clarifyPending,
  context,
  skills,
  onRefreshSkills,
  models,
  onModelsChanged,
  onSend,
  onStop,
  onSteer,
  onCompress,
  compress,
  quoteIncoming,
  onQuoteIncomingHandled,
}: {
  sessionId: string | null
  busy: boolean
  clarifyPending?: boolean
  context: ContextStats | null
  skills: Skill[]
  onRefreshSkills?: () => void
  /** 页面上可选的模型 / 思考强度（未加载完是 null，那时右下角先不显示） */
  models: ModelsPayload | null
  onModelsChanged: () => void
  onSend: (text: string, attachments: Attachment[]) => void
  onStop: () => void
  onSteer: (text: string) => void
  onCompress: () => void
  compress: { running: boolean; msg: string } | null
  quoteIncoming?: string | null
  onQuoteIncomingHandled?: () => void
}) {
  const storageKey = DRAFT_PREFIX + (sessionId || 'new')
  const initial = useRef(loadDraft(storageKey, sessionId)).current

  // 性能方案 A：不把输入框的完整文本放入 React state，避免每次按键触发整个 Composer 重渲染
  const [hasContent, setHasContent] = useState(Boolean(initial.text.trim()))
  const [files, setFiles] = useState<Pending[]>(initial.files)
  const [pastedSnippets, setPastedSnippets] = useState<PastedSnippet[]>(initial.pasted || [])
  const [quotedSnippet, setQuotedSnippet] = useState<string | null>(initial.quoted || null)
  const [activeSnippet, setActiveSnippet] = useState<PastedSnippet | null>(null)
  const [dragging, setDragging] = useState(false)
  const [multiline, setMultiline] = useState(false)

  // 技能菜单状态
  const [menu, setMenu] = useState<{ start: number; query: string; index: number } | null>(null)
  const menuRef = useRef(menu)
  menuRef.current = menu

  const fileRef = useRef<HTMLInputElement>(null)
  const sendLock = useRef(false)
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const filesRef = useRef(files)
  filesRef.current = files
  const pastedRef = useRef(pastedSnippets)
  pastedRef.current = pastedSnippets
  const quotedRef = useRef(quotedSnippet)
  quotedRef.current = quotedSnippet
  const isClearingRef = useRef(false)

  const canSteer =
    !clarifyPending &&
    (hasContent || files.length > 0 || pastedSnippets.length > 0 || Boolean(quotedSnippet))

  // 监听 Escape 关闭粘贴长文本弹窗
  useEffect(() => {
    if (!activeSnippet) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveSnippet(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeSnippet])

  // 技能匹配列表
  const matches = useMemo(() => {
    if (!menu) return []
    const q = menu.query.trim().toLowerCase()
    const rank = (s: Skill) => {
      if (!q) return 0
      const n = s.name.toLowerCase()
      if (n === q) return -1
      if (n.startsWith(q)) return 0
      if (n.includes(q)) return 1
      if (s.description && s.description.toLowerCase().includes(q)) return 2
      const words = q.split(/[\s-]+/).filter(Boolean)
      if (
        words.length > 0 &&
        words.every(
          (w) =>
            n.includes(w) ||
            (s.description && s.description.toLowerCase().includes(w)) ||
            fuzzyMatch(w, n),
        )
      ) {
        return 2.5
      }
      if (fuzzyMatch(q, n)) return 2.8
      return 3
    }
    const hit = skills.filter((s) => rank(s) < 3)
    hit.sort(
      (a, b) => rank(a) - rank(b) || (b.last_used || 0) - (a.last_used || 0) || a.name.localeCompare(b.name),
    )
    // 方案 B：未输入关键词时展示最近常用的前 8 项；输入搜索词后展示全部匹配项（支持滚动）
    return q ? hit : hit.slice(0, 8)
  }, [menu, skills])

  const matchesRef = useRef(matches)
  matchesRef.current = matches

  const listboxRef = useRef<HTMLDivElement>(null)

  // 键盘切换技能高亮时，自动将选中项滚动到视野内
  useEffect(() => {
    if (!menu || !listboxRef.current) return
    const el = listboxRef.current.querySelector(`[data-index="${menu.index}"]`) as HTMLElement | null
    if (el) {
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [menu?.index])

  function addFiles(list: File[] | FileList | null) {
    if (!list) return
    const next: Pending[] = []
    for (const f of Array.from(list)) {
      const local = URL.createObjectURL(f)
      const item: Pending = { name: f.name, mime: f.type, url: local, localUrl: local }
      item.ready = api
        .upload(uploadDir(sessionId), f)
        .then((a) => {
          item.path = a.path
          item.name = a.name
          item.mime = a.mime
          item.url = serverUrl(sessionId, a.path)
          setFiles((prev) => prev.map((x) => (x === item ? { ...x } : x)))
          return a.path
        })
        .catch(() => '')
      next.push(item)
    }
    if (next.length) setFiles((prev) => [...prev, ...next])
  }

  function pick(list: FileList | null) {
    addFiles(list)
    if (fileRef.current) fileRef.current.value = ''
  }

  // 防抖持久化草稿
  const scheduleSaveDraft = useCallback(
    (currentText: string) => {
      if (isClearingRef.current) return
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        if (isClearingRef.current) return
        saveDraft(storageKey, currentText, filesRef.current, pastedRef.current, quotedRef.current)
      }, 500)
    },
    [storageKey],
  )

  // 挂载时刷新一次技能列表
  useEffect(() => {
    onRefreshSkills?.()
  }, [onRefreshSkills])

  // 检查光标前的斜杠技能
  function checkMenu(editorInstance: any) {
    if (!editorInstance) return
    const { from, empty } = editorInstance.state.selection
    if (!empty) {
      setMenu(null)
      return
    }
    // 取当前光标前最多 50 个字符
    const textBefore = editorInstance.state.doc.textBetween(Math.max(0, from - 50), from, '\n', '\0')
    const m = /(^|[\s\u3000])\/([A-Za-z0-9_.-]*)$/.exec(textBefore)
    if (!m) {
      setMenu(null)
      return
    }
    // 触发斜杠技能匹配时自动刷新最新技能列表，保证外部安装的技能无需刷页面立即可见
    onRefreshSkills?.()
    const start = from - m[2].length - 1
    setMenu((prev) => ({
      start,
      query: m[2],
      index: prev && prev.query === m[2] ? prev.index : 0,
    }))
  }

  // 方案 A/B/C：Tiptap 核心配置
  const editor = useEditor({
    immediatelyRender: false,
    content: initial.text || '',
    extensions: [
      // 方案 B：精简插件载入（体积最轻化控制）
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: { HTMLAttributes: { class: 'font-mono' } },
        dropcursor: false,
        gapcursor: false,
      }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({
        placeholder: clarifyPending ? '先回答上面的问题（回答完就能接着打字）' : '说点什么…',
        emptyEditorClass: 'is-editor-empty',
      }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
        bulletListMarker: '-',
      }),
    ],
    editorProps: {
      attributes: {
        class: 'tiptap',
      },
      // 方案 C：粘贴清洗与图片/长文本拦截
      handlePaste(_view, event) {
        const items = event.clipboardData?.items
        if (items) {
          const imgs: File[] = []
          for (const it of Array.from(items)) {
            if (it.kind === 'file' && it.type.startsWith('image/')) {
              const f = it.getAsFile()
              if (f) imgs.push(f)
            }
          }
          if (imgs.length > 0) {
            event.preventDefault()
            event.stopPropagation()
            addFiles(imgs)
            return true
          }
        }

        const plainText = event.clipboardData?.getData('text/plain')
        if (plainText) {
          const lines = plainText.split(/\r?\n/)
          if (plainText.length > 800 || lines.length > 20) {
            event.preventDefault()
            event.stopPropagation()
            const newSnippet: PastedSnippet = {
              id: 'pasted-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
              content: plainText,
              lines: lines.length,
              bytes: new Blob([plainText]).size,
            }
            setPastedSnippets((prev) => [...prev, newSnippet])
            return true
          }
        }
        return false
      },
      // 键盘与发送快捷键拦截（支持中文/日文输入法隔离）
      handleKeyDown(_view, event) {
        const curMenu = menuRef.current
        const curMatches = matchesRef.current

        // 技能菜单开启时的键盘导航
        if (curMenu && curMatches.length > 0) {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setMenu((m) => (m ? { ...m, index: (m.index + 1) % curMatches.length } : null))
            return true
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setMenu((m) => (m ? { ...m, index: (m.index - 1 + curMatches.length) % curMatches.length } : null))
            return true
          }
          if ((event.key === 'Enter' || event.key === 'Tab') && !event.isComposing) {
            event.preventDefault()
            applySkill(curMatches[curMenu.index].name)
            return true
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            setMenu(null)
            return true
          }
        }

        // 普通回车发送拦截（Shift+Enter 换行，输入法中不发送，防止连击）
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !event.repeat) {
          event.preventDefault()
          void send()
          return true
        }

        return false
      },
    },
    onUpdate({ editor }) {
      if (isClearingRef.current) return
      const empty = editor.isEmpty
      const textNotEmpty = !empty && Boolean(editor.getText().trim())
      setHasContent(textNotEmpty)

      // 多行检测
      const nodeCount = editor.state.doc.childCount
      setMultiline(nodeCount > 1 || editor.getText().includes('\n'))

      // 技能菜单与草稿保存
      checkMenu(editor)
      scheduleSaveDraft(getMarkdownText(editor))
    },
    onSelectionUpdate({ editor }) {
      checkMenu(editor)
    },
  })

  // 清理草稿与重置输入框状态（避免发送后 debounce 定时器残留将已发内容又写回 localStorage）
  const resetComposer = useCallback(() => {
    isClearingRef.current = true
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    try {
      localStorage.removeItem(storageKey)
    } catch {}

    filesRef.current = []
    pastedRef.current = []
    quotedRef.current = null

    if (editor) {
      editor.commands.clearContent()
    }
    setHasContent(false)
    setFiles([])
    setPastedSnippets([])
    setQuotedSnippet(null)
    setMenu(null)

    setTimeout(() => {
      isClearingRef.current = false
      try {
        localStorage.removeItem(storageKey)
      } catch {}
    }, 100)
  }, [editor, storageKey])

  // 接收来自外部的划词引用或整条引用
  useEffect(() => {
    if (quoteIncoming) {
      setQuotedSnippet(quoteIncoming)
      onQuoteIncomingHandled?.()
      if (editor) {
        setTimeout(() => editor.commands.focus('end'), 50)
      }
    }
  }, [quoteIncoming, onQuoteIncomingHandled, editor])

  // 文件、粘贴内容或引用变化时触发草稿保存
  useEffect(() => {
    if (isClearingRef.current) return
    saveDraft(storageKey, getMarkdownText(editor), files, pastedSnippets, quotedSnippet)
  }, [files, pastedSnippets, quotedSnippet, storageKey, editor])

  // 组件卸载时清理定时器，防止卸载后残留定时器将已发送数据写回
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [])

  function applySkill(name: string) {
    if (!editor) return
    const curMenu = menuRef.current
    const { from } = editor.state.selection
    const start = curMenu ? curMenu.start : from
    editor
      .chain()
      .focus()
      .deleteRange({ from: start, to: from })
      .insertContent('/' + name + ' ')
      .run()
    setMenu(null)
  }

  async function send() {
    if (sendLock.current) return
    sendLock.current = true
    try {
      await sendOnce()
    } finally {
      sendLock.current = false
    }
  }

  async function sendOnce() {
    if (!editor) return
    const md = getMarkdownText(editor).trim()

    // 正在生成时为「插话」
    if (busy) {
      let steerBody = md
      if (quotedSnippet) {
        const quoteLines = quotedSnippet
          .trim()
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n')
        steerBody = steerBody ? `${quoteLines}\n\n${steerBody}`.trim() : quoteLines
      }
      if (pastedSnippets.length) {
        const snippetsText = pastedSnippets
          .map((s, idx) => {
            const title = pastedSnippets.length > 1 ? `【已粘贴的参考材料 ${idx + 1}】` : `【已粘贴的参考材料】`
            return `\n\n---\n${title}\n${s.content.trim()}\n---`
          })
          .join('\n')
        steerBody = `${steerBody}${snippetsText}`.trim()
      }
      if (!steerBody) return
      onSteer(steerBody)
      resetComposer()
      return
    }

    if (!md && files.length === 0 && pastedSnippets.length === 0 && !quotedSnippet) return

    const attachments: Attachment[] = []
    const extraPaths: string[] = []
    for (const f of files) {
      const path = f.path || (f.ready ? await f.ready : '')
      if (!path) continue
      attachments.push({ path, name: f.name, mime: f.mime })
      if (!f.mime.startsWith('image/')) extraPaths.push(path)
    }

    let body = md
    if (quotedSnippet) {
      const quoteLines = quotedSnippet
        .trim()
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')
      body = body ? `${quoteLines}\n\n${body}`.trim() : quoteLines
    }
    if (extraPaths.length) {
      body = `${body}\n\n（上传的文件，请自己读取：${extraPaths.join('、')}）`.trim()
    }
    if (pastedSnippets.length) {
      const snippetsText = pastedSnippets
        .map((s, idx) => {
          const title = pastedSnippets.length > 1 ? `【已粘贴的参考材料 ${idx + 1}】` : `【已粘贴的参考材料】`
          return `\n\n---\n${title}\n${s.content.trim()}\n---`
        })
        .join('\n')
      body = `${body}${snippetsText}`.trim()
    }

    onSend(body, attachments)
    resetComposer()
  }

  // 顶层外围拖拽与全局粘贴兜底
  function onContainerPaste(e: ReactClipboardEvent<HTMLDivElement>) {
    // 如果粘贴来源在编辑器内部，已经被 handlePaste 拦截并处理，容器层绝不重复提取
    if ((e.target as HTMLElement)?.closest('.tiptap')) return

    const items = e.clipboardData?.items
    if (!items) return
    const imgs: File[] = []
    for (const it of Array.from(items)) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile()
        if (f) imgs.push(f)
      }
    }
    if (imgs.length) {
      e.preventDefault()
      e.stopPropagation()
      addFiles(imgs)
    }
  }

  return (
    <div
      className="relative mx-auto w-full max-w-read flex-none px-10 pt-0 pb-2 max-[900px]:px-5"
      onPaste={onContainerPaste}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types || []).includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        void addFiles(e.dataTransfer.files)
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-x-10 inset-y-3 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent-text bg-panel/85 text-[13px] font-medium text-accent-text">
          松手就把文件加进来
        </div>
      )}

      {quotedSnippet && (
        <div className="mb-2 flex items-start justify-between gap-3 rounded-xl border border-accent/35 bg-accent/[0.06] p-2.5 text-[12px] shadow-xs transition-all animate-in fade-in slide-in-from-bottom-1 duration-150">
          <div className="flex min-w-0 flex-1 items-start gap-2.5">
            <div className="mt-0.5 flex size-5 flex-none items-center justify-center rounded-md bg-accent/15 text-accent-text">
              <Quote size={12} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-ui text-[11px] font-semibold text-accent-text tracking-wide">
                引用
              </div>
              <div className="mt-0.5 max-h-[68px] overflow-y-auto font-mono text-[11.5px] leading-relaxed text-ink-2/90 break-all select-none pr-1">
                {quotedSnippet}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setQuotedSnippet(null)}
            aria-label="取消引用"
            title="取消引用"
            className="flex-none rounded-md p-1 text-muted hover:bg-accent/15 hover:text-ink transition-colors cursor-pointer"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {(files.length > 0 || pastedSnippets.length > 0) && (
        <div className="mb-2 flex flex-wrap gap-2 items-center">
          {files.map((f, i) =>
            f.mime.startsWith('image/') ? (
              <div className="relative size-[62px]" key={`file-${i}`}>
                <button
                  type="button"
                  onClick={() => zoomImage(f.localUrl ?? f.url)}
                  aria-label={`预览 ${f.name}`}
                  title="点开看大图"
                  className="block size-full cursor-zoom-in border-0 bg-transparent p-0"
                >
                  <img
                    src={f.localUrl ?? f.url}
                    alt={f.name}
                    className="size-full rounded-ctl border border-line object-cover"
                  />
                </button>
                <button
                  className="absolute -top-2 -right-2 size-5 justify-center rounded-full border border-line bg-panel p-0 text-muted hover:text-ink cursor-pointer"
                  aria-label={`移除 ${f.name}`}
                  onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}
                >
                  <X size={12} className="mx-auto" />
                </button>
              </div>
            ) : (
              <div
                className="relative flex h-[62px] max-w-[240px] items-center gap-2 rounded-ctl border border-line bg-raised py-2 pr-7 pl-3"
                key={`file-${i}`}
              >
                <FileText size={15} className="flex-none text-muted" />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">{f.name}</span>
                <button
                  className="absolute -top-2 -right-2 size-5 rounded-full border border-line bg-panel p-0 text-muted hover:text-ink cursor-pointer"
                  aria-label={`移除 ${f.name}`}
                  onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}
                >
                  <X size={12} className="mx-auto" />
                </button>
              </div>
            ),
          )}

          {pastedSnippets.map((snippet) => (
            <div
              key={snippet.id}
              onClick={() => setActiveSnippet(snippet)}
              className="group relative flex h-[72px] w-[210px] cursor-pointer flex-col justify-between rounded-xl border border-line bg-raised p-2.5 shadow-xs transition-all hover:border-line-strong hover:bg-raised/90 select-none"
            >
              <div className="font-mono text-[11px] leading-[1.35] text-muted line-clamp-2 overflow-hidden break-all">
                {snippet.content.slice(0, 140)}
              </div>
              <div className="flex items-center justify-between border-t border-line/40 pt-1 text-[10px]">
                <span className="rounded border border-line bg-panel px-1.5 py-[1px] font-mono font-semibold tracking-wider text-muted">
                  PASTED
                </span>
                <div className="flex items-center gap-1.5 text-muted">
                  <button
                    type="button"
                    className="p-0.5 hover:text-ink cursor-pointer rounded transition-colors"
                    title="编辑 / 查看"
                    onClick={(e) => {
                      e.stopPropagation()
                      setActiveSnippet(snippet)
                    }}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    className="p-0.5 hover:text-danger cursor-pointer rounded transition-colors"
                    title="移除"
                    onClick={(e) => {
                      e.stopPropagation()
                      setPastedSnippets((prev) => prev.filter((s) => s.id !== snippet.id))
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {menu && matches.length > 0 && (
        <div
          ref={listboxRef}
          role="listbox"
          aria-label="技能"
          className="absolute inset-x-0 bottom-[calc(100%-8px)] z-20 max-h-[46vh] overflow-y-auto rounded-card border border-line-strong bg-raised p-1 shadow-[0_12px_32px_rgb(0_0_0/0.5)]"
        >
          <div className="flex items-center justify-between px-2 pt-[5px] pb-1.5 font-ui text-[12.5px] text-muted">
            <span>
              {menu.query
                ? `匹配 “${menu.query}”（共 ${matches.length} 项）`
                : `最近常用（共 ${skills.length} 个技能，输入文字继续搜索）`}
            </span>
            <span>↑↓ 选择 · Enter 确定 · Esc 取消</span>
          </div>
          {matches.map((s, i) => (
            <button
              key={s.name}
              role="option"
              data-index={i}
              aria-selected={i === menu.index}
              className={cn(
                'grid w-full cursor-pointer grid-cols-[auto_auto_minmax(0,1fr)] items-baseline gap-2 rounded-ctl border-0 bg-transparent px-2 py-1.5 text-left font-ui text-[12.5px] text-ink-2',
                i === menu.index && 'bg-accent/16 text-ink',
              )}
              onMouseEnter={() => setMenu((m) => (m ? { ...m, index: i } : m))}
              onMouseDown={(e) => {
                e.preventDefault()
                applySkill(s.name)
              }}
            >
              <span className="font-mono whitespace-nowrap text-accent-text">/{s.name}</span>
              {s.category && <span className="text-[12.5px] whitespace-nowrap text-muted">{s.category}</span>}
              <span className="truncate text-muted">{s.description}</span>
            </button>
          ))}
        </div>
      )}

      <div className={cn('composer-box', multiline && 'composer-box-multiline')}>
        <button
          className="icon-btn cursor-pointer rounded-full bg-raised text-ink-2 transition-colors hover:bg-line hover:text-ink"
          aria-label="添加图片"
          onClick={() => fileRef.current?.click()}
        >
          <Paperclip size={18} strokeWidth={2} />
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => pick(e.target.files)}
        />

        {/* Tiptap 富文本输入区 */}
        <div className="flex-1 min-w-0">
          <EditorContent editor={editor} />
        </div>

        <ContextRing stats={context} onCompress={onCompress} compress={compress} busy={busy} />
        {busy ? (
          <>
            <button
              className={cn(
                'inline-flex h-9 flex-none items-center gap-1.5 rounded-full border px-3.5 text-[12.5px] transition-colors',
                canSteer
                  ? 'cursor-pointer border-accent-text text-accent-text hover:bg-accent-text/10'
                  : 'cursor-default border-line text-ink-2/55',
              )}
              onClick={send}
              disabled={!canSteer}
              aria-label="插话"
            >
              <SendHorizontal size={14} strokeWidth={2.5} />
              插话
            </button>
            <button
              className="inline-flex h-9 flex-none cursor-pointer items-center gap-1.5 rounded-full border border-danger/35 bg-transparent px-3.5 text-[12.5px] text-danger transition-colors hover:border-danger/60 hover:bg-danger/10"
              onClick={onStop}
              aria-label="停止"
            >
              <Square size={12} fill="currentColor" />
              停止
            </button>
          </>
        ) : (
          <button
            className="icon-btn cursor-pointer rounded-full border-0 bg-accent text-on-accent hover:bg-[color-mix(in_srgb,var(--color-accent)_86%,#ffffff)] disabled:cursor-not-allowed disabled:opacity-45"
            aria-label="发送"
            onClick={send}
            disabled={!hasContent && files.length === 0 && pastedSnippets.length === 0 && !quotedSnippet}
          >
            <SendHorizontal size={18} strokeWidth={2} />
          </button>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 px-2">
        <span className="flex min-w-0 items-center gap-2.5 font-mono text-[12.5px] leading-[1.35] tabular-nums text-muted">
          {context ? (
            <span>
              缓存命中 {context.cache_hit_rate === null ? '无数据' : `${Math.round(context.cache_hit_rate * 100)}%`}
            </span>
          ) : null}
          {compress?.msg && (
            <span className={cn('truncate', compress.running ? 'text-accent-text' : undefined)}>
              {compress.msg}
            </span>
          )}
        </span>
        <ModelPicker payload={models} onChanged={onModelsChanged} />
      </div>

      {/* 已粘贴的长文本查看/编辑弹窗（组件在 snippet-dialog.tsx） */}
      <SnippetDialog
        snippet={activeSnippet}
        onChange={(next) => {
          setActiveSnippet(next)
          setPastedSnippets((prev) => prev.map((s) => (s.id === next.id ? next : s)))
        }}
        onDelete={() => {
          setPastedSnippets((prev) => prev.filter((s) => s.id !== activeSnippet?.id))
          setActiveSnippet(null)
        }}
        onClose={() => setActiveSnippet(null)}
      />
    </div>
  )
}
