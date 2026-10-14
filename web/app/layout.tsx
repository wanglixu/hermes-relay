import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import './globals.css'

export const metadata: Metadata = {
  title: 'Hermes Relay',
  icons: { icon: '/favicon.svg' },
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#fbfaf7',
  width: 'device-width',
  initialScale: 1,
}

/** 拉丁：Source Sans 3（自托管在 web/fonts/，不进 git）。
 *  fallback + adjustFontFallback：Next 会另生成一份度量对齐的兜底字体（size-adjust / ascent-override），
 *  字体晚到时拉丁字符的宽度和行高跟真字体接近，换行位置不会跳。
 *  中文语境的弯引号（U+2018–201F）和省略号（U+2026）已经在**字体文件里被剔掉了**
 *  （见 scripts/fetch-fonts.sh 里的 subset-latin.py），浏览器会自然落到思源黑体上，宽度才正常；
 *  英文侧这几个字符因此会稍微宽一点，是权衡后的选择。 */
const latin = localFont({
  src: [
    { path: '../fonts/source-sans-3/source-sans-3-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/source-sans-3/source-sans-3-latin-600-normal.woff2', weight: '600', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-latin',
  fallback: ['system-ui', 'sans-serif'],
  adjustFontFallback: 'Arial',
  preload: true,
})

/** 首屏一定会用到的两个中文分片：思源黑体里覆盖最常用汉字的 118 / 119 两片
 *  （118 是不了在人上大、119 是一有的中，合计 64KB）。
 *  更纱黑体的拉丁片有 276KB（它把 Latin/Greek/Cyrillic/符号装在一片里），预加载不划算，交给正常按需取。
 *  文件名由 web/scripts/fetch-fonts.sh 生成 —— **重新生成字体后要同步这两个值**（脚本会打印）。 */
const PRELOAD_FONTS = [
  '/fonts/noto-sans-sc/noto-sans-sc-118-400-normal.woff2',
  '/fonts/noto-sans-sc/noto-sans-sc-119-400-normal.woff2',
]

/** 配色只剩一套「暖纸」，值是写死在 globals.css 的 :root 里的，
 *  所以这里不再需要「样式表之前先贴 data-theme」那段防闪脚本。 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={latin.variable}>
      <head>
        {/* 两个中文字体的分片 @font-face（unicode-range），字体文件随包发，文件系统里现取 */}
        <link rel="stylesheet" href="/fonts/noto-sans-sc.css" />
        <link rel="stylesheet" href="/fonts/sarasa-mono-sc.css" />
        {PRELOAD_FONTS.map((href) => (
          /* crossOrigin 同源也要写：不写的话预加载拿到的和 @font-face 取的不是同一份，会下两次 */
          <link key={href} rel="preload" as="font" type="font/woff2" href={href} crossOrigin="anonymous" />
        ))}
      </head>
      <body>{children}</body>
    </html>
  )
}
