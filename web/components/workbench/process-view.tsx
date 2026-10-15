'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  CheckCircle,
  Cpu,
  FileCode,
  HardDrive,
  Loader2,
  RefreshCw,
  Search,
  Server,
  Terminal,
  Trash,
} from 'lucide-react'
import { api, type ProcessItem, type SystemProcessesPayload } from '@/lib/api'
import { cn } from '@/lib/cn'

const LOG_FILES = [
  { id: 'agent.log', label: 'Agent 代理主日志' },
  { id: 'errors.log', label: '系统错误日志' },
  { id: 'gateway.log', label: '网关通信日志' },
  { id: 'gui.log', label: 'WebUI 控制台日志' },
]

export function ProcessView() {
  const [data, setData] = useState<SystemProcessesPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [procFilter, setProcFilter] = useState<'all' | 'hermes' | 'web'>('all')
  const [procSearch, setProcSearch] = useState('')

  // 日志视窗状态
  const [currentLogFile, setCurrentLogFile] = useState('agent.log')
  const [logLines, setLogLines] = useState<string[]>([])
  const [logLoading, setLogLoading] = useState(false)
  const [logSearch, setLogSearch] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const logTerminalRef = useRef<HTMLDivElement>(null)

  const loadProcesses = () => {
    setLoading(true)
    api
      .systemProcesses()
      .then((res) => setData(res))
      .catch((e) => console.error(e))
      .finally(() => setLoading(false))
  }

  const loadLogs = () => {
    setLogLoading(true)
    api
      .systemLogs(currentLogFile, 150)
      .then((res) => {
        if (res.ok) setLogLines(res.lines || [])
      })
      .catch((e) => console.error(e))
      .finally(() => setLogLoading(false))
  }

  useEffect(() => {
    loadProcesses()
    loadLogs()
  }, [currentLogFile])

  // 自动滚动到底部
  useEffect(() => {
    if (autoScroll && logTerminalRef.current) {
      logTerminalRef.current.scrollTop = logTerminalRef.current.scrollHeight
    }
  }, [logLines, autoScroll])

  // 定时自动拉取日志
  useEffect(() => {
    if (!autoRefresh) return
    const timer = setInterval(() => {
      loadProcesses()
      loadLogs()
    }, 4000)
    return () => clearInterval(timer)
  }, [autoRefresh, currentLogFile])

  const filteredProcs = (data?.processes || []).filter((p) => {
    if (procFilter !== 'all' && p.type !== procFilter) return false
    if (!procSearch) return true
    const q = procSearch.toLowerCase()
    return (
      p.name.toLowerCase().includes(q) ||
      p.command.toLowerCase().includes(q) ||
      String(p.pid).includes(q)
    )
  })

  const filteredLogLines = logLines.filter((l) => {
    if (!logSearch) return true
    return l.toLowerCase().includes(logSearch.toLowerCase())
  })

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-page">
      {/* 顶栏 */}
      <header className="flex flex-none items-center justify-between border-b border-line bg-panel px-6 py-3.5">
        <div className="flex items-center gap-3">
          <div className="grid size-8 place-items-center rounded-lg bg-accent/15 text-accent-text">
            <Cpu size={18} strokeWidth={2.2} />
          </div>
          <div>
            <h1 className="font-title text-[16px] font-semibold tracking-tight text-ink">
              后台进程与控制台视窗
            </h1>
            <p className="font-read text-[12px] text-muted">
              监控 Hermes 核心服务、守护进程资源占用及实时控制台日志
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 font-ui text-[12px] text-muted cursor-pointer mr-1">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="size-3.5 rounded border-line accent-accent"
            />
            <span>自动刷新 (4s)</span>
          </label>

          <button
            type="button"
            onClick={() => {
              loadProcesses()
              loadLogs()
            }}
            disabled={loading || logLoading}
            className="flex h-[30px] items-center gap-1.5 rounded-md border border-line bg-page px-3 text-[12px] text-ink hover:bg-raised transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw
              size={13}
              className={cn((loading || logLoading) && 'animate-spin')}
            />
            <span>刷新大盘</span>
          </button>
        </div>
      </header>

      {/* 主内容 */}
      <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-y-auto p-6">
        {/* 指标卡排布 */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {/* 系统负载卡片 */}
          <div className="rounded-xl border border-line bg-panel p-4 shadow-[0_1px_2px_rgba(45,45,42,0.03)]">
            <div className="flex items-center justify-between">
              <span className="font-ui text-[12.5px] font-medium text-muted">
                系统平均负载 (LoadAvg)
              </span>
              <Activity size={15} className="text-accent" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-mono text-[20px] font-semibold text-ink">
                {data?.loadavg ? data.loadavg[0].toFixed(2) : '--'}
              </span>
              <span className="font-mono text-[12px] text-muted">
                (5m: {data?.loadavg ? data.loadavg[1].toFixed(2) : '--'}, 15m:{' '}
                {data?.loadavg ? data.loadavg[2].toFixed(2) : '--'})
              </span>
            </div>
          </div>

          {/* 内存用量卡片 */}
          <div className="rounded-xl border border-line bg-panel p-4 shadow-[0_1px_2px_rgba(45,45,42,0.03)]">
            <div className="flex items-center justify-between">
              <span className="font-ui text-[12.5px] font-medium text-muted">
                物理内存占用
              </span>
              <HardDrive size={15} className="text-think" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-mono text-[20px] font-semibold text-ink">
                {data?.memory?.used_percent ?? 0}%
              </span>
              <span className="font-mono text-[12px] text-muted">
                {((data?.memory?.used_mb || 0) / 1024).toFixed(1)} GB /{' '}
                {((data?.memory?.total_mb || 0) / 1024).toFixed(1)} GB
              </span>
            </div>
          </div>

          {/* 活跃进程数 */}
          <div className="rounded-xl border border-line bg-panel p-4 shadow-[0_1px_2px_rgba(45,45,42,0.03)]">
            <div className="flex items-center justify-between">
              <span className="font-ui text-[12.5px] font-medium text-muted">
                托管服务状态
              </span>
              <Server size={15} className="text-ok" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-mono text-[20px] font-semibold text-ink">
                {data?.processes?.length ?? 0}
              </span>
              <span className="font-mono text-[12px] text-muted">
                个关键进程在线中
              </span>
            </div>
          </div>
        </div>

        {/* 进程监控列表与控制台日志视窗双栏布局 */}
        <div className="grid flex-1 min-h-[460px] grid-cols-1 gap-4 lg:grid-cols-12">
          {/* 进程列表：占 6 列 */}
          <div className="flex flex-col rounded-xl border border-line bg-panel p-4 lg:col-span-6 shadow-[0_1px_2px_rgba(45,45,42,0.03)]">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-title text-[14px] font-semibold text-ink">
                  活跃服务进程
                </span>
                <span className="rounded-full bg-raised px-2 py-0.5 font-mono text-[11px] text-muted">
                  {filteredProcs.length}
                </span>
              </div>

              {/* 过滤 Tabs */}
              <div className="flex items-center gap-1 rounded-md bg-raised p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setProcFilter('all')}
                  className={cn(
                    'rounded px-2 py-0.5 cursor-pointer',
                    procFilter === 'all'
                      ? 'bg-page text-ink font-medium shadow-xs'
                      : 'text-muted hover:text-ink',
                  )}
                >
                  全部
                </button>
                <button
                  type="button"
                  onClick={() => setProcFilter('hermes')}
                  className={cn(
                    'rounded px-2 py-0.5 cursor-pointer',
                    procFilter === 'hermes'
                      ? 'bg-page text-ink font-medium shadow-xs'
                      : 'text-muted hover:text-ink',
                  )}
                >
                  Hermes
                </button>
                <button
                  type="button"
                  onClick={() => setProcFilter('web')}
                  className={cn(
                    'rounded px-2 py-0.5 cursor-pointer',
                    procFilter === 'web'
                      ? 'bg-page text-ink font-medium shadow-xs'
                      : 'text-muted hover:text-ink',
                  )}
                >
                  Web
                </button>
              </div>
            </div>

            {/* 进程列表容器 */}
            <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
              {filteredProcs.length === 0 ? (
                <div className="flex flex-1 items-center justify-center text-[12px] text-muted">
                  未匹配到相关进程
                </div>
              ) : (
                filteredProcs.map((p) => (
                  <div
                    key={p.pid}
                    className="flex items-center justify-between gap-3 rounded-lg border border-line/50 bg-input px-3 py-2 text-[12px] transition-all hover:border-line-strong"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-title text-[12.5px] font-medium text-ink">
                          {p.name}
                        </span>
                        <span className="rounded bg-raised px-1.5 py-0.2 font-mono text-[10.5px] text-muted">
                          PID {p.pid}
                        </span>
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.2 text-[10px] font-medium',
                            p.type === 'hermes'
                              ? 'bg-accent/15 text-accent-text'
                              : 'bg-think/15 text-think',
                          )}
                        >
                          {p.type}
                        </span>
                      </div>
                      <div
                        className="truncate font-mono text-[11px] text-muted mt-0.5"
                        title={p.command}
                      >
                        {p.command}
                      </div>
                    </div>

                    <div className="flex flex-none items-center gap-3 text-right font-mono text-[11.5px]">
                      <div>
                        <span className="text-muted">CPU: </span>
                        <span className="font-medium text-ink">
                          {p.cpu.toFixed(1)}%
                        </span>
                      </div>
                      <div>
                        <span className="text-muted">MEM: </span>
                        <span className="font-medium text-ink">
                          {p.mem.toFixed(1)}%
                        </span>
                      </div>
                      <div className="text-muted text-[11px] w-14 truncate">
                        {p.elapsed}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 控制台实时日志视窗：占 6 列 */}
          <div className="flex flex-col rounded-xl border border-line bg-panel p-4 lg:col-span-6 shadow-[0_1px_2px_rgba(45,45,42,0.03)]">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Terminal size={15} className="text-accent" />
                <span className="font-title text-[14px] font-semibold text-ink">
                  控制台日志视窗
                </span>
              </div>

              <div className="flex items-center gap-2">
                {/* 日志文件选择器 */}
                <select
                  value={currentLogFile}
                  onChange={(e) => setCurrentLogFile(e.target.value)}
                  className="h-[28px] rounded-md border border-line bg-page px-2 text-[11.5px] text-ink focus:border-line-strong focus:outline-none cursor-pointer"
                >
                  {LOG_FILES.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label} ({f.id})
                    </option>
                  ))}
                </select>

                {/* 清屏 */}
                <button
                  type="button"
                  onClick={() => setLogLines([])}
                  className="flex h-[28px] items-center gap-1 rounded-md border border-line bg-page px-2 text-[11px] text-muted hover:text-ink cursor-pointer"
                  title="清空当前日志屏"
                >
                  <Trash size={11} />
                  <span>清屏</span>
                </button>
              </div>
            </div>

            {/* 日志过滤搜寻框 */}
            <div className="mb-2 relative">
              <Search
                size={12}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                type="text"
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                placeholder="过滤日志内容 (按关键字高亮)..."
                className="h-[28px] w-full rounded-md border border-line bg-input pl-7 pr-3 text-[11.5px] text-ink focus:border-line-strong focus:outline-none placeholder:text-muted"
              />
            </div>

            {/* 终端日志区 */}
            <div
              ref={logTerminalRef}
              className="flex-1 overflow-auto rounded-lg border border-line-strong/60 bg-[#1c1b18] p-3 font-mono text-[11.5px] leading-relaxed text-[#dcd7cb]"
            >
              {filteredLogLines.length === 0 ? (
                <div className="flex h-full items-center justify-center text-[#706c62]">
                  {logLoading ? '正在读取日志...' : '暂无日志输出'}
                </div>
              ) : (
                filteredLogLines.map((line, idx) => {
                  const isErr =
                    line.includes('ERROR') ||
                    line.includes('Exception') ||
                    line.includes('Traceback')
                  const isWarn = line.includes('WARNING') || line.includes('WARN')
                  return (
                    <div
                      key={idx}
                      className={cn(
                        'flex items-start gap-2 hover:bg-white/5 py-0.5 px-1 rounded',
                        isErr && 'text-[#f07167]',
                        isWarn && 'text-[#f4a261]',
                      )}
                    >
                      <span className="w-8 flex-none text-right text-[#57534e] select-none">
                        {idx + 1}
                      </span>
                      <span className="flex-1 break-all whitespace-pre-wrap">
                        {line}
                      </span>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
