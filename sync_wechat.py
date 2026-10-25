#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
一条命令：公众号文章 → OCR 周数据 → 质量校验 →（可选）写入潮玩雷达

用法：

    # 先跑草稿，不动正式数据
    python sync_wechat.py "https://mp.weixin.qq.com/s/xxxx" --week 9.7-9.13 --date 2026.9.12

    # 复用上一次下载的图片，只重跑 OCR / 校验（不重复抓取）
    python sync_wechat.py --out ".scratch/wechat/week245" --week 9.7-9.13 --date 2026.9.12 --reuse

    # 人工核对通过后，写入数据目录并重新生成前端数据
    python sync_wechat.py --out ".scratch/wechat/week245" --week 9.7-9.13 --date 2026.9.12 --reuse --publish

退出码：0 正常；2 需要人工核对；3 抓取或解析失败。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import fetch_wechat_article as wechat
import generate_toy_radar_data as generator

BASE = Path(__file__).resolve().parent
DATA_DIR = BASE / "潮玩雷达数据"
WEEK_RE = re.compile(r"(\d{1,2})\.(\d{1,2})\s*-\s*(\d{1,2})\.(\d{1,2})")


def fetch_images(url: str, html: str, out_dir: Path, min_width: int) -> dict:
    if html:
        page = Path(html).read_text(encoding="utf-8", errors="ignore")
        source_url = ""
    else:
        print(f"[1/4] 抓取文章：{url}", file=sys.stderr)
        page = wechat.fetch_html(url)
        source_url = url

    if "环境异常" in page[:20000]:
        raise RuntimeError("微信返回环境异常页；请浏览器另存 HTML 后用 --html 重试")

    meta = wechat.extract_meta(page)
    urls = wechat.extract_image_urls(wechat.content_scope(page))
    if not urls:
        raise RuntimeError("正文没有找到图片，页面结构可能变了")

    out_dir.mkdir(parents=True, exist_ok=True)
    images, skipped = [], []
    for index, image_url in enumerate(urls, start=1):
        destination = out_dir / f"img_{index:02d}.png"
        try:
            record = wechat.download_image(image_url, destination)
        except Exception as error:
            skipped.append({"url": image_url, "reason": str(error)})
            continue
        if record["width"] and record["width"] < min_width:
            skipped.append({"url": image_url, "reason": f"宽度 {record['width']} 过小"})
            destination.unlink(missing_ok=True)
            continue
        images.append(record)

    manifest = {
        **meta,
        "sourceUrl": source_url,
        "imageCount": len(images),
        "images": images,
        "skipped": skipped,
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        f"      《{meta['title']}》{meta['publishTime']} · 图片 {len(images)} 张"
        f"（跳过 {len(skipped)} 张）",
        file=sys.stderr,
    )
    return manifest


def count_review_rows(md_path: Path) -> int:
    checklist = md_path.with_name(md_path.stem + "-待核对.md")
    if not checklist.exists():
        return 0
    total = 0
    for line in checklist.read_text(encoding="utf-8").splitlines():
        if line.startswith("|") and "---" not in line and "商品名" not in line:
            total += 1
    return total


def run_ocr(out_dir: Path, week: str, date: str) -> Path:
    print("[2/4] OCR 还原表格", file=sys.stderr)
    md_path = out_dir / f"潮玩品类数据{week}.md"
    command = [
        sys.executable,
        str(BASE / "ocr_toy_data.py"),
        str(out_dir),
        "--write",
        "--out",
        str(md_path),
        "--week",
        week,
        "--date",
        date,
    ]
    # Windows 控制台默认 GBK，子进程输出是 UTF-8；显式指定编码，避免 reader 线程崩掉
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    result = subprocess.run(
        command,
        cwd=BASE,
        text=True,
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        env=env,
    )
    if result.returncode != 0:
        raise RuntimeError(f"OCR 失败：{(result.stderr or result.stdout)[-500:]}")
    for line in result.stderr.splitlines():
        if line.startswith("[OCR]") or line.startswith("[核对]"):
            print("      " + line, file=sys.stderr)
    if not md_path.exists():
        raise RuntimeError("OCR 没有产出 md")
    return md_path


