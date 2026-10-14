'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Code2, Copy, Download, Eye, FileText, Globe, X } from 'lucide-react'
import { decorate, renderMarkdown } from '@/lib/markdown'

/** 两种预览目标：本机文件（后端读内容）或站内页面（iframe 直接开）。 */
export type PreviewTarget = { path?: string; name?: string; url?: string }

type Payload = {
  ok: boolean
  error?: string
  path?: string
  realPath?: string
  name?: string
  ext?: string
  kind?: string
  size?: number
  mtime?: number
  content?: string
}

const BTN =
  'inline-flex cursor-pointer items-center gap-1.5 rounded-ctl border border-line bg-raised px-2 py-[3px] font-mono text-[11.5px] leading-[1.4] text-muted transition-colors hover:border-line-strong hover:text-ink'

function fmtSize(n?: number): string {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

/** 右侧的文件预览面板：Markdown 渲染出来看，其它类型按等宽纯文本看。
 *  小屏（<900px）没有第三栏的余地，整块盖满屏幕。 */
export function FilePreview({ target, onClose }: { target: PreviewTarget; onClose: () => void }) {
  const [data, setData] = useState<Payload | null>(null)
  const [failed, setFailed] = useState(false)
  const [source, setSource] = useState(false)
  const [copied, setCopied] = useState(false)
  const body = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const p = target.path
    if (!p) return // 站内页面（iframe）不走这条路
    let gone = false
    setData(null)
    setFailed(false)
    setSource(false)
    setCopied(false)
    fetch(`/local-api/file?path=${encodeURIComponent(p)}`)
      .then((r) => r.json())
      .then((d: Payload) => {
        if (!gone) setData(d)
      })
      .catch(() => {
        if (!gone) setFailed(true)
      })
    return () => {
      gone = true
    }
  }, [target.path])

  const isFrame = !!target.url

  const isMd = !!data?.ok && data.kind === 'markdown'
  const rendered = isMd && !source

  // Markdown 渲染：和正文走同一条管线（marked + DOMPurify + Shiki）
  useEffect(() => {
    const el = body.current
    if (!el) return
    el.innerHTML = data?.ok && rendered ? renderMarkdown(data.content || '') : ''
    if (data?.ok && rendered) decorate(el)
  }, [data, rendered])

  async function copy() {
    if (!data?.content) return
    try {
      await navigator.clipboard.writeText(data.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* 复制不了就算了 */
    }
  }

  const pathText = data?.path || target.path || target.url || ''

  /** 存到本地：文件内容已经在手上，直接建 Blob 存盘，不用再跑一趟后端 */
  function download() {
    if (!data?.content) return
    const name = data.name || pathText.split('/').pop() || 'file.txt'
    const type = /\.(md|markdown|mdx)$/i.test(name) ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8'
    const url = URL.createObjectURL(new Blob([data.content], { type }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <aside className="flex min-h-0 min-w-0 flex-col border-l border-line bg-panel max-[900px]:fixed max-[900px]:inset-0 max-[900px]:z-40">
      <header className="flex flex-none items-center gap-2 border-b border-line px-4 py-3">
        {isFrame ? <Globe size={15} className="flex-none text-muted" /> : <FileText size={15} className="flex-none text-muted" />}
        <div className="min-w-0 flex-1">
          <div className="truncate font-ui text-[13px] text-ink" title={pathText}>
            {data?.name || target.name || pathText}
          </div>
          <div className="truncate font-mono text-[11px] text-muted" title={pathText}>
            {pathText}
            {data?.ok && data.size != null ? ` · ${fmtSize(data.size)}` : ''}
          </div>
        </div>

        {isMd && (
          <button
            className={BTN}
            onClick={() => setSource(!source)}
            title={source ? '看渲染后的样子' : '看 Markdown 源码'}
          >
            {source ? <Eye size={13} /> : <Code2 size={13} />}
            {source ? '渲染' : '源码'}
          </button>
        )}
        {data?.ok && (
          <button className={BTN} onClick={() => void copy()} title="把文件内容复制走">
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? '已复制' : '复制'}
          </button>
        )}
        {data?.ok && (
          <button className={BTN} onClick={download} title="把这个文件存到本地">
            <Download size={13} />
            下载
          </button>
        )}
        <button className={BTN} onClick={onClose} title="关掉预览" aria-label="关掉预览">
          <X size={13} />
        </button>
      </header>

      {isFrame ? (
        <div className="min-h-0 flex-1">
          <iframe
            src={target.url}
            title={target.name || target.url || '站内页面'}
            className="block h-full w-full border-0 bg-panel"
          />
        </div>
      ) : (
      <div className="min-h-0 flex-1 overflow-auto">
        {!data && !failed && (
          <div className="flex h-full items-center justify-center font-mono text-[12px] text-muted">
            正在读文件…
          </div>
        )}
        {failed && (
          <div className="px-5 py-4 font-mono text-[12.5px] text-danger-text">读不到这个文件</div>
        )}
        {data && !data.ok && (
          <div className="px-5 py-4 font-mono text-[12.5px] text-danger-text">
            {data.error || '读不到这个文件'}
          </div>
        )}
        {data?.ok && rendered && (
          <div
            ref={body}
            className="prose-relay px-5 py-4 text-[15px] [overflow-wrap:anywhere]"
          />
        )}
        {data?.ok && !rendered && (
          <pre className="m-0 bg-transparent px-5 py-4 font-mono text-[12.5px] leading-[1.65] whitespace-pre-wrap text-ink-2 [overflow-wrap:anywhere]">
            {data.content}
          </pre>
        )}
      </div>
      )}
    </aside>
  )
}
