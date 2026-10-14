#!/usr/bin/env bash
# 生成自托管字体（字体文件不进 git，所以新环境 / 重装后跑这个脚本）。
#
#   1. Source Sans 3（拉丁，400/600）  → web/fonts/source-sans-3/
#   2. Noto Sans SC（思源黑体，400/600，按 unicode-range 切 101 片/字重）→ web/public/fonts/noto-sans-sc/
#   3. Sarasa Mono SC（等距更纱黑体，400/700，cn-font-split 切块）        → web/public/fonts/sarasa-mono-sc/
#   4. 两份分片 CSS：web/public/fonts/{noto-sans-sc,sarasa-mono-sc}.css
#   5. LICENSE 与出处清单
#
# 依赖：curl、tar、7z（apt install p7zip-full）、node/npx（cn-font-split 通过 npx 临时下载）。
# 耗时：15 分钟左右（两个 25MB 的 TTF 切块最慢）。
# 注意：跑完会打印「要同步到 app/layout.tsx 的 preload 文件名」，hash 变了就要改那里。
set -euo pipefail

WEB="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${FONT_WORK_DIR:-/tmp/fontwork}"
SARASA_VER=1.0.42
NOTO_PKG=@fontsource/noto-sans-sc@5.3.0
SS3_PKG=@fontsource/source-sans-3@5.3.0

mkdir -p "$WORK" "$WEB/fonts/source-sans-3" "$WEB/public/fonts/noto-sans-sc" "$WEB/public/fonts/sarasa-mono-sc"
cd "$WORK"

echo "== 1/4 拉丁：Source Sans 3（下载后重切子集：剔掉引号 / 省略号）=="
curl -sL -o ss3.tgz "$(npm view $SS3_PKG dist.tarball)"
mkdir -p x-ss3 && tar -xzf ss3.tgz -C x-ss3 --wildcards \
  'package/files/source-sans-3-latin-400-normal.woff2' \
  'package/files/source-sans-3-latin-600-normal.woff2' \
  'package/LICENSE'
# 子集化要 fonttools + brotli：优先用专门的 venv，没有就建一个
PYBIN="/tmp/fontwork/fontvenv/bin/python"
if [ ! -x "$PYBIN" ]; then
  "${PY:-python3}" -m venv /tmp/fontwork/fontvenv 2>/dev/null || true
fi
if [ -x "$PYBIN" ] && "$PYBIN" -c 'import fontTools, brotli' 2>/dev/null; then
  SUB="$PYBIN"
else
  echo "  需要一个带 fonttools+brotli 的 python，请先：python3 -m venv /tmp/fontwork/fontvenv && /tmp/fontwork/fontvenv/bin/pip install fonttools brotli" >&2
  exit 1
fi
"$SUB" "$WEB/scripts/subset-latin.py" x-ss3/package/files/source-sans-3-latin-400-normal.woff2 \
  "$WEB/fonts/source-sans-3/source-sans-3-latin-400-normal.woff2"
"$SUB" "$WEB/scripts/subset-latin.py" x-ss3/package/files/source-sans-3-latin-600-normal.woff2 \
  "$WEB/fonts/source-sans-3/source-sans-3-latin-600-normal.woff2"
cp x-ss3/package/LICENSE "$WEB/public/fonts/LICENSE-SourceSans3.txt"
ls -l "$WEB/fonts/source-sans-3"

echo "== 2/4 中文：Noto Sans SC =="
curl -sL -o noto.tgz "$(npm view $NOTO_PKG dist.tarball)"
rm -rf x-noto && mkdir -p x-noto
tar -xzf noto.tgz -C x-noto --wildcards 'package/files/*-400-normal.woff2' 'package/files/*-600-normal.woff2' \
  'package/400.css' 'package/600.css' 'package/LICENSE'
