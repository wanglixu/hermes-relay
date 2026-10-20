'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api, type ModelsPayload, type RelayChannel, type RelayModel } from '@/lib/api'
import { cn } from '@/lib/cn'
import { buildChannels, hostOf, Chevron, Row, RowText, Tick, modelTitles, PANEL_SHADOW, PANEL_TITLE, BTN_GHOST, BTN_PRIMARY, type Channel, type SubTarget } from './model-picker-parts'

/**
 * 输入框右下角那处「渠道 · 模型 · 思考强度」。
 *
 * 选模型是两级：主面板先列**渠道**，鼠标移上去（或点一下）从**左边**展开这个渠道下的
 * 模型，再点一个就切过去。左边那个子面板与「思考强度」共用同一个容器和开合动画
 * （globals.css 的 .pop-panel），只是内容在「模型」和「档位」之间切。
 *
 * 渠道的划分：Hermes 已配好的按 providers 的渠道 id（deepseek / cline-pass …）；
 * 页面上「添加渠道」加进来的按渠道分（一份地址 + 密钥，挂着这个接口下的全部模型）；
 * 更早「单个模型」加进来的没有渠道，就按接口地址的域名归堆。
 *
 * 选完立刻写进后端（relay 自己的配置文件），**下一轮对话生效**，不用重启服务；
 * 也只作用于这个网页 —— 命令行、桌面端、微信那几个入口不受影响。
 */