def validate(md_path: Path, week: str, date: str) -> dict:
    print("[3/4] 质量校验", file=sys.stderr)
    parsed = generator.parse_md(md_path)
    review_rows = count_review_rows(md_path)
    sections = {section["id"]: section["itemCount"] for section in parsed["sections"]}
    total_items = parsed["totalItems"]
    checks = {
        "有足够商品行": total_items >= 40,
        "覆盖至少 3 个品类": len(sections) >= 3,
        "统计日期一致": parsed["statDate"] == date,
        "待核对比例 <= 35%": total_items > 0 and review_rows / total_items <= 0.35,
    }
    summary = {
        "week": week,
        "statDate": parsed["statDate"],
        "totalItems": total_items,
        "totalSold": parsed["totalSold"],
        "avgPrice": parsed["avgPrice"],
        "sections": sections,
        "reviewRows": review_rows,
        "checks": checks,
        "passed": all(checks.values()),
    }
    for name, ok in checks.items():
        print(f"      {'✓' if ok else '✗'} {name}", file=sys.stderr)
    print(
        f"      商品 {total_items} 行 · 销量 {parsed['totalSold']:,} · "
        f"品类 {sections} · 待核对 {review_rows} 行",
        file=sys.stderr,
    )
    return summary


def find_existing_week(week: str) -> list[Path]:
    existing = []
    for path in DATA_DIR.rglob("潮玩品类数据*.md"):
        if WEEK_RE.search(path.stem) and week in path.stem:
            existing.append(path)
    return existing


def publish(md_path: Path, date: str, week: str, force: bool) -> Path:
    print("[4/4] 写入潮玩雷达数据", file=sys.stderr)
    existing = find_existing_week(week)
    if existing and not force:
        raise RuntimeError(
            "该周已有数据文件，避免重复入库："
            + "、".join(str(path.relative_to(BASE)) for path in existing)
            + "（确认要覆盖时加 --force）"
        )
    target_dir = DATA_DIR / date
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"潮玩品类数据{week}.md"
    shutil.copyfile(md_path, target)
    shutil.copyfile(
        md_path.with_name(md_path.stem + "-待核对.md"),
        target_dir / "ocr_待核对.md",
    )
    subprocess.run(
        [sys.executable, str(BASE / "generate_toy_radar_data.py")],
        cwd=BASE,
        check=True,
        env={**os.environ, "PYTHONIOENCODING": "utf-8"},
    )
    print(f"      已写入 {target.relative_to(BASE)} 并重新生成 toy-radar-data.js", file=sys.stderr)
    return target


def main() -> int:
    parser = argparse.ArgumentParser(description="公众号文章 → OCR → 潮玩雷达")
    parser.add_argument("url", nargs="?", help="公众号文章链接")
    parser.add_argument("--html", default="", help="本地保存的 HTML")
    parser.add_argument("--out", required=True, help="图片与草稿目录")
    parser.add_argument("--week", required=True, help="周区间，例如 9.7-9.13")
    parser.add_argument("--date", required=True, help="统计日期，例如 2026.9.12")
    parser.add_argument("--reuse", action="store_true", help="复用目录里已下载的图片")
    parser.add_argument("--publish", action="store_true", help="写入正式数据目录并重新生成")
    parser.add_argument("--force", action="store_true", help="该周已存在时允许覆盖")
    parser.add_argument("--min-width", type=int, default=200)
    args = parser.parse_args()

    out_dir = Path(args.out)
    if not out_dir.is_absolute():
        out_dir = BASE / out_dir

    try:
        if args.reuse and (out_dir / "manifest.json").exists():
            manifest = json.loads((out_dir / "manifest.json").read_text(encoding="utf-8"))
            print(f"[1/4] 复用已有图片：{len(manifest.get('images', []))} 张", file=sys.stderr)
        else:
            if not args.url and not args.html:
                raise RuntimeError("首次运行需要提供文章链接或 --html")
            manifest = fetch_images(args.url, args.html, out_dir, args.min_width)

        md_path = run_ocr(out_dir, args.week, args.date)
        summary = validate(md_path, args.week, args.date)
        (out_dir / "sync_summary.json").write_text(
            json.dumps({**summary, "manifest": manifest}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

        if args.publish:
            if not summary["passed"] and not args.force:
                raise RuntimeError("质量校验未通过，拒绝发布（确认无误可加 --force）")
            publish(md_path, args.date, args.week, args.force)

        print(
            f"\n完成：{md_path}\n"
            f"待核对清单：{md_path.with_name(md_path.stem + '-待核对.md')}\n"
            + ("下一步：人工核对后重新运行并加 --publish" if not args.publish else "已发布，提交并推送即可上线"),
            file=sys.stderr,
        )
        return 0 if summary["passed"] else 2
    except Exception as error:
        print(f"失败：{error}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
