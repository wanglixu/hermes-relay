#!/usr/bin/env python3
"""本机自测反代：把 3220（Next）和 8788（Python 后端）摆到同一个源上。

为什么需要它：直接开 3220 时 /api 只能由 Next 的 rewrites 转发，那条路会把 SSE 攒住，
自测时看着像"一下子全蹦出来"。生产是 nginx 的 /api/ 直连 8788，不经 Next。

用法：python3 scripts/local-proxy.py [监听端口，默认 3221]
  /api/*  → 127.0.0.1:8788
  其余    → 127.0.0.1:3220
纯标准库，逐块透传，只为自测，不要拿它当生产入口。
"""

import http.client
import http.server
import sys

BACKEND = ('127.0.0.1', 8788)
FRONT = ('127.0.0.1', 3220)
HOP_BY_HOP = {'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
              'te', 'trailers', 'transfer-encoding', 'upgrade', 'host', 'content-length'}


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'relay-local-proxy'

    def log_message(self, fmt, *args):  # 安静点
        pass

    def _target(self):
        return BACKEND if self.path.startswith('/api/') else FRONT

    def _proxy(self):
        host, port = self._target()
        length = self.headers.get('Content-Length')
        body = self.rfile.read(int(length)) if length else None
        headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP_BY_HOP}
        headers['Connection'] = 'close'
        conn = http.client.HTTPConnection(host, port, timeout=3600)
        try:
            conn.request(self.command, self.path, body=body, headers=headers)
            resp = conn.getresponse()
            self.send_response(resp.status)
            for k, v in resp.getheaders():
                if k.lower() in HOP_BY_HOP:
                    continue
                self.send_header(k, v)
            self.send_header('Connection', 'close')
            self.end_headers()
            while True:
                # 必须用 read1：read(n) 会一直等到凑够 n 字节，SSE 尾部那些小事件
                # （比如只有几百字节的 clarify / approval）就会被攒住，前端一直看不到。
                chunk = resp.read1(4096)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            conn.close()

    do_GET = do_POST = do_PATCH = do_DELETE = do_PUT = do_HEAD = do_OPTIONS = _proxy


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3221
    print(f'local proxy: http://127.0.0.1:{port}/  (/api -> 8788, 其余 -> 3220)', flush=True)
    Server(('127.0.0.1', port), Handler).serve_forever()
