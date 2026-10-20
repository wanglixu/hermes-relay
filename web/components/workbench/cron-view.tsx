'use client'

import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  History,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Timer,
} from 'lucide-react'
import { notify } from '@/components/ui/toast'
import { api, type CronJob } from '@/lib/api'
import { cn } from '@/lib/cn'

function fmtTime(str?: string | null): string {
  if (!str) return '--'
  try {
    const d = new Date(str)
    return d.toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return str
  }
}

function explainCron(expr?: string): string {
  if (!expr) return ''
  const trimmed = expr.trim()
  if (trimmed === '0 3 * * *') return '每天凌晨 03:00 执行'
  if (trimmed === '0 0 * * *') return '每天午夜 00:00 执行'
  if (trimmed === '*/5 * * * *') return '每 5 分钟执行一次'
  if (trimmed === '*/30 * * * *') return '每 30 分钟执行一次'
  if (trimmed === '0 * * * *') return '每小时整点执行一次'
  return `Cron 表达式：${trimmed}`
}

export function CronView() {
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const loadData = () => {
    setLoading(true)
    api
      .cronJobs()
      .then((res) => setJobs(res.jobs || []))
      .catch((e) => console.error(e))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleToggle = async (job: CronJob) => {
    setTogglingId(job.id)
    const nextState = !job.enabled
    try {
      const res = await api.toggleCron(job.id, nextState)
      if (res.ok) {
        setJobs((prev) =>
          prev.map((j) => (j.id === job.id ? { ...j, enabled: nextState } : j)),
        )
      }
    } catch (e) {
      console.error(e)
    } finally {
      setTogglingId(null)
    }
  }

  const handleRunNow = async (job: CronJob) => {
    setRunningId(job.id)
    try {
      const res = await api.runCron(job.id)
      if (res.ok) {
        setNotice(`已触发执行「${job.name}」`)
        setTimeout(() => setNotice(null), 3000)
        setTimeout(() => loadData(), 1500)
      } else {
        notify(res.error || '执行失败')
      }
    } catch (e) {
      console.error(e)
    } finally {
      setRunningId(null)
    }
  }

  const filteredJobs = jobs.filter((j) => {
    if (!query) return true
    const q = query.toLowerCase()
    return (
      j.name.toLowerCase().includes(q) ||
      (j.prompt && j.prompt.toLowerCase().includes(q)) ||
      (j.script && j.script.toLowerCase().includes(q))
    )
  })

  const enabledCount = jobs.filter((j) => j.enabled).length
  const pausedCount = jobs.length - enabledCount

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-page">
      {/* 顶栏 */}
      <header className="flex flex-none items-center justify-between border-b border-line bg-panel px-6 py-3.5">
        <div className="flex items-center gap-3">
          <div className="grid size-8 place-items-center rounded-lg bg-accent/15 text-accent-text">
            <Clock size={18} strokeWidth={2.2} />
          </div>
          <div>
            <h1 className="font-title text-[16px] font-semibold tracking-tight text-ink">
              定时任务调度器 (Cronjob Dashboard)
            </h1>
            <p className="font-read text-[12px] text-muted">
              对接 Hermes 定时任务系统，查看周期调度与历史触发记录
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {notice && (
            <span className="rounded-md bg-ok/10 px-2.5 py-1 font-ui text-[12px] text-ok animate-fade-in">
              {notice}
            </span>
          )}

          <div className="flex items-center gap-1.5 font-ui text-[12px] text-muted">
            <span className="rounded-full bg-raised px-2.5 py-1 font-mono">
              运行中: <span className="text-ok font-semibold">{enabledCount}</span>
            </span>
            <span className="rounded-full bg-raised px-2.5 py-1 font-mono">
              已挂起: <span className="text-muted font-semibold">{pausedCount}</span>
            </span>
          </div>

          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="flex size-[30px] items-center justify-center rounded-md border border-line bg-page text-muted transition-colors hover:bg-raised hover:text-ink cursor-pointer disabled:opacity-50"
            title="刷新"
          >
            <RefreshCw size={13} className={cn(loading && 'animate-spin')} />
          </button>
        </div>
      </header>

      {/* 搜索与过滤 */}
      <div className="flex items-center justify-between border-b border-line/60 bg-panel/40 px-6 py-2.5">
        <div className="relative w-72">
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索定时任务名称或脚本..."
            className="h-[30px] w-full rounded-md border border-line bg-input pl-7 pr-3 text-[12px] text-ink focus:border-line-strong focus:outline-none placeholder:text-muted"
          />
        </div>
        <span className="text-[12px] text-muted">共 {filteredJobs.length} 个定时调度</span>
      </div>

      {/* 任务卡片列表 */}
      <div className="flex-1 overflow-y-auto p-6">
        {filteredJobs.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center text-center">
            <Calendar size={32} className="text-muted/40 mb-2" />
            <p className="font-read text-[13.5px] text-muted">
              {query ? '未检索到符合条件的定时任务' : '暂无定时任务'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {filteredJobs.map((job) => {
              const expr = job.schedule?.expr || ''
              const isEnabled = job.enabled
              const isToggling = togglingId === job.id
              const isRunning = runningId === job.id

              return (
                <div
                  key={job.id}
                  className={cn(
                    'flex flex-col justify-between rounded-xl border border-line bg-panel p-5 shadow-[0_1px_3px_rgba(45,45,42,0.04)] transition-all hover:border-line-strong',
                    !isEnabled && 'opacity-70 bg-panel/60',
                  )}
                >
                  <div>
                    {/* 卡片头部 */}
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-title text-[15px] font-semibold text-ink">
                            {job.name}
                          </h3>
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium font-ui',
                              isEnabled
                                ? 'bg-ok/10 text-ok'
                                : 'bg-muted/15 text-muted',
                            )}
                          >
                            <span
                              className={cn(
                                'size-1.5 rounded-full',
                                isEnabled ? 'bg-ok' : 'bg-muted',
                              )}
                            />
                            {isEnabled ? '运行中' : '已暂停'}
                          </span>
                        </div>
                        {job.prompt && (
                          <p className="mt-1 font-read text-[12.5px] text-ink-2">
                            {job.prompt}
                          </p>
                        )}
                        {job.script && (
                          <div className="mt-1 flex items-center gap-1 font-mono text-[11.5px] text-accent-text">
                            <span>脚本:</span>
                            <span className="rounded bg-raised px-1.5 py-0.5">
                              {job.script}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* 启停 Switch 开关 */}
                      <button
                        type="button"
                        onClick={() => handleToggle(job)}
                        disabled={isToggling}
                        className={cn(
                          'relative inline-flex h-5 w-9 flex-none cursor-pointer rounded-full transition-colors focus:outline-none',
                          isEnabled ? 'bg-accent' : 'bg-line-strong/60',
                        )}
                        title={isEnabled ? '点击暂停此任务' : '点击启用此任务'}
                      >
                        <span
                          className={cn(
                            'inline-block size-3.5 transform rounded-full bg-white transition-transform translate-y-[3px]',
                            isEnabled ? 'translate-x-[19px]' : 'translate-x-[3px]',
                          )}
                        />
                      </button>
                    </div>

                    {/* 表达式与调度周期 */}
                    <div className="mt-3.5 rounded-lg border border-line-strong/40 bg-input p-3">
                      <div className="flex items-center justify-between text-[12px]">
                        <div className="flex items-center gap-1.5 font-mono font-medium text-ink">
                          <Timer size={14} className="text-think" />
                          <span>{expr || '无表达式'}</span>
                        </div>
                        <span className="text-[11.5px] text-muted">
                          {explainCron(expr)}
                        </span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 border-t border-line/40 pt-2 text-[11.5px]">
                        <div>
                          <span className="text-muted">上次执行：</span>
                          <span className="font-mono text-ink">
                            {fmtTime(job.last_run_at)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted">下次预估：</span>
                          <span className="font-mono text-ink">
                            {fmtTime(job.next_run_at)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* 最近执行状态 */}
                    {job.recent_execution && (
                      <div className="mt-2.5 flex items-center justify-between text-[11.5px] text-muted">
                        <div className="flex items-center gap-1.5">
                          <History size={12} />
                          <span>最近执行历史:</span>
                          <span
                            className={cn(
                              'font-mono font-medium',
                              job.recent_execution.status === 'completed'
                                ? 'text-ok'
                                : 'text-danger',
                            )}
                          >
                            {job.recent_execution.status}
                          </span>
                        </div>
                        <span className="font-mono">
                          {fmtTime(job.recent_execution.started_at)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* 底部操作区 */}
                  <div className="mt-4 flex items-center justify-end gap-2 border-t border-line/60 pt-3">
                    <button
                      type="button"
                      onClick={() => handleRunNow(job)}
                      disabled={isRunning}
                      className="flex h-[28px] items-center gap-1.5 rounded-md border border-line bg-page px-3 font-ui text-[12px] text-ink hover:bg-raised transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {isRunning ? (
                        <Loader2 size={12} className="animate-spin text-accent" />
                      ) : (
                        <Play size={12} className="text-accent" />
                      )}
                      <span>立即触发一次</span>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
