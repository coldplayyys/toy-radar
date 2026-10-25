#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
公众号文章 → 正文图片（潮玩雷达数据同步的第一步）

用法：

    # 在线抓取
    python fetch_wechat_article.py "https://mp.weixin.qq.com/s/xxxx" --out ".scratch/wechat/article"

    # 页面已另存为本地 HTML（微信返回环境异常时的备用路径）
    python fetch_wechat_article.py --html "article.html" --out ".scratch/wechat/article"

    # 抓完顺手判断哪几张是数据表（调用本地 RapidOCR，不需要任何 Key）
    python fetch_wechat_article.py "https://mp.weixin.qq.com/s/xxxx" --out ".scratch/wechat/article" --ocr-scan

产出：

    <out>/img_01.png ...     正文图片（按文章顺序）
    <out>/manifest.json      标题、公众号、发布时间、每张图的尺寸与哈希
    <out>/ocr_scan.json      每张图是否像表格、命中了哪些表头词（--ocr-scan 时）

设计取舍：

- 只依赖标准库 + Pillow（尺寸），能跑在用户本机的最小环境里；
- 图片优先取 data-src（微信懒加载的真实地址），其次 src / data-original；
- 请求带 Referer，避免 mmbiz.qpic.cn 的防盗链返回空白图；
- 不改动任何公众号内容，只做本地读取与归档。
"""

from __future__ import annotations

import argparse
import hashlib
import html as html_lib
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

BASE = Path(__file__).resolve().parent
DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
REQUEST_HEADERS = {
    "User-Agent": DEFAULT_UA,
    "Referer": "https://mp.weixin.qq.com/",
    "Accept-Language": "zh-CN,zh;q=0.9",
}
IMAGE_SUFFIX = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
TABLE_HINTS = ["商品名", "已售", "销量", "单价", "店铺名", "店铺", "粉丝", "收藏", "排名"]


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", html_lib.unescape(value or "")).strip()


def fetch_html(url: str, timeout: int = 60) -> str:
    request = urllib.request.Request(url, headers=REQUEST_HEADERS)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read()
    for encoding in ("utf-8", "gb18030"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "ignore")


def extract_meta(page: str) -> dict:
    def first(patterns: list[str]) -> str:
        for pattern in patterns:
            found = re.search(pattern, page, re.S)
            if found:
                value = clean_text(found.group(1))
                if value:
                    return value
        return ""

    title = first([
        r'property="og:title"\s+content="([^"]*)"',
        r"<title[^>]*>(.*?)</title>",
    ])
    account = first([
        r'id="js_name"[^>]*>\s*(.*?)\s*<',
        r"nickname:\s*'([^']+)'",
    ])
    publish_time = first([
        r'id="publish_time"[^>]*>\s*(.*?)\s*<',
        r"create_time:\s*'([^']+)'",
        r"publish_time:\s*'([^']+)'",
    ])
    description = first([r'property="og:description"\s+content="([^"]*)"'])
    return {
        "title": title,
        "account": account,
        "publishTime": publish_time,
        "description": description,
    }


def content_scope(page: str) -> str:
    """截取正文区域，避免把页面头像、二维码、推荐位当成正文图片。"""
    start = page.find('id="js_content"')
    if start < 0:
        return page
    tail = page[start:]
    stop = re.search(r"<script\b", tail)
    return tail[: stop.start()] if stop else tail


def extract_image_urls(scope: str) -> list[str]:
    urls: list[str] = []
    for tag in re.findall(r"<img\b[^>]*>", scope, re.S | re.I):
        source = None
        for attribute in ("data-src", "data-original", "src"):
            match = re.search(rf'{attribute}="([^"]+)"', tag, re.I)
            if match:
                source = clean_text(match.group(1))
                break
        if not source:
            continue
        source = source.split("#")[0]
        if source.startswith("//"):
            source = "https:" + source
        if not source.startswith("http"):
            continue
        if source not in urls:
            urls.append(source)
    return urls


def download_image(url: str, destination: Path, retries: int = 3) -> dict:
    headers = dict(REQUEST_HEADERS)
    last_error = None
    for attempt in range(retries):
        try:
            request = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(request, timeout=60) as response:
                data = response.read()
                content_type = response.headers.get("Content-Type", "")
            if len(data) < 1024:
                raise ValueError(f"图片过小（{len(data)} bytes），可能是防盗链占位图")
            destination.write_bytes(data)
            width = height = 0
            try:
                from PIL import Image

                with Image.open(destination) as image:
                    width, height = image.size
            except Exception:
                pass
            return {
                "file": destination.name,
                "url": url,
                "bytes": len(data),
                "width": width,
                "height": height,
                "sha256": hashlib.sha256(data).hexdigest(),
                "contentType": content_type,
            }
        except Exception as error:  # 网络抖动时重试
            last_error = error
            time.sleep(1 + attempt)
    raise RuntimeError(f"下载失败：{url}（{last_error}）")


def ocr_scan(images: list[dict], out_dir: Path) -> list[dict]:
    try:
        from rapidocr_onnxruntime import RapidOCR
    except ImportError:
        print("未安装 rapidocr_onnxruntime，跳过 OCR 扫描", file=sys.stderr)
        return []
    engine = RapidOCR()
    results = []
    for image in images:
        path = out_dir / image["file"]
        try:
            boxes, _ = engine(str(path))
        except Exception as error:
            results.append({**image, "error": str(error)})
            continue
        texts = [str(item[1]) for item in (boxes or [])]
        joined = " ".join(texts)
        hints = [word for word in TABLE_HINTS if word in joined]
        results.append({
            "file": image["file"],
            "width": image["width"],
            "height": image["height"],
            "textBlocks": len(texts),
            "tableHints": hints,
            "looksLikeTable": len(hints) >= 2,
            "preview": clean_text(" ".join(texts))[:160],
        })
        print(
            f"[scan] {image['file']} {image['width']}×{image['height']} · "
            f"文本块 {len(texts)} · 表头命中 {','.join(hints) or '无'}",
            file=sys.stderr,
        )
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description="公众号文章 → 正文图片")
    parser.add_argument("url", nargs="?", help="公众号文章链接")
    parser.add_argument("--html", default="", help="本地保存的 HTML（与 url 二选一）")
    parser.add_argument("--out", required=True, help="输出目录")
    parser.add_argument("--ocr-scan", action="store_true", help="抓完后扫描哪些图是数据表")
    parser.add_argument("--min-width", type=int, default=200, help="过滤小于该宽度的占位图")
    args = parser.parse_args()

    if not args.url and not args.html:
        parser.print_help()
        return 1

    if args.html:
        page = Path(args.html).read_text(encoding="utf-8", errors="ignore")
        source_url = ""
    else:
        source_url = args.url
        print(f"正在抓取：{source_url}", file=sys.stderr)
        page = fetch_html(source_url)

    if "环境异常" in page[:20000]:
        print("微信返回了环境异常页；请用浏览器打开文章，另存为 HTML 后改用 --html", file=sys.stderr)
        return 3

    meta = extract_meta(page)
    scope = content_scope(page)
    urls = extract_image_urls(scope)
    if not urls:
        print("没有在正文里找到图片，页面结构可能变了", file=sys.stderr)
        return 3

    out_dir = Path(args.out)
    if not out_dir.is_absolute():
        out_dir = BASE / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    print(
        f"《{meta['title'] or '未命名'}》· {meta['account'] or '未知公众号'} · "
        f"{meta['publishTime'] or '未知时间'} · 正文图片 {len(urls)} 张",
        file=sys.stderr,
    )

    images = []
    skipped = []
    for index, url in enumerate(urls, start=1):
        suffix = Path(urllib.parse.urlparse(url).path).suffix.lower()
        if suffix not in IMAGE_SUFFIX:
            suffix = ".png"
        destination = out_dir / f"img_{index:02d}{suffix}"
        try:
            record = download_image(url, destination)
        except Exception as error:
            skipped.append({"url": url, "reason": str(error)})
            print(f"[skip] 第 {index} 张：{error}", file=sys.stderr)
            continue
        if record["width"] and record["width"] < args.min_width:
            skipped.append({"url": url, "reason": f"宽度 {record['width']} 小于阈值"})
            destination.unlink(missing_ok=True)
            continue
        images.append(record)
        print(
            f"[ok] {record['file']} · {record['width']}×{record['height']} · "
            f"{record['bytes'] // 1024}KB",
            file=sys.stderr,
        )

    manifest = {
        **meta,
        "sourceUrl": source_url,
        "fetchedAt": datetime.now().isoformat(timespec="seconds"),
        "imageCount": len(images),
        "images": images,
        "skipped": skipped,
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"已保存 {len(images)} 张图片 → {out_dir}", file=sys.stderr)

    if args.ocr_scan:
        scan = ocr_scan(images, out_dir)
        (out_dir / "ocr_scan.json").write_text(
            json.dumps(scan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        tables = [item for item in scan if item.get("looksLikeTable")]
        print(f"疑似数据表 {len(tables)} 张：{', '.join(item['file'] for item in tables) or '无'}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
