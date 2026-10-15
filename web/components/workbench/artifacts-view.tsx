'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Box,
  Check,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileCode,
  FileText,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Play,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react'
import { api, type ArtifactFile } from '@/lib/api'
import { decorate, renderMarkdown } from '@/lib/markdown'
import { cn } from '@/lib/cn'

type FilterKind = 'all' | 'html' | 'markdown' | 'svg' | 'code'

function fmtSize(n?: number): string {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function fmtDate(ts?: number): string {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  return d.toLocaleDateString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function ArtifactsView() {
  const [files, setFiles] = useState<ArtifactFile[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterKind>('all')
  const [query, setQuery] = useState('')
  const [selectedFile, setSelectedFile] = useState<ArtifactFile | null>(null)

  // 沙箱视窗状态
  const [fileContent, setFileContent] = useState<string>('')
  const [contentLoading, setContentLoading] = useState(false)
  const [viewMode, setViewMode] = useState<'live' | 'source'>('live')
  const [copied, setCopied] = useState(false)
  const [sandboxKey, setSandboxKey] = useState(0)

  const mdContainerRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const loadFiles = () => {
    setLoading(true)
    api
      .artifacts()
      .then((res) => {
        const list = res.files || []
        setFiles(list)
        if (list.length > 0 && !selectedFile) {
          // 优先选中一个 HTML 或 Markdown 产物
          const prime = list.find((f) => f.is_html) || list.find((f) => f.is_markdown) || list[0]
          setSelectedFile(prime)
        }
      })
      .catch((e) => console.error(e))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadFiles()
  }, [])

  // 读选中文件内容
  useEffect(() => {
    if (!selectedFile) {
      setFileContent('')
      return
    }
    setContentLoading(true)
    fetch(`/local-api/file?path=${encodeURIComponent(selectedFile.path)}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.ok) {
          setFileContent(res.content || '')
        } else {
          setFileContent(`// 无法读取文件：${res.error}`)
        }
      })
      .catch((e) => {
        setFileContent(`// 读取出错：${e}`)
      })
      .finally(() => setContentLoading(false))
  }, [selectedFile, sandboxKey])

  // Markdown 渲染
  useEffect(() => {
    if (viewMode === 'live' && selectedFile?.is_markdown && mdContainerRef.current) {
      mdContainerRef.current.innerHTML = renderMarkdown(fileContent)
      decorate(mdContainerRef.current)
    }
  }, [fileContent, viewMode, selectedFile])

  const filteredFiles = files.filter((f) => {
    if (filter === 'html' && !f.is_html) return false
    if (filter === 'markdown' && !f.is_markdown) return false
    if (filter === 'svg' && !f.is_svg) return false
    if (filter === 'code' && f.kind !== 'code') return false
    if (!query) return true
    const q = query.toLowerCase()
    return f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
  })

  const copyCode = async () => {
    if (!fileContent) return
    try {
      await navigator.clipboard.writeText(fileContent)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  const downloadFile = () => {
    if (!fileContent || !selectedFile) return
    const blob = new Blob([fileContent], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = selectedFile.name
    a.click()
    URL.revokeObjectURL(url)
  }

  const openInNewWindow = () => {
    if (!fileContent) return
    const win = window.open('', '_blank')
    if (win) {
      win.document.write(fileContent)
      win.document.close()
    }
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-page">
      {/* 顶栏 */}
      <header className="flex flex-none items-center justify-between border-b border-line bg-panel px-6 py-3.5">
        <div className="flex items-center gap-3">
          <div className="grid size-8 place-items-center rounded-lg bg-accent/15 text-accent-text">
            <Box size={18} strokeWidth={2.2} />
          </div>
          <div>
            <h1 className="font-title text-[16px] font-semibold tracking-tight text-ink">
              交互式产物实时沙箱 (Live Artifacts Sandbox)
            </h1>
            <p className="font-read text-[12px] text-muted">
              安全隔离的网页/应用实时预览视窗、Markdown 排版与代码检验工作台
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadFiles}
            disabled={loading}
            className="flex h-[30px] items-center gap-1.5 rounded-md border border-line bg-page px-3 text-[12px] text-ink hover:bg-raised transition-colors cursor-pointer disabled:opacity-50"
            title="重新扫描产物文件"
          >
            <RefreshCw size={13} className={cn(loading && 'animate-spin')} />
            <span>扫描产物库</span>
          </button>
        </div>
      </header>

      {/* 双栏骨架：左侧产物列表 + 右侧实时沙箱与视窗 */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* 左侧：产物文件分类列表 (宽 300px) */}
        <aside className="flex w-[290px] flex-none flex-col border-r border-line bg-panel">
          {/* 分类筛选 Chips */}
          <div className="flex items-center gap-1 border-b border-line/60 p-2.5 overflow-x-auto text-[11px]">
            {[
              { id: 'all', label: '全部' },
              { id: 'html', label: 'HTML 网页' },
              { id: 'markdown', label: '文档 MD' },
              { id: 'svg', label: '矢量 SVG' },
              { id: 'code', label: '代码/脚本' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilter(t.id as FilterKind)}
                className={cn(
                  'rounded px-2 py-1 whitespace-nowrap cursor-pointer transition-colors',
                  filter === t.id
                    ? 'bg-accent/15 text-accent-text font-medium'
                    : 'text-muted hover:bg-raised hover:text-ink',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* 搜索框 */}
          <div className="p-2.5 border-b border-line/60">
            <div className="relative">
              <Search
                size={12}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索产物文件名..."
                className="h-[28px] w-full rounded-md border border-line bg-page pl-7 pr-3 text-[11.5px] text-ink focus:border-line-strong focus:outline-none placeholder:text-muted"
              />
            </div>
          </div>

          {/* 产物列表 */}
          <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
            {filteredFiles.length === 0 ? (
              <div className="py-12 text-center text-[12px] text-muted">
                {loading ? '正在扫描产物...' : '未找到相关产物'}
              </div>
            ) : (
              filteredFiles.map((f) => {
                const active = selectedFile?.path === f.path
                return (
                  <button
                    key={f.path}
                    type="button"
                    onClick={() => {
                      setSelectedFile(f)
                      setViewMode('live')
                    }}
                    className={cn(
                      'flex flex-col gap-0.5 rounded-lg p-2 text-left transition-all cursor-pointer',
                      active
                        ? 'bg-accent/15 border-l-2 border-l-accent shadow-xs'
                        : 'hover:bg-raised text-ink',
                    )}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {f.is_html && <Play size={13} className="text-accent flex-none" />}
                        {f.is_markdown && <FileText size={13} className="text-think flex-none" />}
                        {f.is_svg && <ImageIcon size={13} className="text-ok flex-none" />}
                        {!f.is_html && !f.is_markdown && !f.is_svg && (
                          <FileCode size={13} className="text-muted flex-none" />
                        )}
                        <span
                          className={cn(
                            'truncate font-ui text-[12.5px]',
                            active ? 'font-semibold text-ink' : 'text-ink-2',
                          )}
                          title={f.name}
                        >
                          {f.name}
                        </span>
                      </div>
                      <span className="rounded bg-raised px-1 py-0.2 font-mono text-[10px] text-muted flex-none">
                        .{f.ext}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[10.5px] text-muted font-mono mt-0.5">
                      <span>{fmtSize(f.size)}</span>
                      <span>{fmtDate(f.mtime)}</span>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </aside>

        {/* 右侧：主沙箱与视窗 */}
        <main className="flex flex-1 min-h-0 flex-col bg-page">
          {selectedFile ? (
            <>
              {/* 沙箱顶栏 */}
              <div className="flex flex-none items-center justify-between border-b border-line bg-panel px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-title text-[13.5px] font-semibold text-ink truncate">
                      {selectedFile.name}
                    </span>
                    <span className="rounded bg-raised px-1.5 py-0.5 font-mono text-[11px] text-muted">
                      {fmtSize(selectedFile.size)}
                    </span>
                  </div>
                  <div className="truncate font-mono text-[11px] text-muted" title={selectedFile.path}>
                    {selectedFile.path}
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {/* 视图模式切换：沙箱模式 vs 源码模式 */}
                  <div className="flex items-center rounded-md bg-raised p-0.5 text-[11.5px] font-ui mr-1">
                    <button
                      type="button"
                      onClick={() => setViewMode('live')}
                      className={cn(
                        'flex items-center gap-1 rounded px-2.5 py-1 transition-all cursor-pointer',
                        viewMode === 'live'
                          ? 'bg-page text-ink font-medium shadow-xs'
                          : 'text-muted hover:text-ink',
                      )}
                    >
                      <Eye size={12} />
                      <span>实时沙箱</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('source')}
                      className={cn(
                        'flex items-center gap-1 rounded px-2.5 py-1 transition-all cursor-pointer',
                        viewMode === 'source'
                          ? 'bg-page text-ink font-medium shadow-xs'
                          : 'text-muted hover:text-ink',
                      )}
                    >
                      <Code2 size={12} />
                      <span>查看源码</span>
                    </button>
                  </div>

                  {/* 针对 HTML 产物的沙箱刷新 */}
                  {selectedFile.is_html && viewMode === 'live' && (
                    <button
                      type="button"
                      onClick={() => setSandboxKey((k) => k + 1)}
                      className="flex h-[28px] items-center gap-1 rounded-md border border-line bg-page px-2 text-[11.5px] text-ink hover:bg-raised transition-colors cursor-pointer"
                      title="重置并重新执行沙箱"
                    >
                      <RefreshCw size={12} />
                      <span>重置沙箱</span>
                    </button>
                  )}

                  {/* 独立新窗口打开 */}
                  {selectedFile.is_html && (
                    <button
                      type="button"
                      onClick={openInNewWindow}
                      className="flex h-[28px] items-center gap-1 rounded-md border border-line bg-page px-2 text-[11.5px] text-ink hover:bg-raised transition-colors cursor-pointer"
                      title="新窗口全屏运行"
                    >
                      <ExternalLink size={12} />
                      <span>新窗口运行</span>
                    </button>
                  )}

                  {/* 复制 */}
                  <button
                    type="button"
                    onClick={copyCode}
                    className="flex h-[28px] items-center gap-1 rounded-md border border-line bg-page px-2 text-[11.5px] text-ink hover:bg-raised transition-colors cursor-pointer"
                    title="复制文件源码"
                  >
                    {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
                    <span>{copied ? '已复制' : '复制'}</span>
                  </button>

                  {/* 下载 */}
                  <button
                    type="button"
                    onClick={downloadFile}
                    className="flex h-[28px] items-center gap-1 rounded-md border border-line bg-page px-2 text-[11.5px] text-ink hover:bg-raised transition-colors cursor-pointer"
                    title="下载到本地"
                  >
                    <Download size={12} />
                    <span>下载</span>
                  </button>
                </div>
              </div>

              {/* 视窗正文区 */}
              <div className="flex-1 min-h-0 overflow-auto relative">
                {contentLoading ? (
                  <div className="flex h-full items-center justify-center gap-2 text-muted text-[13px]">
                    <Loader2 size={16} className="animate-spin text-accent" />
                    <span>正在读取产物...</span>
                  </div>
                ) : viewMode === 'live' ? (
                  /* ── 实时沙箱 Live View ── */
                  selectedFile.is_html ? (
                    <div className="h-full w-full bg-white relative">
                      <iframe
                        key={sandboxKey}
                        ref={iframeRef}
                        srcDoc={fileContent}
                        title={selectedFile.name}
                        sandbox="allow-scripts allow-forms allow-modals allow-same-origin"
                        className="h-full w-full border-0"
                      />
                    </div>
                  ) : selectedFile.is_markdown ? (
                    <div
                      ref={mdContainerRef}
                      className="prose-relay mx-auto max-w-[860px] p-8 text-[15px] [overflow-wrap:anywhere]"
                    />
                  ) : selectedFile.is_svg ? (
                    <div className="flex h-full items-center justify-center p-8 bg-[#faf8f4]">
                      <div
                        className="max-h-full max-w-full drop-shadow-sm"
                        dangerouslySetInnerHTML={{ __html: fileContent }}
                      />
                    </div>
                  ) : (
                    /* 其它代码或文本回退到格式化代码展示 */
                    <pre className="m-0 bg-transparent p-6 font-mono text-[12.5px] leading-relaxed text-ink-2 whitespace-pre-wrap">
                      {fileContent}
                    </pre>
                  )
                ) : (
                  /* ── 源码查看 Source Code View ── */
                  <div className="min-h-full bg-input p-6 font-mono text-[12.5px] leading-relaxed text-ink">
                    <pre className="whitespace-pre-wrap break-all m-0">{fileContent}</pre>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-center">
              <Box size={36} className="text-muted/40 mb-2" />
              <p className="font-read text-[13.5px] text-muted">请从左侧选择产物文件查看</p>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
