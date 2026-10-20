#!/usr/bin/env bash
# 生成 GitHub Pages 静态演示站：把 web/ 原样导出，只把数据源换成 lib/demo-mock.ts。
# 渲染逻辑（组件、样式、折叠动画、Markdown、设置弹层、工作台四视图）全部是线上那份代码。
#
#   bash demo/build-demo.sh
#
# 产物直接写进 docs/，Pages 用 main 分支的 /docs 目录。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/web"
BUILD="${DEMO_BUILD_DIR:-/tmp/hermes-relay-demo-build}"
BASE="${DEMO_BASE_PATH:-/hermes-relay}"
OUT="$ROOT/docs"

if [ ! -d "$SRC/node_modules" ]; then
  echo "缺依赖：先执行  cd web && npm ci" >&2
  exit 1
fi
if [ ! -d "$SRC/public/fonts/noto-sans-sc" ]; then
  echo "缺字体：先执行  bash web/scripts/fetch-fonts.sh（约 15 分钟）" >&2
  exit 1
fi

echo "== 1/4 复制前端源码 → $BUILD"
rm -rf "$BUILD"
mkdir -p "$BUILD"
rsync -a --exclude node_modules --exclude .next --exclude verify-shots "$SRC/" "$BUILD/"
# Turbopack 不接受 node_modules 软链，所以用硬链接复制（同盘几乎不占空间）
cp -al "$SRC/node_modules" "$BUILD/node_modules" 2>/dev/null || cp -a "$SRC/node_modules" "$BUILD/node_modules"

echo "== 2/4 打补丁（basePath / mock 入口）"
cp "$ROOT/demo/demo-mock.ts" "$BUILD/lib/demo-mock.ts"
DEMO_BASE_PATH="$BASE" python3 "$ROOT/demo/apply_patches.py" "$BUILD" "$BASE"

echo "== 3/4 next build（静态导出）"
cd "$BUILD"
DEMO_BASE_PATH="$BASE" npx next build

echo "== 4/4 产物写进 docs/"
mkdir -p "$OUT"
rm -rf "$OUT/_next" "$OUT/fonts" "$OUT/demo" "$OUT/index.html" "$OUT/404.html" \
       "$OUT/_not-found" "$OUT/__next.__PAGE__.txt" "$OUT/__next._full.txt" "$OUT/__next._tree.txt"
cp -a "$BUILD/out/." "$OUT/"
touch "$OUT/.nojekyll"

echo "完成：$OUT  （$(du -sh "$OUT" | cut -f1)）"
echo "本机预览： mkdir -p /tmp/pages && ln -sfn '$OUT' /tmp/pages${BASE} && python3 -m http.server 8901 --directory /tmp/pages"
echo "线上地址： https://wanglixu.github.io${BASE}/"
