'use client'

import { useEffect, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Filter,
  ListTodo,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { api, type KanbanTask } from '@/lib/api'
import { cn } from '@/lib/cn'

type ColumnDef = {
  id: KanbanTask['status']
  title: string
  color: string
  desc: string
}

const COLUMNS: ColumnDef[] = [
  { id: 'todo', title: '待办', color: 'border-muted/40', desc: '计划处理的任务' },
  { id: 'ready', title: '就绪', color: 'border-accent/40', desc: '已明确细节待启动' },
  { id: 'running', title: '执行中', color: 'border-think', desc: 'Agent 或处理中' },
  { id: 'blocked', title: '阻塞', color: 'border-danger/60', desc: '等待依赖或人工' },
  { id: 'done', title: '已完成', color: 'border-ok/60', desc: '成果已交付验收' },
]

const NEXT_STATUS: Record<KanbanTask['status'], KanbanTask['status']> = {
  triage: 'todo',
  todo: 'ready',
  ready: 'running',
  running: 'done',
  blocked: 'todo',
  done: 'todo',
}

function fmtDate(ts?: number | null): string {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  return d.toLocaleDateString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function KanbanView() {
  const [tasks, setTasks] = useState<KanbanTask[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [priorityFilter, setPriorityFilter] = useState<number | 'all'>('all')
  const [showCreate, setShowCreate] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newBody, setNewBody] = useState('')
  const [newPriority, setNewPriority] = useState(0)
  const [newStatus, setNewStatus] = useState<KanbanTask['status']>('todo')
  const [submitting, setSubmitting] = useState(false)
  const [showTodoList, setShowTodoList] = useState(true)

  const loadData = () => {
    setLoading(true)
    api
      .kanbanTasks()
      .then((res) => setTasks(res.tasks || []))
      .catch((e) => console.error(e))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTitle.trim()) return
    setSubmitting(true)
    try {
      const res = await api.createKanbanTask({
        title: newTitle.trim(),
        body: newBody.trim(),
        priority: newPriority,
        status: newStatus,
      })
      if (res.ok && res.task) {
        setTasks((prev) => [res.task, ...prev])
        setNewTitle('')
        setNewBody('')
        setShowCreate(false)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setSubmitting(false)
    }
  }

  const handleMove = async (task: KanbanTask, targetStatus: KanbanTask['status']) => {
    // 乐观更新
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, status: targetStatus } : t)),
    )
    try {
      await api.updateKanbanTask(task.id, { status: targetStatus })
    } catch (e) {
      console.error(e)
      loadData()
    }
  }

  const handleDelete = async (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
    try {
      await api.deleteKanbanTask(taskId)
    } catch (e) {
      console.error(e)
      loadData()
    }
  }

  const filteredTasks = tasks.filter((t) => {
    if (priorityFilter !== 'all' && (t.priority || 0) !== priorityFilter) return false
    if (!query) return true
    const q = query.toLowerCase()
    return (
      (t.title && t.title.toLowerCase().includes(q)) ||
      (t.body && t.body.toLowerCase().includes(q))
    )
  })

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-page">
      {/* 顶部工具栏 */}
      <header className="flex flex-none items-center justify-between border-b border-line bg-panel px-6 py-3.5">
        <div className="flex items-center gap-3">
          <div className="grid size-8 place-items-center rounded-lg bg-accent/15 text-accent-text">
            <ListTodo size={18} strokeWidth={2.2} />
          </div>
          <div>
            <h1 className="font-title text-[16px] font-semibold tracking-tight text-ink">
              任务看板与进度跟踪器
            </h1>
            <p className="font-read text-[12px] text-muted">
              原生对接 Hermes Kanban 与任务数据库，实时跟踪任务全生命周期
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 搜索框 */}
          <div className="relative">
            <Search
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索任务..."
              className="h-[30px] w-48 rounded-md border border-line bg-page pl-7 pr-7 text-[12px] text-ink transition-colors placeholder:text-muted focus:border-line-strong focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* 优先级筛选 */}
          <select
            value={priorityFilter}
            onChange={(e) =>
              setPriorityFilter(
                e.target.value === 'all' ? 'all' : Number(e.target.value),
              )
            }
            className="h-[30px] rounded-md border border-line bg-page px-2 text-[12px] text-ink focus:border-line-strong focus:outline-none cursor-pointer"
          >
            <option value="all">全部优先级</option>
            <option value="0">普通 (P0)</option>
            <option value="1">高优 (P1)</option>
            <option value="2">紧急 (P2)</option>
          </select>

          {/* 待办清单切换 */}
          <button
            type="button"
            onClick={() => setShowTodoList(!showTodoList)}
            className={cn(
              'flex h-[30px] items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] font-ui transition-colors cursor-pointer',
              showTodoList ? 'bg-raised text-ink font-medium' : 'bg-page text-muted hover:text-ink',
            )}
          >
            <CheckCircle2 size={13} />
            <span>待办清单</span>
          </button>

          {/* 刷新 */}
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="flex size-[30px] items-center justify-center rounded-md border border-line bg-page text-muted transition-colors hover:bg-raised hover:text-ink cursor-pointer disabled:opacity-50"
            title="刷新数据"
          >
            <RefreshCw size={13} className={cn(loading && 'animate-spin')} />
          </button>

          {/* 新建任务按钮 */}
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex h-[30px] items-center gap-1.5 rounded-md bg-accent px-3 font-ui text-[12px] font-medium text-on-accent shadow-[0_1px_2px_rgba(45,45,42,0.08)] transition-all hover:bg-accent/90 cursor-pointer active:scale-[0.98]"
          >
            <Plus size={14} strokeWidth={2.2} />
            新建任务
          </button>
        </div>
      </header>

      {/* 看板与清单工作区 */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Kanban 泳道主区域 */}
        <div className="flex flex-1 gap-3.5 overflow-x-auto p-4 select-none">
          {COLUMNS.map((col) => {
            const colTasks = filteredTasks.filter(
              (t) => (t.status === col.id) || (col.id === 'todo' && t.status === 'triage'),
            )
            return (
              <div
                key={col.id}
                className="flex w-[280px] flex-none flex-col rounded-xl border border-line bg-panel/70 p-2.5"
              >
                {/* 泳道头 */}
                <div className="mb-2.5 flex items-center justify-between px-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-ui text-[13px] font-semibold text-ink">
                      {col.title}
                    </span>
                    <span className="rounded-full bg-raised px-2 py-0.5 font-mono text-[11px] font-medium text-muted">
                      {colTasks.length}
                    </span>
                  </div>
                  <span className="text-[11px] text-muted">{col.desc}</span>
                </div>

                {/* 卡片容器 */}
                <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto pr-1">
                  {colTasks.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-line/80 py-8 text-center text-[12px] text-muted">
                      暂无任务
                    </div>
                  ) : (
                    colTasks.map((t) => (
                      <div
                        key={t.id}
                        className="group relative flex flex-col gap-1.5 rounded-lg border border-line-strong/60 bg-input p-3 shadow-[0_1px_3px_rgba(45,45,42,0.04)] transition-all hover:border-line-strong hover:shadow-[0_2px_6px_rgba(45,45,42,0.08)]"
                      >
                        <div className="flex items-start justify-between gap-1.5">
                          <h4 className="font-title text-[13px] font-medium leading-snug text-ink line-clamp-2">
                            {t.title}
                          </h4>
                          {/* 优先级标 */}
                          {t.priority === 2 && (
                            <span className="flex-none rounded bg-danger/10 px-1.5 py-0.5 text-[10px] font-medium text-danger-text">
                              紧急
                            </span>
                          )}
                          {t.priority === 1 && (
                            <span className="flex-none rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-text">
                              高优
                            </span>
                          )}
                        </div>

                        {t.body && (
                          <p className="line-clamp-2 font-read text-[11.5px] leading-relaxed text-muted">
                            {t.body}
                          </p>
                        )}

                        {/* 状态与时间 */}
                        <div className="mt-1 flex items-center justify-between border-t border-line/50 pt-2 text-[11px] text-muted">
                          <span className="font-mono">{fmtDate(t.created_at)}</span>
                          <div className="flex items-center gap-1">
                            {/* 流转按钮 */}
                            {t.status !== 'done' && (
                              <button
                                type="button"
                                onClick={() => handleMove(t, NEXT_STATUS[t.status])}
                                className="flex items-center gap-0.5 rounded px-1.5 py-0.5 font-ui text-[11px] text-accent-text hover:bg-raised transition-colors cursor-pointer"
                                title={`流转到下一阶段：${NEXT_STATUS[t.status]}`}
                              >
                                <span>推进</span>
                                <ArrowRight size={11} />
                              </button>
                            )}
                            {/* 标记阻塞 */}
                            {t.status !== 'blocked' && t.status !== 'done' && (
                              <button
                                type="button"
                                onClick={() => handleMove(t, 'blocked')}
                                className="rounded p-1 text-muted hover:bg-raised hover:text-danger-text transition-colors cursor-pointer"
                                title="标为阻塞"
                              >
                                <AlertCircle size={12} />
                              </button>
                            )}
                            {/* 删除 */}
                            <button
                              type="button"
                              onClick={() => handleDelete(t.id)}
                              className="rounded p-1 text-muted opacity-0 group-hover:opacity-100 hover:bg-raised hover:text-danger-text transition-all cursor-pointer"
                              title="删除任务"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* 右侧快速 Todo-List 清单抽屉 */}
        {showTodoList && (
          <aside className="flex w-[310px] flex-none flex-col border-l border-line bg-panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-title text-[13.5px] font-semibold text-ink">
                <CheckCircle2 size={15} className="text-accent" />
                <span>待办速记清单</span>
              </div>
              <span className="rounded-full bg-raised px-2 py-0.5 font-mono text-[11px] text-muted">
                {tasks.filter((t) => t.status !== 'done').length} 待完成
              </span>
            </div>

            {/* 快速加一条待办 */}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const input = (e.currentTarget.elements.namedItem('todoText') as HTMLInputElement)
                if (input && input.value.trim()) {
                  api.createKanbanTask({ title: input.value.trim(), status: 'todo' }).then((res) => {
                    if (res.ok) setTasks((prev) => [res.task, ...prev])
                    input.value = ''
                  })
                }
              }}
              className="mb-3"
            >
              <div className="flex items-center gap-1.5">
                <input
                  name="todoText"
                  type="text"
                  placeholder="快速添加一项待办..."
                  className="h-[30px] flex-1 rounded-md border border-line bg-page px-2.5 text-[12px] text-ink focus:border-line-strong focus:outline-none placeholder:text-muted"
                />
                <button
                  type="submit"
                  className="flex size-[30px] flex-none items-center justify-center rounded-md bg-raised text-ink hover:bg-line transition-colors cursor-pointer"
                  title="添加待办"
                >
                  <Plus size={14} />
                </button>
              </div>
            </form>

            {/* 清单列表 */}
            <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
              {tasks.length === 0 ? (
                <div className="py-6 text-center text-[12px] text-muted">
                  清单为空
                </div>
              ) : (
                tasks.map((t) => {
                  const isDone = t.status === 'done'
                  return (
                    <div
                      key={t.id}
                      className={cn(
                        'flex items-center gap-2 rounded-lg border border-line/60 bg-input px-2.5 py-2 transition-all',
                        isDone && 'opacity-50 bg-raised/50',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={isDone}
                        onChange={() => handleMove(t, isDone ? 'todo' : 'done')}
                        className="size-3.5 rounded border-line accent-accent cursor-pointer"
                      />
                      <span
                        className={cn(
                          'flex-1 text-[12.5px] text-ink truncate font-read',
                          isDone && 'line-through text-muted',
                        )}
                        title={t.title}
                      >
                        {t.title}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDelete(t.id)}
                        className="text-muted hover:text-danger-text cursor-pointer"
                        title="删除"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </aside>
        )}
      </div>

      {/* 新建任务弹窗 */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs">
          <div className="w-[440px] rounded-2xl border border-line bg-panel p-5 shadow-[0_8px_30px_rgba(45,45,42,0.18)] animate-fade-in">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-title text-[15px] font-semibold text-ink">
                新建 Kanban 任务
              </h3>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-md p-1 text-muted hover:bg-raised hover:text-ink cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreate} className="flex flex-col gap-3.5">
              <div>
                <label className="mb-1 block font-ui text-[12px] font-medium text-ink-2">
                  任务标题
                </label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="例如：重构会话流转或排查缓存失效"
                  className="h-[34px] w-full rounded-md border border-line bg-input px-3 text-[12.5px] text-ink focus:border-line-strong focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block font-ui text-[12px] font-medium text-ink-2">
                  描述与要求 (可选)
                </label>
                <textarea
                  rows={3}
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  placeholder="输入任务背景、预期产出或需要遵守的约束..."
                  className="w-full resize-none rounded-md border border-line bg-input p-2.5 text-[12.5px] text-ink focus:border-line-strong focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block font-ui text-[12px] font-medium text-ink-2">
                    优先级
                  </label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(Number(e.target.value))}
                    className="h-[34px] w-full rounded-md border border-line bg-input px-2 text-[12.5px] text-ink focus:border-line-strong focus:outline-none cursor-pointer"
                  >
                    <option value={0}>普通 (P0)</option>
                    <option value={1}>高优 (P1)</option>
                    <option value={2}>紧急 (P2)</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block font-ui text-[12px] font-medium text-ink-2">
                    初始泳道
                  </label>
                  <select
                    value={newStatus}
                    onChange={(e) =>
                      setNewStatus(e.target.value as KanbanTask['status'])
                    }
                    className="h-[34px] w-full rounded-md border border-line bg-input px-2 text-[12.5px] text-ink focus:border-line-strong focus:outline-none cursor-pointer"
                  >
                    <option value="todo">待办 (Todo)</option>
                    <option value="ready">就绪 (Ready)</option>
                    <option value="running">执行中 (Running)</option>
                    <option value="blocked">阻塞 (Blocked)</option>
                  </select>
                </div>
              </div>

              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="h-[32px] rounded-md border border-line px-3 font-ui text-[12px] text-muted hover:bg-raised hover:text-ink cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submitting || !newTitle.trim()}
                  className="flex h-[32px] items-center gap-1.5 rounded-md bg-accent px-4 font-ui text-[12px] font-medium text-on-accent transition-all hover:bg-accent/90 cursor-pointer disabled:opacity-50"
                >
                  {submitting && <Loader2 size={13} className="animate-spin" />}
                  确认创建
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
