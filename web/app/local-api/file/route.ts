import fs from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'

// ponytail: 预览的文件就在跑这个前端的这台机器上，直接读盘，不绕 Python 后端
// （后端只在这轮对话之间才能重启，前端随时可以重建）。
export const dynamic = 'force-dynamic'

// 只允许读这几棵树下的文件。这台机器外面有 site-auth 登录网关，只有主人进得来。
const ALLOWED_ROOTS = ['/root', '/tmp', '/opt', '/srv', '/var/log', '/home', '/etc']

// 密钥类一律不给看。
const DENY =
  /(^|\/)\.(ssh|gnupg|oci|aws|kube)(\/|$)|(^|\/)\.env(\.|$)|(^|\/)(id_rsa|id_ed25519|authorized_keys|\.netrc)$|\.(pem|key|p12|pfx)$|(^|\/)(credentials?|secrets?)(\.|$)/i

const MAX_BYTES = 1024 * 1024

// 扩展名 → 展示方式。没列到的一律按纯文本处理（能读就读，读不了再说）。
const KIND: Record<string, string> = {
  md: 'markdown',
  markdown: 'markdown',
  txt: 'text',
  log: 'text',
  csv: 'text',
  tsv: 'text',
  json: 'code',
  yaml: 'code',
  yml: 'code',
  toml: 'code',
  ini: 'code',
  conf: 'code',
  env: 'code',
  py: 'code',
  ts: 'code',
  tsx: 'code',
  js: 'code',
  jsx: 'code',
  mjs: 'code',
  cjs: 'code',
  css: 'code',
  scss: 'code',
  html: 'code',
  htm: 'code',
  xml: 'code',
  svg: 'code',
  sh: 'code',
  bash: 'code',
  zsh: 'code',
  sql: 'code',
  go: 'code',
  rs: 'code',
  java: 'code',
  c: 'code',
  h: 'code',
  cpp: 'code',
  rb: 'code',
  php: 'code',
  lua: 'code',
  vue: 'code',
}

function inside(target: string): boolean {
  return ALLOWED_ROOTS.some((r) => target === r || target.startsWith(r + '/'))
}

function expand(raw: string): string {
  const home = process.env.HOME || '/root'
  if (raw === '~') return home
  if (raw.startsWith('~/')) return path.join(home, raw.slice(2))
  return raw
}

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('path') || ''
  if (!raw.trim()) return NextResponse.json({ ok: false, error: '没给文件路径' }, { status: 400 })

  const target = path.resolve(expand(raw.trim()))

  if (!inside(target)) {
    return NextResponse.json({ ok: false, error: '这个位置不在可预览的范围里' }, { status: 403 })
  }
  if (DENY.test(target)) {
    return NextResponse.json({ ok: false, error: '这个文件不允许预览' }, { status: 403 })
  }

  let real: string
  let st: fs.Stats
  try {
    real = fs.realpathSync(target)
    st = fs.statSync(real)
  } catch {
    return NextResponse.json({ ok: false, error: '文件不存在或读不到' }, { status: 404 })
  }
  // 软链接可能指向别处，解析之后再判一次
  if (!inside(real) || DENY.test(real)) {
    return NextResponse.json({ ok: false, error: '这个文件不允许预览' }, { status: 403 })
  }
  if (st.isDirectory()) {
    return NextResponse.json({ ok: false, error: '这是个目录，不是一个文件' }, { status: 400 })
  }
  if (st.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, size: st.size, error: `文件 ${(st.size / 1024 / 1024).toFixed(1)} MB，太大，先不预览` },
      { status: 413 },
    )
  }

  let buf: Buffer
  try {
    buf = fs.readFileSync(real)
  } catch {
    return NextResponse.json({ ok: false, error: '文件不存在或读不到' }, { status: 404 })
  }
  if (buf.subarray(0, 8000).includes(0)) {
    return NextResponse.json({ ok: false, error: '这是二进制文件，先不预览' }, { status: 415 })
  }

  const ext = path.extname(real).slice(1).toLowerCase()
  return NextResponse.json({
    ok: true,
    path: target,
    realPath: real,
    name: path.basename(real),
    ext,
    kind: KIND[ext] || 'text',
    size: st.size,
    mtime: st.mtimeMs / 1000,
    content: buf.toString('utf8'),
  })
}
