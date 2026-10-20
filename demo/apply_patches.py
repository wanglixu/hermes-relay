#!/usr/bin/env python3
"""把一份 web/ 的副本改造成「静态演示构建」。

只做加法，不碰渲染逻辑：
  1. next.config.ts  →  output: 'export' + basePath（GitHub Pages 项目子路径）
  2. app/layout.tsx  →  手写的字体 / 图标 href 补上 basePath（Next 只给 next/font 和 /_next 自动加）
  3. app/page.tsx    →  引入 lib/demo-mock.ts（接管 /api 与 /local-api）
  4. 删掉不能静态导出的 route handler（app/local-api）与演示用不到的大字体
  5. public/fonts/noto-sans-sc.css 里的 url(/fonts/...) 补上 basePath

用法：python3 demo/apply_patches.py <构建目录> [basePath]
任何一条匹配失败都会直接报错退出 —— 源文件改过之后，这里会当场告诉你。
"""

import re
import shutil
import sys
from pathlib import Path

build = Path(sys.argv[1])
base = sys.argv[2] if len(sys.argv) > 2 else '/hermes-relay'


def sub(path: Path, old: str, new: str, count: int = 1) -> None:
    text = path.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'[apply_patches] 没找到要替换的内容：{path.name} → {old[:60]!r}')
    path.write_text(text.replace(old, new, count), encoding='utf-8')
    print(f'  patched {path.relative_to(build)}')


# 1. next.config.ts
(build / 'next.config.ts').write_text(
    f"""import type {{ NextConfig }} from 'next'

/** 静态演示构建：output: 'export'，没有 Node 进程；/api 全部由 lib/demo-mock.ts 在浏览器里应答。
 *  basePath 让项目站挂在 GitHub Pages 的 /{base.strip('/')} 子路径下。 */
const nextConfig: NextConfig = {{
  output: 'export',
  basePath: '{base}',
  assetPrefix: '{base}',
  trailingSlash: true,
  images: {{ unoptimized: true }},
  reactStrictMode: true,
}}

export default nextConfig
""",
    encoding='utf-8',
)
print('  wrote next.config.ts')

# 2. layout.tsx
layout = build / 'app/layout.tsx'
sub(layout, "icons: { icon: '/favicon.svg' },", f"icons: {{ icon: '{base}/favicon.svg' }},")
sub(
    layout,
    'const PRELOAD_FONTS = [',
    f"/** 手写资源路径要带 basePath（Next 只给 next/font 与 /_next 自动加） */\nconst ASSET = '{base}'\n\nconst PRELOAD_FONTS = [",
)
sub(
    layout,
    '<link rel="stylesheet" href="/fonts/noto-sans-sc.css" />',
    '<link rel="stylesheet" href={`${ASSET}/fonts/noto-sans-sc.css`} />',
)
# 演示站不带更纱黑体（32MB），等宽退回系统字体
sub(layout, '<link rel="stylesheet" href="/fonts/sarasa-mono-sc.css" />', '')
sub(
    layout,
    'href={href} crossOrigin="anonymous"',
    'href={`${ASSET}${href}`} crossOrigin="anonymous"',
)

# 3. page.tsx 引入 mock（client 组件的模块初始化早于任何 useEffect 里的 fetch）
page = build / 'app/page.tsx'
sub(
    page,
    "'use client'",
    "'use client'\n// 静态演示：把 /api 与 /local-api 接管成假数据（只在演示构建里存在）\nimport '@/lib/demo-mock'",
)

# 4. 删掉静态导出装不下的东西
for rel in ('app/local-api', 'public/mockups', 'public/review', 'public/fonts/sarasa-mono-sc', 'public/fonts/sarasa-mono-sc.css'):
    target = build / rel
    if target.exists():
        shutil.rmtree(target) if target.is_dir() else target.unlink()
        print(f'  removed {rel}')

# 5. 字体 CSS 里的绝对路径补前缀
css = build / 'public/fonts/noto-sans-sc.css'
if css.exists():
    text = css.read_text(encoding='utf-8')
    replaced = text.replace('url(/fonts/', f'url({base}/fonts/')
    if replaced == text:
        raise SystemExit('[apply_patches] noto-sans-sc.css 里没有 url(/fonts/ …)，检查字体脚本输出')
    css.write_text(replaced, encoding='utf-8')
    print('  patched public/fonts/noto-sans-sc.css')

print(f'[apply_patches] done: {build} (basePath={base})')