export function ModelPicker({
  payload,
  onChanged,
}: {
  payload: ModelsPayload | null
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'list' | 'add'>('list')
  // 左边那个子面板：内容是「某个渠道下的模型」或「思考强度档位」，悬停就展开，点击也能切
  const [sub, setSub] = useState<SubTarget | null>(null)
  // 子面板最终摆在哪儿（相对外层容器的 top，以及它自己的高度）。规则见下面的 place 注释。
  const [subBox, setSubBox] = useState({ top: 0, height: 0 })
  // 面板淡出时内容不能先消失，所以记住最后一次显示的是什么
  const lastSub = useRef<SubTarget | null>(null)
  const subTimer = useRef<number | null>(null)
  const openSub = (target: SubTarget) => {
    if (subTimer.current) window.clearTimeout(subTimer.current)
    setSub(target)
  }
  const toggleSub = (target: SubTarget) => {
    setSub((cur) => (cur && cur.kind === target.kind && cur.channelId === target.channelId ? null : target))
  }
  // 离开面板不立刻收：鼠标要从主面板斜着挪到左边那个子面板，中间有一段两个框都不在的地方。
  // 240ms 够走完这段路，进到子面板、或者踏上下面的「桥」，这次计时就被取消。
  const closeSubSoon = () => {
    if (subTimer.current) window.clearTimeout(subTimer.current)
    subTimer.current = window.setTimeout(() => setSub(null), 240)
  }
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  // 提示是成功还是报错 —— 两者颜色不同，别把成功也画成红的
  const [noteOk, setNoteOk] = useState(false)
  const say = (text: string, ok = false) => {
    setNote(text)
    setNoteOk(ok)
  }
  const wrapRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const subPanelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const subListRef = useRef<HTMLDivElement>(null)

  const rowY = (el: HTMLElement) => {
    const wrap = wrapRef.current
    if (!wrap) return 0
    return el.getBoundingClientRect().top - wrap.getBoundingClientRect().top
  }
  /** 悬停/点击某一行的入口：顺手记下这一行的纵坐标，子面板要贴着它展开。 */
  const hoverRow = (target: SubTarget) => (e: React.MouseEvent<HTMLButtonElement>) => {
    openSub({ ...target, anchorY: rowY(e.currentTarget) })
  }

  const channels = useMemo(() => buildChannels(payload?.models ?? []), [payload])

  // 子面板摆位：优先贴住鼠标所在的那一行 —— 这样从那一行直接往左平移就进了子面板，路径最短，
  // 不会像以前那样跑到最下面去、鼠标得斜着走一大段。同时不许越过主面板的上下边界：
  // 靠近底部的那两行（思考强度）会自动往上收，让子面板底边跟主面板对齐。
  useLayoutEffect(() => {
    if (!open || view !== 'list' || !sub) return
    const place = () => {
      const wrap = wrapRef.current
      const panel = panelRef.current
      const box = subPanelRef.current
      if (!wrap || !panel || !box) return
      const wr = wrap.getBoundingClientRect()
      const pr = panel.getBoundingClientRect()
      const height = box.offsetHeight
      const minTop = pr.top - wr.top
      const maxTop = Math.max(minTop, pr.bottom - wr.top - height)
      const ideal = typeof sub.anchorY === 'number' ? sub.anchorY : minTop
      const top = Math.min(Math.max(ideal, minTop), maxTop)
      setSubBox((cur) => (cur.top === top && cur.height === height ? cur : { top, height }))
    }
    place()
    const ro = new ResizeObserver(place)
    if (subPanelRef.current) ro.observe(subPanelRef.current)
    if (panelRef.current) ro.observe(panelRef.current)
    return () => ro.disconnect()
  }, [open, view, sub, channels])

  /** 主面板里滚动时，子面板跟着它那一行一起动（不然行跑了、框还钉在原地）。 */
  const onListScroll = () => {
    if (!sub?.channelId) return
    const row = listRef.current?.querySelector<HTMLElement>(`[data-ch="${sub.channelId}"]`)
    if (row) openSub({ ...sub, anchorY: rowY(row) })
  }

  // 表单字段
  const [fName, setFName] = useState('')
  const [fBase, setFBase] = useState('')
  const [fKey, setFKey] = useState('')
  const [fModel, setFModel] = useState('')
  // 上下文窗口：留空就让服务端自动查（接口 → 公开目录 → Hermes 里同名的模型）
  const [fCtx, setFCtx] = useState('')
  const [test, setTest] = useState<{ ok: boolean; text: string; models?: string[] } | null>(null)
  const [testing, setTesting] = useState(false)
  // 「添加」视图分两页：整条渠道（默认）/ 单个模型（接口不给模型清单时兜底）
  const [addTab, setAddTab] = useState<'channel' | 'single'>('channel')
  // 渠道那条路：测试后拿到的这个接口的模型清单（只展示，不用勾，保存就是全收）
  const [chanTest, setChanTest] = useState<{ ok: boolean; text: string; models: string[] } | null>(null)

  useEffect(() => {
    if (sub) lastSub.current = sub
  }, [sub])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // 关掉时回到第一个视图，顺手清掉上一次的提示
  useEffect(() => {
    if (!open) {
      setView('list')
      setNote('')
      setTest(null)
      setSub(null)
    }
  }, [open])

  // 打开列表时，把正在用的那个渠道滚到可视区域中间（它可能在长列表的后半段）
  useEffect(() => {
    if (!open || view !== 'list') return
    const box = listRef.current
    const row = box?.querySelector('[data-current="true"]')
    if (row instanceof HTMLElement) row.scrollIntoView({ block: 'center' })
  }, [open, view, channels])

  // 子面板展开时，把正在用的那个模型滚到中间
  useEffect(() => {
    if (!open || !sub || sub.kind !== 'models') return
    const row = subListRef.current?.querySelector('[data-current="true"]')
    if (row instanceof HTMLElement) row.scrollIntoView({ block: 'center' })
  }, [open, sub])

  useEffect(() => () => {
    if (subTimer.current) window.clearTimeout(subTimer.current)
  }, [])

  if (!payload) return null

  const { current, efforts, default_model, default_effort } = payload
  const modelsList = payload.models || []
  const picked = modelsList.find((m) => m.key === current.key) || null
  const fallback = modelsList.find((m) => m.is_default) || null
  const shown = picked || fallback
  const shownChannel = shown ? channels.find((c) => (c.models || []).some((m) => m.key === shown.key)) : null
  const channelLabel = shownChannel?.label || ''
  const shownModel = shown ? modelTitles(shown, channelLabel) : null
  const modelLabel = shownModel?.id || default_model || '默认模型'
  const effortValue = current.effort || default_effort
  const effortLabel = (efforts || []).find((e) => e.value === effortValue)?.label || effortValue

  // 淡出期间沿用上一次的内容
  const shownSub = sub || lastSub.current
  const subChannel = shownSub?.kind === 'models' ? channels.find((c) => c.id === shownSub.channelId) : undefined

  // 两个框之间那条缝（主面板右边到子面板左边 6px）铺一条透明的「桥」。范围从触发行一直连到子面板，
  // 鼠标斜着往左下走也不会落在两个框之外 —— 面板不会半路收起来。桥本身不挡任何东西（就压在缝里）。
  const bridgeAnchor = typeof sub?.anchorY === 'number' ? sub.anchorY : subBox.top
  const bridgeTop = Math.min(subBox.top, bridgeAnchor) - 6
  const bridgeBottom = Math.max(subBox.top + subBox.height, bridgeAnchor + 44)

  const selectModel = async (m: RelayModel) => {
    setBusy(true)
    try {
      await api.selectModel({ key: m.key })
      onChanged()
      setOpen(false)
    } catch (err) {
      setNote(`切换失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const selectEffort = async (value: string) => {
    setBusy(true)
    try {
      await api.selectModel({ effort: value })
      onChanged()
      setOpen(false)
      setSub(null)
    } catch (err) {
      setNote(`设置失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const runTest = async () => {
    setTesting(true)
    setTest(null)
    try {
      const res = await api.testModel({ base_url: fBase, api_key: fKey, model_id: fModel })
      const n = res.models?.length ?? 0
      const named = res.model || fModel
      setTest(
        res.ok
          ? {
              ok: true,
              text: n
                ? `密钥可用，这个接口提供 ${n} 个模型${named ? `，已填的「${named}」在其中` : ''}`
                : `响应正常 · ${res.ms ?? '?'}ms · 已识别为 ${named}`,
              models: res.models,
            }
          : { ok: false, text: res.error || '测试失败', models: res.models },
      )
    } catch (err) {
      setTest({ ok: false, text: err instanceof Error ? err.message : String(err) })
    } finally {
      setTesting(false)
    }
  }

  const save = async () => {
    setBusy(true)
    setNote('')
    try {
      const res = await api.addModel({ name: fName, base_url: fBase, api_key: fKey, model_id: fModel, context_length: fCtx })
      if (!res.ok) {
        setNote(res.error || '保存失败')
        return
      }
      const ctx = res.model?.context_length
      if (res.model?.key) await api.selectModel({ key: res.model.key })
      onChanged()
      setFName('')
      setFBase('')
      setFKey('')
      setFModel('')
      setFCtx('')
      setTest(null)
      if (ctx) {
        setOpen(false)
      } else {
        setView('list')
        setNote('已保存。这个接口没报上下文长度，百分比会按 Hermes 里同名的模型来算；也可以在「上下文窗口」里直接填。')
      }
    } catch (err) {
      setNote(`保存失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const removeModel = async (key: string) => {
    setBusy(true)
    try {
      const res = await api.removeModel(key)
      if (!res.ok) {
        // 后端没删（例如这条属于某个渠道、该在渠道列表里删），别装作成功
        say('没删掉：这条可能属于某个渠道，去「添加渠道 / 模型」的渠道列表里删', false)
      }
      onChanged()
    } catch (err) {
      say(`删除失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const switchTab = (tab: 'channel' | 'single') => {
    setAddTab(tab)
    setTest(null)
    setChanTest(null)
    say('')
  }

  // 测试 = 让后端拿这个地址 + 密钥去问一次模型清单（CORS 和密钥都留在后端）
  const runChannelTest = async () => {
    setTesting(true)
    setChanTest(null)
    say('')
    try {
      const res = await api.testModel({ base_url: fBase, api_key: fKey, model_id: '' })
      const list = res.models ?? []
      setChanTest(
        res.ok
          ? {
              ok: true,
              text: list.length
                ? `密钥可用，这个接口提供 ${list.length} 个模型`
                : `响应正常 · ${res.ms ?? '?'}ms（没报模型清单，改用「单个模型」加）`,
              models: list,
            }
          : { ok: false, text: res.error || '测试失败', models: list },
      )
    } catch (err) {
      setChanTest({ ok: false, text: err instanceof Error ? err.message : String(err), models: [] })
    } finally {
      setTesting(false)
    }
  }

  // 保存整条渠道：后端再拉一次清单，把里面的模型全部收下（不勾选）
  const saveChannel = async () => {
    setBusy(true)
    say('')
    try {
      const res = await api.addChannel({ name: fName, base_url: fBase, api_key: fKey })
      if (!res.ok || !res.channel) {
        say(res.error || '保存失败')
        return
      }
      const n = res.channel.models.length
      onChanged()
      setFName('')
      setFBase('')
      setFKey('')
      setChanTest(null)
      // 不动你正在用的模型，只把新渠道放进列表
      setView('list')
      say(`已添加渠道「${res.channel.name}」，${n} 个模型都能选了。`, true)
    } catch (err) {
      say(`保存失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const syncChannelNow = async (id: string) => {
    setBusy(true)
    say('')
    try {
      const res = await api.syncChannel(id)
      if (!res.ok || !res.channel) {
        say(res.error || '同步失败')
        return
      }
      onChanged()
      say(`渠道「${res.channel.name}」已更新，现在有 ${res.channel.models.length} 个模型。`, true)
    } catch (err) {
      say(`同步失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const removeChannelNow = async (id: string) => {
    setBusy(true)
    say('')
    try {
      await api.removeChannel(id)
      onChanged()
      say('渠道已删除。', true)
    } catch (err) {
      say(`删除失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const inputCls =
    'w-full rounded-ctl border border-line bg-panel px-2 py-[6px] font-ui text-[12.5px] text-ink outline-none focus:border-muted focus:bg-input'

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex max-w-[380px] cursor-pointer items-center gap-[5px] rounded-full border border-line-strong/60 bg-panel/75 px-2.5 py-[3px] font-ui text-[12px] text-muted shadow-[0_1px_2px_rgba(45,45,42,0.04)] transition-all hover:border-accent/40 hover:bg-raised hover:text-ink hover:shadow-[0_2px_4px_rgba(45,45,42,0.06)] active:scale-[0.99]"
      >
        {channelLabel ? (
          <>
            <span className="min-w-0 truncate font-mono text-[11.5px] text-ink-2/75">{channelLabel}</span>
            <span className="flex-none text-line-strong">·</span>
          </>
        ) : null}
        <span className="min-w-0 truncate font-mono text-[11.5px] text-ink-2">{modelLabel}</span>
        <span className="flex-none text-line-strong">·</span>
        <span className="flex-none font-medium text-accent-text">{effortLabel}</span>
        <Chevron />
      </button>

      <>
        <div
          ref={panelRef}
          /* 开合动画全在 globals.css 的 .pop-panel 里（纯 CSS：@starting-style 入场 +
             allow-discrete 过渡 display），组件常驻、只切 data-open。 */
          data-open={open ? 'true' : undefined}
          className={cn(
            'pop-panel absolute right-0 bottom-[calc(100%+10px)] z-30 overflow-hidden rounded-[9px] border border-line-strong bg-input',
            // 外描边（1px 墨色）+ 近处小阴影 + 远处大阴影：和纸面明确分开
            PANEL_SHADOW,
          )}
          style={{ width: view === 'add' ? 340 : 288 }}
          onMouseLeave={closeSubSoon}
        >
          {view === 'list' && (
            <>
              <div className={PANEL_TITLE}>选择渠道</div>
              <div ref={listRef} onScroll={onListScroll} className="max-h-[320px] overflow-y-auto">
                {channels.map((c) => {
                  const active = c.models.some((m) => m.key === current.key)
                  return (
                    <Row
                      key={c.id}
                      onMouseEnter={hoverRow({ kind: 'models', channelId: c.id })}
                      onMouseLeave={closeSubSoon}
                      onClick={() => toggleSub({ kind: 'models', channelId: c.id })}
                    >
                      <span
                        data-ch={c.id}
                        data-current={active ? 'true' : undefined}
                        title={c.hint}
                        className={cn('min-w-0 flex-1 truncate text-[13px]', active ? 'text-accent-text' : 'text-ink')}
                      >
                        {c.label}
                      </span>
                      {active ? <Tick /> : <span className="flex-none font-mono text-[11px] text-faint">{c.models.length}</span>}
                      <Chevron dir="left" />
                    </Row>
                  )
                })}
              </div>
              <div className="h-px bg-line" />
              {note ? <div className="px-3 py-1.5 text-[11.5px] leading-[1.45] text-muted">{note}</div> : null}
              <Row
                onMouseEnter={hoverRow({ kind: 'efforts' })}
                onMouseLeave={closeSubSoon}
                onClick={() => toggleSub({ kind: 'efforts' })}
              >
                <span className="flex-1 text-[13px] text-ink">思考强度</span>
                <span className="text-[12.5px] text-muted">{effortLabel}</span>
                <Chevron dir="left" />
              </Row>
              <Row onClick={() => setView('add')}>
                <span className="flex-1 text-[13px] text-ink">添加渠道 / 模型</span>
                <Chevron dir="right" />
              </Row>
            </>
          )}

          {view === 'add' && (
            <div className="p-3">
              {/* 返回按钮 + 顶部标题 */}
              <div className="mb-2.5 flex items-center justify-between border-b border-line pb-2">
                <button
                  type="button"
                  onClick={() => {
                    setView('list')
                    setNote('')
                    setTest(null)
                    setChanTest(null)
                  }}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-ctl px-1.5 py-0.5 font-ui text-[12px] text-muted transition-colors hover:bg-raised hover:text-ink active:scale-[0.98]"
                >
                  <Chevron dir="left" />
                  <span>返回渠道列表</span>
                </button>
                <span className="font-ui text-[12px] font-medium text-ink-2">添加</span>
              </div>

              {/* 两个页签：整条渠道（默认）/ 单个模型（接口不给模型清单时兜底） */}
              <div className="mb-2.5 flex items-center gap-1 rounded-lg border border-line bg-panel p-0.5">
                {([['channel', '添加渠道'], ['single', '单个模型']] as const).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => switchTab(k)}
                    className={cn(
                      'flex-1 cursor-pointer rounded-md py-1 text-center font-ui text-[12px] transition-all',
                      addTab === k
                        ? 'bg-page font-medium text-ink shadow-[0_1px_2px_rgba(45,45,42,0.06)]'
                        : 'text-muted hover:text-ink',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {addTab === 'channel' ? (
                <>
                  <label className="mb-1 block text-[11.5px] text-muted">
                    渠道名称 <span className="text-faint">· 留空用域名</span>
                  </label>
                  <input className={inputCls} value={fName} onChange={(e) => setFName(e.target.value)} placeholder="打野" />
                  <label className="mt-2.5 mb-1 block text-[11.5px] text-muted">接口地址</label>
                  <input className={inputCls} value={fBase} onChange={(e) => setFBase(e.target.value)} placeholder="https://sub.example.com/v1" />
                  <label className="mt-2.5 mb-1 block text-[11.5px] text-muted">密钥</label>
                  <input className={inputCls} value={fKey} onChange={(e) => setFKey(e.target.value)} placeholder="sk-..." />
                  <div className="mt-3 flex items-center gap-2">
                    <button type="button" onClick={() => void runChannelTest()} disabled={testing} className={BTN_GHOST}>
                      {testing ? '测试中…' : '测试'}
                    </button>
                    <button type="button" onClick={() => void saveChannel()} disabled={busy} className={BTN_PRIMARY}>
                      {busy ? '保存中…' : '保存渠道'}
                    </button>
                  </div>

                  {chanTest ? (
                    <div
                      className={cn(
                        'mt-2.5 flex gap-1.5 text-[12px] leading-[1.5]',
                        chanTest.ok ? 'text-accent-text' : 'text-danger-text',
                      )}
                    >
                      <span className="mt-[6px] size-[6px] flex-none rounded-full bg-current" />
                      <span className="min-w-0 flex-1 [overflow-wrap:anywhere] whitespace-pre-wrap select-text">{chanTest.text}</span>
                    </div>
                  ) : null}
                  {chanTest?.models && chanTest.models.length > 0 ? (
                    <div className="mt-2">
                      <div className="mb-1 text-[11.5px] text-faint">这个接口的 {chanTest.models.length} 个模型</div>
                      <div className="flex max-h-[150px] flex-col gap-px overflow-y-auto">
                        {chanTest.models.map((id) => (
                          <div key={id} className="px-1.5 py-[3px] font-mono text-[12px] leading-[1.5] text-ink-2">
                            {id}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {(payload.channels || []).length > 0 ? (
                    <div className="mt-3 border-t border-line pt-2.5">
                      <div className="mb-1 text-[11.5px] text-muted">已添加的渠道</div>
                      <div className="flex max-h-[120px] flex-col gap-px overflow-y-auto">
                        {(payload.channels || []).map((ch) => (
                          <div
                            key={ch.id}
                            className="group/ch flex items-center gap-1.5 rounded-[5px] px-1.5 py-[3px] transition-colors hover:bg-panel"
                          >
                            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink" title={`${ch.name} · ${ch.base_url}`}>
                              {ch.name}
                            </span>
                            <span className="flex-none font-mono text-[11px] text-faint">{ch.models.length}</span>
                            <span
                              role="button"
                              tabIndex={-1}
                              title="重新问一次这个接口有哪些模型"
                              onClick={() => void syncChannelNow(ch.id)}
                              className="hidden flex-none cursor-pointer text-ink-2 group-hover/ch:inline hover:text-accent-text"
                            >
                              <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true" className="block h-[13px] w-[13px] overflow-visible">
                                <path d="M10.6 6.5a4.1 4.1 0 1 1-1.5-3.15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                <path d="M9.3 1.1v2.5h2.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </span>
                            <span
                              role="button"
                              tabIndex={-1}
                              title="删掉这个渠道和它的全部模型"
                              onClick={() => void removeChannelNow(ch.id)}
                              className="hidden flex-none cursor-pointer text-ink-2 group-hover/ch:inline hover:text-danger-text"
                            >
                              <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true" className="block h-[13px] w-[13px] overflow-visible">
                                <line x1="3" y1="3" x2="10" y2="10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                                <line x1="10" y1="3" x2="3" y2="10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                              </svg>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <div className="mb-2.5 text-[11.5px] leading-[1.5] text-muted">只支持标准 OpenAI 格式的接口</div>
                  <label className="mb-1 block text-[11.5px] text-muted">显示名称</label>
                  <input className={inputCls} value={fName} onChange={(e) => setFName(e.target.value)} placeholder="Kimi K3" />
                  <label className="mt-2.5 mb-1 block text-[11.5px] text-muted">接口地址</label>
                  <input className={inputCls} value={fBase} onChange={(e) => setFBase(e.target.value)} placeholder="https://api.example.com/v1" />
                  <label className="mt-2.5 mb-1 block text-[11.5px] text-muted">密钥</label>
                  <input className={inputCls} value={fKey} onChange={(e) => setFKey(e.target.value)} placeholder="sk-..." />
                  <label className="mt-2.5 mb-1 block text-[11.5px] text-muted">模型 ID</label>
                  <input className={inputCls} value={fModel} onChange={(e) => setFModel(e.target.value)} placeholder="kimi-k3" />
                  <label className="mt-2.5 mb-1 block text-[11.5px] text-muted">
                    上下文窗口 <span className="text-faint">· 可以留空</span>
                  </label>
                  <input
                    className={inputCls}
                    value={fCtx}
                    onChange={(e) => setFCtx(e.target.value)}
                    placeholder="留空自动查，如 128000 或 128k"
                  />

                  <div className="mt-3 flex items-center gap-2">
                    <button type="button" onClick={() => void runTest()} disabled={testing} className={BTN_GHOST}>
                      {testing ? '测试中…' : '测试'}
                    </button>
                    <button type="button" onClick={() => void save()} disabled={busy} className={BTN_PRIMARY}>
                      {busy ? '保存中…' : '保存'}
                    </button>
                  </div>

                  {test ? (
                    <div
                      className={cn(
                        'mt-2.5 flex gap-1.5 text-[12px] leading-[1.5]',
                        test.ok ? 'text-accent-text' : 'text-danger-text',
                      )}
                    >
                      <span className="mt-[6px] size-[6px] flex-none rounded-full bg-current" />
                      {/* 报错可能很长：换行完整显示，并且允许选中复制，不再被面板裁掉 */}
                      <span className="min-w-0 flex-1 [overflow-wrap:anywhere] whitespace-pre-wrap select-text">{test.text}</span>
                    </div>
                  ) : null}
                  {test?.models && test.models.length > 0 ? (
                    <div className="mt-2">
                      <div className="mb-1 text-[11.5px] text-faint">这个接口提供 {test.models.length} 个模型，点一个填进模型 ID</div>
                      <div className="flex max-h-[168px] flex-col gap-px overflow-y-auto">
                        {test.models.map((id) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setFModel(id)}
                            className={cn(
                              'cursor-pointer rounded-[5px] px-1.5 py-[3px] text-left font-mono text-[12px] leading-[1.5] transition-colors hover:bg-panel',
                              id === fModel ? 'text-accent-text' : 'text-ink-2',
                            )}
                          >
                            {id}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </>
              )}

              {note ? (
                <div
                  className={cn(
                    'mt-2 text-[11.5px] [overflow-wrap:anywhere] whitespace-pre-wrap select-text',
                    noteOk ? 'text-accent-text' : 'text-danger-text',
                  )}
                >
                  {note}
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* 左侧子面板：渠道下的模型 / 思考强度档位，两者共用这一个框。纵向位置由 place 算好 */}
        <div
          ref={subPanelRef}
          data-open={open && view === 'list' && sub ? 'true' : undefined}
          className={cn(
            'pop-panel absolute right-[294px] z-30 overflow-hidden rounded-[9px] border border-line-strong bg-input',
            PANEL_SHADOW,
          )}
          style={{ width: shownSub?.kind === 'efforts' ? 152 : 232, top: subBox.top }}
          onMouseEnter={() => {
            if (sub) openSub(sub)
          }}
          onMouseLeave={closeSubSoon}
        >
          {shownSub?.kind === 'efforts' ? (
            <>
              <div className={PANEL_TITLE}>思考强度</div>
              {efforts.map((e) => (
                <Row key={e.value} onClick={() => !busy && void selectEffort(e.value)}>
                  <span className="flex-1 text-[12.5px] text-ink">{e.label}</span>
                  {e.value === effortValue ? <Tick /> : null}
                </Row>
              ))}
            </>
          ) : shownSub?.kind === 'models' ? (
            <>
              <div className={cn(PANEL_TITLE, 'truncate')}>{subChannel?.label || '模型'}</div>
              <div ref={subListRef} className="max-h-[300px] overflow-y-auto">
                {(subChannel?.models || []).map((m) => (
                  <div key={m.key} className="group/model relative">
                    <Row onClick={() => !busy && void selectModel(m)}>
                      {/* 主文本是真实模型 ID（渠道名已在标题里），页面上起的化名退成副标题 */}
                      {(() => {
                        const t = modelTitles(m, subChannel?.label)
                        return <RowText name={t.id} sub={t.alias || undefined} />
                      })()}
                      {m.key === current.key ? <Tick /> : null}
                      {(m.source === 'custom' || !!m.channel_id) && m.key !== current.key && (
                        <span
                          role="button"
                          tabIndex={-1}
                          title="删掉这个模型"
                          onClick={(e) => {
                            e.stopPropagation()
                            void removeModel(m.key)
                          }}
                          className="ml-1.5 hidden flex-none cursor-pointer text-ink-2 group-hover/model:inline hover:text-danger-text"
                        >
                          <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true" className="block h-[13px] w-[13px] overflow-visible">
                            <line x1="3" y1="3" x2="10" y2="10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                            <line x1="10" y1="3" x2="3" y2="10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                          </svg>
                        </span>
                      )}
                    </Row>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>

        {/* 主面板与子面板之间那条缝：铺一层透明的「桥」，鼠标横穿/斜穿时都还在面板上 */}
        {open && view === 'list' && sub && subBox.height > 0 ? (
          <div
            aria-hidden="true"
            onMouseEnter={() => {
              if (sub) openSub(sub)
            }}
            className="absolute right-[286px] z-20 w-[10px]"
            style={{ top: bridgeTop, height: Math.max(bridgeBottom - bridgeTop, 0) }}
          />
        ) : null}
      </>
    </div>
  )
}
