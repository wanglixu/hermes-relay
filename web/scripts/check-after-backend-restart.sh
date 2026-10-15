#!/bin/bash
# 后端（hermes-relay）重启之后，确认前端服务没被带走。结果追加到 /tmp/hermes-relay-web-restart-check.txt。
{
  echo "== $(date '+%F %T %Z') =="
  echo "web: $(systemctl is-active hermes-relay-web) (启动于 $(systemctl show -p ActiveEnterTimestamp --value web))"
  echo "hermes-relay: $(systemctl is-active hermes-relay) (启动于 $(systemctl show -p ActiveEnterTimestamp --value hermes-relay))"
  echo "port 3220: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3220/)"
  echo "relay https: $(curl -s -o /dev/null -w '%{http_code}' "${RELAY_BASE:-http://127.0.0.1:3220}/")"
} >> /tmp/hermes-relay-web-restart-check.txt 2>&1
