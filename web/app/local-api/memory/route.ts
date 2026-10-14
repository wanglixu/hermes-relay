import fs from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'

// ponytail: 这三份文件就在跑这个前端的这台机器上，直接读盘，不绕 Python 后端。
export const dynamic = 'force-dynamic'

const HERMES_HOME = process.env.HERMES_HOME || `${process.env.HOME || '/root'}/.hermes`
const BACKUP_DIR = path.join(HERMES_HOME, 'hermes-relay', 'memory-backups')
const KEEP_BACKUPS = 20
const MAX_BYTES = 256 * 1024

// 路径全部写死：不接受任何来自请求的路径拼接。
const FILES: Record<string, { label: string; file: string; defaultLimit: number | null }> = {
  memory: { label: '记忆', file: path.join(HERMES_HOME, 'memories', 'MEMORY.md'), defaultLimit: 5000 },
  user: { label: '用户档案', file: path.join(HERMES_HOME, 'memories', 'USER.md'), defaultLimit: 2500 },
  soul: { label: '智能体灵魂', file: path.join(HERMES_HOME, 'SOUL.md'), defaultLimit: null },
}

/** 上限从 config.yaml 现取（正则抠两行，不为它引 yaml 依赖） */
function readLimits(): Record<string, number> {
  const out: Record<string, number> = {}
  try {
    const cfg = fs.readFileSync(path.join(HERMES_HOME, 'config.yaml'), 'utf8')
    for (const [key, re] of [
      ['memory', /^\s*memory_char_limit:\s*(\d+)/m],
      ['user', /^\s*user_char_limit:\s*(\d+)/m],
    ] as const) {
      const m = cfg.match(re)
      if (m) out[key] = Number(m[1])
    }
  } catch {
    // 读不到就用默认值
  }
  return out
}

/** 和 Hermes 一个口径（tools/memory_tool_store.py）：按 "\n§\n" 切、去空白、去重，拼回去量长度 */
function countChars(key: string, text: string): number {
  if (key === 'soul') return text.trim().length
  const parts = [...new Set(text.split('\n§\n').map((s) => s.trim()).filter(Boolean))]
  return parts.join('\n§\n').length
}

function spec(key: string) {
  const entry = FILES[key]
  try {
    const content = fs.readFileSync(entry.file, 'utf8')
    return {
      key,
      label: entry.label,
      path: entry.file,
      content,
      chars: countChars(key, content),
      limit: entry.defaultLimit === null ? null : (readLimits()[key] ?? entry.defaultLimit),
      mtime: fs.statSync(entry.file).mtimeMs / 1000,
    }
  } catch {
    return {
      key,
      label: entry.label,
      path: entry.file,
      content: '',
      chars: 0,
      limit: entry.defaultLimit,
      mtime: null,
    }
  }
}

export async function GET() {
  return NextResponse.json({ files: Object.keys(FILES).map(spec) })
}

export async function PUT(req: Request) {
  const key = new URL(req.url).searchParams.get('key') || ''
  if (!(key in FILES)) {
    return NextResponse.json({ error: `没有这份文件：${key}` }, { status: 404 })
  }
  const body = await req.json().catch(() => null)
  const content = body?.content
  if (typeof content !== 'string') {
    return NextResponse.json({ error: 'content 必须是字符串' }, { status: 400 })
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) {
    return NextResponse.json({ error: '内容超过 256 KB，拒绝写入' }, { status: 413 })
  }

  const file = FILES[key].file
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true })
    if (fs.existsSync(file)) {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')
      fs.copyFileSync(file, path.join(BACKUP_DIR, `${key}-${stamp}.md`))
      const old = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith(`${key}-`)).sort()
      for (const stale of old.slice(0, -KEEP_BACKUPS)) fs.unlinkSync(path.join(BACKUP_DIR, stale))
    }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    // 临时文件 + rename：读的人永远看不到写了一半的文件
    const tmp = `${file}.tmp-relay`
    fs.writeFileSync(tmp, content.replace(/\r\n?/g, '\n'), 'utf8')
    fs.renameSync(tmp, file)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
  const { content: _omit, ...after } = spec(key)
  return NextResponse.json({ ok: true, ...after })
}
