#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
潮玩雷达 · 本地服务 + 大模型代理

用法：
    python kb_server.py            # 默认 8000 端口
    python kb_server.py 8123       # 换端口

它干两件事：

1. **静态服务**：把当前文件夹当网站根目录，等价于 `python -m http.server`，
   只是多了下面这个代理接口。
2. **代理接口**：`POST /api/llm/chat/completions` 与 `POST /api/llm/embeddings`，
   把请求体里的 `base` 当地址、`key` 当密钥，转发到上游大模型服务。
   很多国内模型服务不给浏览器发 CORS 头，直连会被拦；走本地代理就没这个问题，
   Key 也只在本机内存里过一手，不写进任何文件。

安全约束：只允许转发到 https 的公网地址，禁止内网 / 本机地址，
免得这个本地服务被页面当成访问内网的跳板。
"""

from __future__ import annotations

import ipaddress
import json
import socket
import sys
import urllib.error
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

BASE_DIR = Path(__file__).resolve().parent
ALLOWED_PATHS = {"/api/llm/chat/completions", "/api/llm/embeddings"}
MAX_BODY = 32 * 1024 * 1024  # 单次请求体上限，主要是防止误传超长资料
UPSTREAM_TIMEOUT = 300


def is_public_https(url: str) -> tuple[bool, str]:
    """只放行 https 的公网地址。"""
    parsed = urlparse(url)
    if parsed.scheme != "https":
        return False, "只支持 https 接口地址"
    host = parsed.hostname or ""
    if not host:
        return False, "缺少主机名"
    if host in {"localhost", "127.0.0.1", "::1"} or host.endswith(".local"):
        return False, "不允许转发到本机地址"
    try:
        infos = socket.getaddrinfo(host, parsed.port or 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        return False, f"域名解析失败：{host}"
    for info in infos:
        address = info[4][0]
        try:
            ip = ipaddress.ip_address(address)
        except ValueError:
            continue
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            return False, "不允许转发到内网地址"
    return True, ""


class Handler(SimpleHTTPRequestHandler):
    server_version = "ToyRadarKB/1.0"

    # 老版本 Python 的 mimetypes 不认识 .mjs，会导致浏览器 import() 失败，这里显式补上
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".mjs": "text/javascript",
        ".js": "text/javascript",
        ".json": "application/json",
        ".pdf": "application/pdf",
        ".md": "text/markdown; charset=utf-8",
        ".txt": "text/plain; charset=utf-8",
    }

    def log_message(self, fmt: str, *args) -> None:  # 静音静态请求，只留代理日志
        if self.path.startswith("/api/llm"):
            sys.stderr.write("[proxy] %s\n" % (fmt % args))

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path not in ALLOWED_PATHS:
            self.send_error(404, "unknown api path")
            return

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            self.send_error(413, "body missing or too large")
            return

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_error(400, "invalid json")
            return

        base = str(payload.get("base") or "").rstrip("/")
        key = str(payload.get("key") or "")
        upstream_url = base + path.replace("/api/llm", "")
        ok, reason = is_public_https(upstream_url)
        if not ok:
            self.respond_json(400, {"error": {"message": reason}})
            return

        body = {k: v for k, v in payload.items() if k not in {"base", "key"}}
        request = urllib.request.Request(
            upstream_url,
            data=json.dumps(body).encode("utf-8"),
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Accept": "text/event-stream, application/json",
                "Authorization": f"Bearer {key}",
            },
        )

        try:
            with urllib.request.urlopen(request, timeout=UPSTREAM_TIMEOUT) as upstream:
                self.send_response(upstream.status)
                self.send_header(
                    "Content-Type", upstream.headers.get("Content-Type", "application/json")
                )
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                while True:
                    chunk = upstream.read(2048)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", "replace")
            self.respond_json(error.code, {"error": {"message": detail[:800]}})
        except urllib.error.URLError as error:
            self.respond_json(502, {"error": {"message": f"上游连接失败：{error.reason}"}})
        except (BrokenPipeError, ConnectionResetError):
            pass  # 浏览器提前断开，正常情况

    def respond_json(self, status: int, payload: dict) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)


def main() -> int:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = partial(Handler, directory=str(BASE_DIR))
    with ThreadingHTTPServer(("0.0.0.0", port), handler) as server:
        print(f"潮玩雷达已启动：http://localhost:{port}/")
        print(f"静态目录：{BASE_DIR}")
        print("大模型代理：/api/llm/chat/completions · /api/llm/embeddings（仅 https 公网地址）")
        print("按 Ctrl+C 停止服务。")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\n已停止。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
