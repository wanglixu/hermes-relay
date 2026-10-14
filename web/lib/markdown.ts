// Markdown 渲染：marked 解析 → DOMPurify 消毒 → Shiki 高亮 + 代码块装饰。
// 高亮器按需精细导入（仅 4 种语言 + JS 正则引擎，不带 WASM），首次用到才加载。
import { createHighlighterCore, type HighlighterCore } from '@shikijs/core'
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript'
import bash from '@shikijs/langs/bash'
import css from '@shikijs/langs/css'
import diff from '@shikijs/langs/diff'
import dockerfile from '@shikijs/langs/dockerfile'
import go from '@shikijs/langs/go'
import html from '@shikijs/langs/html'
import ini from '@shikijs/langs/ini'
import json from '@shikijs/langs/json'
import markdown from '@shikijs/langs/markdown'
import nginx from '@shikijs/langs/nginx'
import python from '@shikijs/langs/python'
import sql from '@shikijs/langs/sql'
import toml from '@shikijs/langs/toml'
import typescript from '@shikijs/langs/typescript'
import yaml from '@shikijs/langs/yaml'
import githubLight from '@shikijs/themes/github-light'
import DOMPurify from 'dompurify'
import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: true })

export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false }) as string
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'rel'] })
}

/** 代码高亮主题：唯一配色是暖纸（浅色），固定用 github-light。
 *  语法颜色是写进 inline style 的；配色不再可切，所以不需要按主题重算。 */
function currentTheme() {
  return githubLight
}
const LANG_ALIAS: Record<string, string> = {
  bash: 'bash',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  json: 'json',
  jsonc: 'json',
  python: 'python',
  py: 'python',
  ts: 'typescript',
  typescript: 'typescript',
  yaml: 'yaml',
  yml: 'yaml',
  go: 'go',
  golang: 'go',
  sql: 'sql',
  mysql: 'sql',
  postgres: 'sql',
  postgresql: 'sql',
  dockerfile: 'dockerfile',
  docker: 'dockerfile',
  nginx: 'nginx',
  conf: 'nginx',
  ini: 'ini',
  cfg: 'ini',
  toml: 'toml',
  html: 'html',
  xml: 'html',
  svg: 'html',
  css: 'css',
  scss: 'css',
  less: 'css',
  md: 'markdown',
  markdown: 'markdown',
  diff: 'diff',
  patch: 'diff',
}

let hlPromise: Promise<HighlighterCore> | null = null
function highlighter(): Promise<HighlighterCore> {
  if (!hlPromise) {
    hlPromise = createHighlighterCore({
      themes: [githubLight],
      langs: [
        bash,
        json,
        python,
        typescript,
        yaml,
        go,
        sql,
        dockerfile,
        nginx,
        ini,
        toml,
        html,
        css,
        markdown,
        diff,
      ],
      engine: createJavaScriptRegexEngine(),
    })
  }
  return hlPromise
}

/** 高亮单独的 code 元素：只替换 code 内部，外层 pre 的底色/边框/内边距还是我们自己的令牌。 */
async function highlightCode(el: HTMLElement, lang: string): Promise<void> {
  if (el.dataset.hl === '1') return
  el.dataset.hl = '1'
  try {
    const h = await highlighter()
    const full = h.codeToHtml(el.textContent ?? '', { lang, theme: currentTheme() })
    const inner = new DOMParser().parseFromString(full, 'text/html').querySelector('code')?.innerHTML
    if (inner) el.innerHTML = inner
  } catch {
    delete el.dataset.hl // 高亮失败不影响阅读，下次还能再试
  }
}

const COPY_CLASS =
  'code-copy absolute top-[7px] right-[9px] rounded-ctl border border-line bg-raised px-2 py-[2px] font-mono text-[11px] leading-[1.4] text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:border-accent-text hover:text-ink focus-visible:opacity-100'

