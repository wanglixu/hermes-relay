/** 输入框草稿的存取：localStorage 里一份，刷新 / 切换会话都还在。
 *
 *  从 components/chat/composer.tsx 拆出来（2026-10-19）：那边一千多行，
 *  草稿规则（存哪些、什么时候清）本来跟打字逻辑没绑死。纯函数，不碰 React。
 */

/** 待发附件。url 是预览地址；path 由上传结果填回来（刷新后靠它把图找回来）。 */
export type Pending = {
  name: string
  mime: string
  url: string
  /** 本地 blob 地址：上传完 url 会换成服务端地址，预览仍旧用这个（点开瞬时出图，不用回后端拿） */
  localUrl?: string
  path?: string
  ready?: Promise<string>
}

export const DRAFT_PREFIX = 'hermes-draft:'

/** 还没建会话时先往这个目录传，发出去之后服务端找不到会回退到这里（见 server.py 的 _serve_upload） */
export function uploadDir(sessionId: string | null) {
  return sessionId || 'draft'
}

export function serverUrl(sessionId: string | null, path: string) {
  const name = path.split('/').pop() || ''
  return `/api/uploads/${encodeURIComponent(uploadDir(sessionId))}/${encodeURIComponent(name)}`
}

export type PastedSnippet = {
  id: string
  content: string
  lines: number
  bytes: number
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(2)} KB`
}


export type Draft = {
  text: string
  files: { name: string; mime: string; path: string }[]
  pasted?: { id: string; content: string }[]
  quoted?: string | null
}


export function loadDraft(
  key: string,
  sessionId: string | null,
): { text: string; files: Pending[]; pasted: PastedSnippet[]; quoted: string | null } {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return { text: '', files: [], pasted: [], quoted: null }
    const d = JSON.parse(raw) as Draft
    const files: Pending[] = (d.files || [])
      .filter((f) => f && f.path)
      .map((f) => ({
        name: f.name || 'image',
        mime: f.mime || 'image/*',
        path: f.path,
        url: serverUrl(sessionId, f.path),
        ready: Promise.resolve(f.path),
      }))
    const pasted: PastedSnippet[] = (d.pasted || []).map((p) => {
      const c = p.content || ''
      return {
        id: p.id || ('pasted-' + Math.random().toString(36).slice(2, 7)),
        content: c,
        lines: c.split(/\r?\n/).length,
        bytes: new Blob([c]).size,
      }
    })
    return {
      text: typeof d.text === 'string' ? d.text : '',
      files,
      pasted,
      quoted: typeof d.quoted === 'string' ? d.quoted : null,
    }
  } catch {
    return { text: '', files: [], pasted: [], quoted: null }
  }
}

export function saveDraft(
  key: string,
  text: string,
  files: Pending[],
  pasted: PastedSnippet[],
  quoted: string | null = null,
) {
  try {
    const done = files.filter((f) => f.path)
    if (!text && done.length === 0 && pasted.length === 0 && !quoted) {
      localStorage.removeItem(key)
      return
    }
    const d: Draft = {
      text,
      files: done.map((f) => ({ name: f.name, mime: f.mime, path: f.path as string })),
      pasted: pasted.map((p) => ({ id: p.id, content: p.content })),
      quoted: quoted || undefined,
    }
    localStorage.setItem(key, JSON.stringify(d))
  } catch {
    /* 存不下就算了，不打断输入 */
  }
}

