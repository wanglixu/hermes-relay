import { NextResponse } from 'next/server'

// Hermes 自己的状态面板（hermes-dashboard，9119）。只取「网关在不在跑」这一项，
// 整份状态里还有磁盘、会话数之类，不往页面上传。
export const dynamic = 'force-dynamic'

const URL = process.env.HERMES_STATUS_URL || 'http://127.0.0.1:9119/api/status'

export async function GET() {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 4000)
  try {
    const res = await fetch(URL, { signal: ac.signal, cache: 'no-store' })
    if (!res.ok) return NextResponse.json({ ok: false }, { status: 200 })
    const data = (await res.json()) as { gateway_state?: unknown }
    return NextResponse.json({ ok: data.gateway_state === 'running' })
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 })
  } finally {
    clearTimeout(timer)
  }
}