cp x-noto/package/files/*.woff2 "$WEB/public/fonts/noto-sans-sc/"
cp x-noto/package/LICENSE "$WEB/public/fonts/LICENSE-NotoSansSC.txt"
"${PY:-python3}" - "$WORK/x-noto/package" "$WEB/public/fonts/noto-sans-sc.css" <<'PY'
import re, sys, pathlib
src, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
rules = []
for w in ('400.css', '600.css'):
    for block in re.findall(r'@font-face\s*\{[^}]*\}', (src / w).read_text(encoding='utf-8')):
        block = re.sub(r",\s*url\(\./files/[^)]+\.woff\)\s*format\('woff'\)", '', block)  # 不分发 .woff
        rules.append(block.replace('url(./files/', 'url(/fonts/noto-sans-sc/').strip())
out.write_text('\n\n'.join(rules) + '\n', encoding='utf-8')
print(f'  {out.name}: {len(rules)} 条 @font-face')
PY

echo "== 3/4 等宽：Sarasa Mono SC（下载 63MB 的 7z，再切块，慢）=="
curl -sL -o sarasa.7z "https://github.com/be5invis/Sarasa-Gothic/releases/download/v$SARASA_VER/SarasaMonoSC-TTF-$SARASA_VER.7z"
7z e -y sarasa.7z SarasaMonoSC-Regular.ttf SarasaMonoSC-Bold.ttf -o. >/dev/null
for pair in "Regular:400" "Bold:700"; do
  ttf="${pair%%:*}"; weight="${pair##*:}"
  echo "  - SarasaMonoSC-$ttf.ttf → $weight"
  npm_config_yes=true npx -y cn-font-split@7.4.3 run -i "SarasaMonoSC-$ttf.ttf" -o "$WORK/out-$ttf" \
    -t woff2 --css.fontFamily "Sarasa Mono SC" --css.fontWeight "$weight" --css.fontDisplay swap
  cp "$WORK/out-$ttf"/*.woff2 "$WEB/public/fonts/sarasa-mono-sc/"
done
# 两份 CSS 合成一份；去掉 local()（保证用的就是我们发的这版），URL 指向 /fonts/sarasa-mono-sc/
"${PY:-python3}" - "$WORK" "$WEB/public/fonts/sarasa-mono-sc.css" <<'PY'
import re, sys, pathlib
work, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
rules = []
for d in ('out-Regular', 'out-Bold'):
    for r in re.findall(r'@font-face\{[^}]*\}', (work / d / 'result.css').read_text(encoding='utf-8')):
        r = r.replace('src:local("Sarasa Mono SC"),', 'src:')
        rules.append(r.replace('url("./', 'url("/fonts/sarasa-mono-sc/'))
out.write_text('/* 等距更纱黑体 SC %s（cn-font-split 切块）*/\n' % '1.0.42' + '\n'.join(rules) + '\n', encoding='utf-8')
print(f'  {out.name}: {len(rules)} 条 @font-face')
PY

echo "== 4/4 清理 + 提示 =="
rm -f "$WORK"/SarasaMonoSC-*.ttf
du -sh "$WEB/fonts" "$WEB/public/fonts"/* | sed 's/^/  /'
echo
echo "要同步到 app/layout.tsx 的 PRELOAD_FONTS（首屏必定用到的分片）："
"${PY:-python3}" - "$WEB/public/fonts" <<'PY'
import re, sys, pathlib, os
base = pathlib.Path(sys.argv[1])
common = [0x4E00, 0x662F, 0x4E0D, 0x4E86, 0x5728, 0x4EBA, 0x4E2D, 0x7684]
def ranges(rule):
    out = []
    for part in re.search(r'unicode-range:\s*([^;}]*)', rule).group(1).split(','):
        part = part.strip().replace('U+', '')
        if not part:
            continue
        a, b = (part.split('-') + [part])[:2] if '-' in part else (part, part)
        out.append((int(a, 16), int(b, 16)))
    return out
for css in ('noto-sans-sc.css',):
    for rule in re.findall(r'@font-face\s*\{[^}]*\}', (base / css).read_text(encoding='utf-8')):
        if not re.search(r'font-weight:\s*400', rule):
            continue
        rs = ranges(rule)
        if sum(1 for c in common if any(a <= c <= b for a, b in rs)) >= 3:
            fn = re.search(r'url\(([^)]+)\)', rule).group(1).split('/')[-1]
            print(f"  '/fonts/{css[:-4]}/{fn}',  # {os.path.getsize(base / css[:-4] / fn) // 1024}KB")
PY