/** 渲染进 DOM 之后调用：代码高亮、语言标签、复制按钮、链接新窗口打开。 */
export function decorate(root: HTMLElement | null): void {
  if (!root) return

  root.querySelectorAll('pre > code').forEach((node) => {
    const el = node as HTMLElement
    const pre = el.parentElement as HTMLPreElement | null
    if (!pre) return

    // 包一层不滚动的容器：语言标签和复制按钮要固定住，不能跟着代码横向滚走
    let wrap = pre.parentElement
    if (!wrap || !wrap.classList.contains('code-wrap')) {
      wrap = document.createElement('div')
      wrap.className = 'code-wrap group relative mb-6'
      pre.parentNode?.insertBefore(wrap, pre)
      wrap.appendChild(pre)
    }

    const lang = (el.className.match(/language-([\w+#-]+)/) || [])[1]?.toLowerCase()
    if (lang && !wrap.querySelector('.code-lang')) {
      const label = document.createElement('span')
      label.className =
        'code-lang pointer-events-none absolute top-2 left-3.5 font-mono text-[11px] tracking-[0.06em] text-muted uppercase'
      label.textContent = lang
      wrap.appendChild(label)
      pre.classList.add('pt-[30px]')
    }

    if (!wrap.querySelector('.code-copy')) {
      const btn = document.createElement('button')
      btn.className = COPY_CLASS
      btn.type = 'button'
      btn.textContent = '复制'
      btn.setAttribute('aria-label', '复制这段代码')
      btn.addEventListener('click', () => {
        const text = el.textContent || ''
        const done = () => {
          btn.textContent = '已复制'
          setTimeout(() => (btn.textContent = '复制'), 1500)
        }
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(text).then(done, () => {})
        } else {
          const ta = document.createElement('textarea')
          ta.value = text
          document.body.appendChild(ta)
          ta.select()
          try {
            document.execCommand('copy')
            done()
          } catch {
            /* 复制不了就算了 */
          }
          ta.remove()
        }
      })
      wrap.appendChild(btn)
    }

    const target = lang ? LANG_ALIAS[lang] : undefined
    if (target) void highlightCode(el, target)
  })

  root.querySelectorAll('img').forEach((node) => {
    const img = node as HTMLImageElement
    img.loading = 'lazy'
    img.classList.add('max-h-[420px]', 'rounded-ctl', 'border', 'border-line')
    // 包在链接里的图片：点击是打开链接，不做放大提示
    if (img.closest('a')) return
    img.classList.add('cursor-zoom-in')
    if (img.parentElement?.classList.contains('zoom-wrap')) return
    const wrap = document.createElement('span')
    wrap.className = 'zoom-wrap'
    img.parentNode?.insertBefore(wrap, img)
    wrap.appendChild(img)
  })

  root.querySelectorAll('a[href]').forEach((node) => {
    const a = node as HTMLAnchorElement
    // 站内的样张 / 文档页（html、md、pdf、图片…）：点了在右侧面板里看，不新开窗口。
    // 其余（外链、站内深层路径）照旧新窗口。点击处理在 page.tsx 的 onStreamClick。
    const inner = internalPreviewUrl(a.getAttribute('href') || '')
    if (inner) {
      a.dataset.previewUrl = inner
      a.removeAttribute('target')
      a.removeAttribute('rel')
      if (!a.getAttribute('title')) a.setAttribute('title', '点开在右侧查看')
      return
    }
    a.setAttribute('target', '_blank')
    a.setAttribute('rel', 'noopener noreferrer')
  })

  markFilePaths(root)
}

/** 换了配色之后调用：语法颜色是 inline style，得把「已高亮」标记清掉，再用新主题重算一遍。 */
export function rehighlight(root: HTMLElement | null): void {
  if (!root) return
  root.querySelectorAll('pre > code[data-hl]').forEach((el) => {
    delete (el as HTMLElement).dataset.hl
  })
  decorate(root)
}

/** 站内可预览的链接：同源，且路径结尾是能直接喂给 iframe 的类型。
 *  只认这几种扩展名（不是「所有站内链接」）—— 免得 `/`、`/settings` 这类页面被塞进 iframe 里。
 *  返回绝对 URL；不是站内可预览的就返回 null。 */
const PREVIEWABLE = /\.(?:html?|md|markdown|txt|json|ya?ml|pdf|png|jpe?g|gif|webp|svg|csv|log)$/i
function internalPreviewUrl(href: string): string | null {
  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return null
  try {
    const u = new URL(href, location.origin)
    if (u.origin !== location.origin) return null
    if (!PREVIEWABLE.test(u.pathname)) return null
    return u.href
  } catch {
    return null
  }
}

/** 认「像个文件路径」的串：以 / 或 ~/ 开头，至少一层目录，结尾是常见扩展名。
 *  前面不能紧挨字母/冒号/点——那样多半是 URL 或英文单词的尾巴。 */
const FILE_PATH_SRC =
  '(?<![\\w:/.-])((?:~/|/)[\\w.\\-@]+(?:/[\\w.\\-@]+)*/[\\w.\\-@]+\\.(?:md|markdown|txt|json|ya?ml|py|ts|tsx|js|jsx|mjs|cjs|css|scss|html?|xml|svg|sh|bash|zsh|log|csv|tsv|toml|ini|conf|sql|go|rs|java|cpp|rb|php|lua|vue|env|pdf|png|jpe?g|gif|webp))'
const FILE_PATH_SPLIT = new RegExp(FILE_PATH_SRC, 'gi')
const FILE_PATH_TEST = new RegExp(FILE_PATH_SRC, 'i')
const FILE_PATH_ONLY = new RegExp(`^${FILE_PATH_SRC}$`, 'i')

const CHIP_CLASS =
  'cursor-pointer text-accent-text underline decoration-dotted underline-offset-2 transition-colors hover:decoration-solid'

/** 把正文里的文件路径标成可点元素（页面用事件委托听 [data-file-path]）。
 *  行内 code 整段就是一个路径的，直接挂在 code 上；普通文字里夹着的包一层 span。 */
function markFilePaths(root: HTMLElement): void {
  root.querySelectorAll('code').forEach((node) => {
    const el = node as HTMLElement
    if (el.closest('pre') || el.dataset.filePath) return
    const whole = (el.textContent || '').trim()
    const m = whole.match(FILE_PATH_ONLY)
    if (!m) return
    el.dataset.filePath = m[1]
    el.title = '点开在右侧预览'
    el.classList.add(...CHIP_CLASS.split(' '))
  })

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement
      if (!p || p.closest('pre, code, a, [data-file-path]')) return NodeFilter.FILTER_REJECT
      return FILE_PATH_TEST.test(n.nodeValue || '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    },
  })
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)

  for (const node of nodes) {
    const parts = (node.nodeValue || '').split(FILE_PATH_SPLIT)
    if (parts.length < 3) continue
    const frag = document.createDocumentFragment()
    parts.forEach((part, i) => {
      if (i % 2 === 1) {
        const chip = document.createElement('span')
        chip.dataset.filePath = part
        chip.setAttribute('role', 'button')
        chip.setAttribute('tabindex', '0')
        chip.title = '点开在右侧预览'
        chip.textContent = part
        chip.className = CHIP_CLASS
        frag.appendChild(chip)
      } else if (part) {
        frag.appendChild(document.createTextNode(part))
      }
    })
    node.parentNode?.replaceChild(frag, node)
  }
}
