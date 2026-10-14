#!/bin/bash
# 改完前端代码后：build → 把产物拷进 standalone → 重启 web 服务。
# 服务单元：/etc/systemd/system/hermes-relay-web.service（127.0.0.1:3220，开机自启）。
# 本机联调（不想动服务）时可以直接开 3220 那份产物，见 README。
set -e
cd "$(dirname "$0")/.."

# 字体文件不进 git：新环境第一次构建前要先跑 fetch-fonts.sh（约 15 分钟）
if [ ! -f fonts/source-sans-3/source-sans-3-latin-400-normal.woff2 ] \
   || [ ! -f public/fonts/noto-sans-sc.css ] \
   || [ ! -f public/fonts/sarasa-mono-sc.css ]; then
  echo "缺字体，先跑 scripts/fetch-fonts.sh（约 15 分钟）…"
  bash scripts/fetch-fonts.sh
fi

npm run build >/tmp/hermes-relay-web-build.log 2>&1 || { tail -30 /tmp/hermes-relay-web-build.log; exit 1; }
rm -rf .next/standalone/.next/static .next/standalone/public
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
systemctl restart hermes-relay-web
sleep 2
curl -s -o /dev/null -w 'hermes-relay-web 3220: %{http_code}\n' http://127.0.0.1:3220/
systemctl is-active hermes-relay-web
