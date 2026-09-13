#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
潮玩雷达 · 榜单截图 → 周数据 md（全程本地，不需要任何 API Key）

把「潮玩雷达数据/<周文件夹>/」里的榜单截图（png / jpg）识别成
`generate_toy_radar_data.py` 能直接解析的六列 Markdown 表格：

    | 品类名 | 商品名 | 已售/销量 | 单价/¥ | 店铺名 | 统计日期 |

用法：

    # 1. 先看识别原文，确认表和列都对得上（不动任何文件）
    python ocr_toy_data.py "潮玩雷达数据/8.15数据" --date 2026.8.15 --dry-run

    # 2. 生成周数据 md，覆盖到该周文件夹
    python ocr_toy_data.py "潮玩雷达数据/8.15数据" --date 2026.8.15 --write

    # 3. 和人工整理的旧 md 对比，看识别召回率
    python ocr_toy_data.py "潮玩雷达数据/8.15数据" --compare "潮玩雷达数据/8.15数据/潮玩品类数据8.9-8.15.md"

设计要点：

- 行聚类：按文本框纵向中心把碎片文字聚成行；
- 列切分：拿表头文字的位置推导列边界，数据格按横向中心归列；
- 词表纠错：`ocr_corrections.json` 里维护「错→对」，专治形近字噪声（糖胶→搪胶 之类）；
- 品类归属：先看截图标题关键词，再看整表词频，兜底按 `--category` 指定；
- 只做结构与纠错，不做任何编造：识别不到的数字一律留 `-`，交给下一步人工核对。
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
from dataclasses import dataclass, field
from pathlib import Path

BASE = Path(__file__).resolve().parent
DATA_DIR = BASE / "潮玩雷达数据"
CORRECTIONS_FILE = BASE / "ocr_corrections.json"
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}

# 表头关键词 → 字段。顺序即优先级，命中即停。
HEADER_KEYS: list[tuple[str, list[str]]] = [
    ("rank", ["排名", "序号", "排序"]),
    ("name", ["商品名", "商品", "产品名", "宝贝", "款式"]),
    ("shop", ["店铺名", "店名", "店铺", "商家", "品牌名"]),
    ("sold", ["已售", "销量", "销售量", "售出", "月销", "成交"]),
    ("price", ["单价", "价格", "售价", "均价", "价"]),
    ("fans", ["粉丝量", "粉丝"]),
    ("collect", ["收藏"]),
]

NUMERIC_FIELDS = {"sold", "price", "fans", "collect"}
NUMERIC_RE = re.compile(r"^[\d\s.,+万亿kK%¥￥元起/\-]+$")
# 截图里“已售”和“单价”挨得太近时会被 OCR 粘成一格：500+ 329 / 8000+/69
MERGED_NUMBER_RE = re.compile(r"^\s*(\d[\d.,]*\s*[万亿]?\+?)\s*[/\s,，]+\s*(\d.*)$")
DATE_RE = re.compile(r"(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})")

# 品类识别：命中词越多越像，标题优先于全表词频。
CATEGORY_RULES: list[tuple[str, list[str]]] = [
    ("盲盒", ["盲盒", "萌粒", "端盒", "搪胶", "毛绒盲盒"]),
    ("可动手办", ["可动手办", "手办", "高达", "机甲", "模型", "拼装", "BJD"]),
    ("收藏卡牌", ["卡牌", "卡片", "球星卡", "收藏卡", "tcg"]),
    ("AI玩具", ["ai玩具", "智能玩具", "陪伴机器人", "ai陪伴", "机器人"]),
]

TITLE_NOISE = ["统计", "数据来源", "查看更多", "榜单说明", "更新时间"]
# 数字列 OCR 置信度低于这个值时，即使解析得出来也拉进待核对清单
LOW_SCORE_THRESHOLD = 0.55
# 数字列里出现这些字符，说明水印或形近字粘进来了：字母，以及“万/起/元”之外的汉字
SUSPECT_RE = re.compile(r"[A-Za-z\u4e00-\u9fff]")
ALLOWED_CJK = set("万亿起元折")


@dataclass
class Cell:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    score: float = 1.0

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2

    @property
    def height(self) -> float:
        return max(self.y1 - self.y0, 1.0)


@dataclass
class Table:
    image: str
    title: str
    category: str
    channel: str
    stat_date: str
    rows: list[list[str]]
    kind: str  # "goods" 商品榜 / "shop" 店铺榜 / "unknown"
    flags: list[tuple[str, str]] = field(default_factory=list)

    @property
    def slug_ok(self) -> bool:
        return self.kind == "goods" and bool(self.rows)


# ---------------------------------------------------------------- 识别与纠错


def load_corrections() -> list[tuple[str, str]]:
    """读纠错词表；文件不存在时创建一份带示例的模板。"""
    if not CORRECTIONS_FILE.exists():
        sample = {
            "_说明": "OCR 形近字纠错表，按顺序把 错 → 对 替换。左边写错字，右边写正确写法。",
            "糖胶": "搪胶",
            "慰堆堆": "怼堆堆",
            "宝可梦小小奇遇最初的伙伴盲盒 ": "宝可梦小小奇遇最初的伙伴盲盒",
        }
        CORRECTIONS_FILE.write_text(
            json.dumps(sample, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    raw = json.loads(CORRECTIONS_FILE.read_text(encoding="utf-8"))
    return [(k, v) for k, v in raw.items() if not k.startswith("_") and k != v]


def apply_corrections(text: str, rules: list[tuple[str, str]]) -> str:
    for wrong, right in rules:
        if wrong in text:
            text = text.replace(wrong, right)
    return text


def clean(text: str) -> str:
    text = text.replace("\xa0", " ").replace("\u200b", "")
    text = re.sub(r"\s+", " ", text)
    return text.strip(" |·•")


def is_numericish(text: str) -> bool:
    return bool(text) and any(ch.isdigit() for ch in text) and bool(NUMERIC_RE.match(text))


def looks_suspicious(text: str) -> bool:
    """数字格里混进字母或“万/起/元”之外的汉字，就认为需要人工确认。"""
    return any(ch not in ALLOWED_CJK for ch in SUSPECT_RE.findall(text))


def build_engine():
    try:
        from rapidocr_onnxruntime import RapidOCR
    except ImportError:  # pragma: no cover
        sys.exit("缺少依赖 rapidocr_onnxruntime，请先执行：pip install rapidocr_onnxruntime")
    return RapidOCR()


def ocr_image(engine, path: Path, rules: list[tuple[str, str]]) -> list[Cell]:
    result, _ = engine(str(path))
    cells: list[Cell] = []
    for box, text, score in result or []:
        xs = [point[0] for point in box]
        ys = [point[1] for point in box]
        value = apply_corrections(clean(text), rules)
        if not value:
            continue
        cells.append(Cell(value, min(xs), min(ys), max(xs), max(ys), float(score)))
    return cells


def load_dump(path: Path, corrections: list[tuple[str, str]]) -> list[Cell]:
    """读回 --dump 导出的识别原文，免去重复跑模型。"""
    cells: list[Cell] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        x0, y0, x1, y1 = (float(v) for v in parts[0].split(","))
        text = apply_corrections(clean(parts[2]), corrections)
        if text:
            cells.append(Cell(text, x0, y0, x1, y1, float(parts[1])))
    return cells


# ---------------------------------------------------------------- 版面还原


def cluster_rows(cells: list[Cell], tol_ratio: float = 0.6) -> list[list[Cell]]:
    """按纵向中心把文字块聚成行。"""
    rows: list[list[Cell]] = []
    for cell in sorted(cells, key=lambda c: c.cy):
        for row in rows:
            ref_cy = statistics.mean(c.cy for c in row)
            ref_h = statistics.mean(c.height for c in row)
            if abs(cell.cy - ref_cy) <= tol_ratio * max(cell.height, ref_h):
                row.append(cell)
                break
        else:
            rows.append([cell])
    for row in rows:
        row.sort(key=lambda c: c.x0)
    return rows


def match_header(row: list[Cell]) -> dict[str, int]:
    """判断这一行是不是表头，返回 字段 → 文本块下标。

    同一格里塞了两个表头（如“单价/￥店铺名”）时，两个字段都会落到这格上，
    后面按“数字归数值列、文字归文字列”拆分。
    """
    matched: dict[str, int] = {}
    for index, cell in enumerate(row):
        low = cell.text.lower()
        for field, words in HEADER_KEYS:
            if field in matched:
                continue
            if any(word.lower() in low for word in words):
                matched[field] = index
    return matched


def find_header(rows: list[list[Cell]]) -> tuple[int, dict[str, int]] | tuple[None, None]:
    for index, row in enumerate(rows):
        matched = match_header(row)
        has_goods = "name" in matched and ("sold" in matched or "price" in matched)
        has_shop = "shop" in matched and ("fans" in matched or "collect" in matched)
        if has_goods or has_shop:
            return index, matched
    return None, None


def column_edges(header: list[Cell]) -> list[float]:
    """由表头文字的实际横向范围推导列边界，顺带把左侧排名号挡在表外。"""
    pad = 0.6 * statistics.median(cell.height for cell in header)
    edges = [header[0].x0 - pad]
    for left, right in zip(header, header[1:]):
        if right.x0 > left.x1:  # 表头之间有缝：取缝中线，商品名不会串列
            edges.append((left.x1 + right.x0) / 2)
        else:  # 表头贴在一起：退化为中心点中线
            edges.append((left.cx + right.cx) / 2)
    edges.append(header[-1].x1 + pad)
    return edges


def assign_columns(row: list[Cell], edges: list[float]) -> list[list[Cell]]:
    buckets: list[list[Cell]] = [[] for _ in range(len(edges) - 1)]
    for cell in row:
        for index in range(len(edges) - 1):
            if edges[index] <= cell.cx < edges[index + 1]:
                buckets[index].append(cell)
                break
    return buckets


def join_cells(cells: list[Cell], spaced: bool = False) -> str:
    if not cells:
        return ""
    ordered = sorted(cells, key=lambda c: c.x0)
    parts = [c.text for c in ordered]
    return (" " if spaced else "").join(parts).strip()


def resolve_bucket(cells: list[Cell], fields: list[str]) -> dict[str, str]:
    """把一个列桶里的文本块分给该列对应的字段。"""
    if not fields:
        return {}
    if len(fields) == 1:
        field = fields[0]
        text = join_cells(cells, spaced=(field == "name"))
        if field in NUMERIC_FIELDS:
            parts = split_merged_numbers(text)
            if parts:
                return {field: parts[0]}
        return {field: text}
    ordered = expand_cells(cells)
    numbers = [c for c in ordered if is_numericish(c.text)]
    texts = [c for c in ordered if not is_numericish(c.text)]
    values: dict[str, str] = {}
    for field in fields:
        if field in NUMERIC_FIELDS:
            values[field] = numbers.pop(0).text if numbers else ""
        else:
            values[field] = join_cells(texts, spaced=(field == "name"))
    return values


def split_merged_numbers(text: str) -> list[str]:
    """把“500+ 329”这类粘连文本拆回两个数。"""
    found = MERGED_NUMBER_RE.match(text)
    if not found:
        return [text]
    return [found.group(1).strip(), found.group(2).strip()]


def expand_cells(cells: list[Cell]) -> list[Cell]:
    """按阅读顺序展开文本块，顺带把粘连的两个数字拆成两块。"""
    expanded: list[Cell] = []
    for cell in sorted(cells, key=lambda c: c.x0):
        parts = split_merged_numbers(cell.text)
        if len(parts) == 1:
            expanded.append(cell)
            continue
        width = (cell.x1 - cell.x0) / 2
        for index, part in enumerate(parts):
            expanded.append(
                Cell(
                    text=part,
                    x0=cell.x0 + index * width,
                    y0=cell.y0,
                    x1=cell.x0 + (index + 1) * width,
                    y1=cell.y1,
                    score=cell.score,
                )
            )
    return expanded


def parse_table(cells: list[Cell], image: str) -> Table | None:
    rows = cluster_rows(cells)
    if not rows:
        return None
    header_index, matched = find_header(rows)
    if header_index is None:
        return None
    header = rows[header_index]
    edges = column_edges(header)

    # 字段 → 列桶，同一桶可能承载多个字段（截图里表头被挤在一格）
    bucket_fields: dict[int, list[str]] = {}
    header_buckets = assign_columns(header, edges)
    for field, index in matched.items():
        for bucket_index, cells in enumerate(header_buckets):
            if header[index] in cells:
                bucket_fields.setdefault(bucket_index, []).append(field)
                break

    name_col = next((b for b, fs in bucket_fields.items() if "name" in fs), None)
    sold_col = next((b for b, fs in bucket_fields.items() if "sold" in fs), None)
    price_col = next((b for b, fs in bucket_fields.items() if "price" in fs), None)
    shop_col = next((b for b, fs in bucket_fields.items() if "shop" in fs), None)

    kind = "goods" if (name_col is not None and (sold_col is not None or price_col is not None)) else "shop"
    title = detect_title(rows[:header_index])
    category = detect_category(title, [c.text for row in rows for c in row])
    channel = detect_channel([c.text for row in rows[: header_index + 1] for c in row])
    stat_date = detect_date(rows[: header_index + 1])

    parsed: list[list[str]] = []
    flags: list[tuple[str, str]] = []
    for row in rows[header_index + 1 :]:
        if any(noise in c.text for c in row for noise in TITLE_NOISE):
            continue
        buckets = assign_columns(row, edges)
        numeric_cells = []
        for column in (sold_col, price_col):
            if column is not None:
                numeric_cells.extend(buckets[column])
        low_score = min((c.score for c in numeric_cells), default=1.0)
        values: dict[str, str] = {}
        for bucket_index, fields in bucket_fields.items():
            values.update(resolve_bucket(buckets[bucket_index], fields))
        name = values.get("name", "")
        shop = values.get("shop", "")
        sold = values.get("sold", "")
        price = values.get("price", "")
        if sold and not price:
            # 已售和单价被 OCR 粘在同一格里，这里补拆一次
            parts = split_merged_numbers(sold)
            if len(parts) > 1:
                sold, price = parts[0], parts[1]

        if kind == "goods":
            if not name and not sold and not price:
                continue
            if not name and parsed:
                # 商品名换行：并回上一行
                parsed[-1][1] = (parsed[-1][1] + join_cells(row)).strip()
                continue
            parsed.append([category, name, sold or "-", price or "-", shop, stat_date])
            if any(looks_suspicious(value) for value in (sold, price) if value):
                flags.append((name, f"数字里混进了噪声（已售={sold or '-'} 单价={price or '-'}），对照截图确认"))
            elif low_score < LOW_SCORE_THRESHOLD and any(value for value in (sold, price)):
                flags.append((name, f"数字识别置信度偏低（{low_score:.2f}），建议扫一眼"))
        else:
            if not name and not shop:
                continue
            # 店铺榜只有店铺名/粉丝/收藏，没有商品与价格，按既有约定留占位符
            parsed.append([category, "-", "-", "-", shop or name, stat_date])

    if not parsed:
        return None
    return Table(
        image=image,
        title=title,
        category=category,
        channel=channel,
        stat_date=stat_date,
        rows=parsed,
        kind=kind,
        flags=flags,
    )


def detect_title(header_rows: list[list[Cell]]) -> str:
    """表头上方的文字通常就是榜单名。"""
    texts = []
    for row in header_rows:
        for cell in row:
            value = DATE_RE.sub("", clean(cell.text))
            for noise in TITLE_NOISE:
                value = value.replace(noise, "")
            value = clean(value)
            if value:
                texts.append(value)
    # 标题区常混进水印的零星字，留下成句的那几条
    solid = [t for t in texts if len(t) >= 3]
    texts = solid or texts
    if not texts:
        return ""
    joined = " ".join(texts)
    return joined[:80].strip(" ：:，,、")


def detect_date(header_rows: list[list[Cell]]) -> str:
    """截图右上角通常写着“2026.8.15 统计”，直接从表头区抠出来。"""
    for row in header_rows:
        for cell in row:
            found = DATE_RE.search(cell.text)
            if found:
                return f"{found.group(1)}.{int(found.group(2))}.{int(found.group(3))}"
    return ""


def detect_category(title: str, all_texts: list[str]) -> str:
    def score(text: str, words: list[str]) -> int:
        low = text.lower()
        return sum(low.count(word.lower()) for word in words)

    best, best_score = "", 0
    for label, words in CATEGORY_RULES:
        value = score(title, words) * 3 + score(" ".join(all_texts[:200]), words)
        if value > best_score:
            best, best_score = label, value
    return best


def detect_channel(texts: list[str]) -> str:
    joined = " ".join(texts)
    return " / ".join(ch for ch in ["天猫", "抖音", "京东", "淘宝", "拼多多"] if ch in joined) or "综合"


# ---------------------------------------------------------------- 输出


def table_to_md(table: Table, index: int, stat_date: str) -> str:
    prefix = table.category or ("店铺榜" if table.kind == "shop" else "未分类")
    label = f"表{index}：{prefix}{table.title or '榜单'}"
    date = table.stat_date or stat_date
    head = f"（{table.channel} {date}）" if date else f"（{table.channel}）"
    lines = [
        f"### {label}{head}",
        "",
        "| 品类名 | 商品名 | 已售/销量 | 单价/¥ | 店铺名 | 统计日期 |",
        "| :--- | :--- | :--- | :--- | :--- | :--- |",
    ]
    for row in table.rows:
        cells = [cell or "-" for cell in row]
        cells[5] = cells[5] if cells[5] != "-" else (date or "-")
        cells = [cell.replace("|", "/") for cell in cells]
        lines.append("| " + " | ".join(cells) + " |")
    lines.append("")
    return "\n".join(lines)


def read_reference_names(path: Path) -> set[str]:
    names: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.startswith("|"):
            continue
        cells = [clean(c) for c in line.strip("|").split("|")]
        if len(cells) != 6 or set(cells[0]) <= {"-", ":"} or cells[0] in {"品类名"}:
            continue
        if cells[1] and cells[1] != "-":
            names.add(re.sub(r"\s+", "", cells[1]))
    return names


def parse_number(value: str) -> float | None:
    """和 generate_toy_radar_data.py 保持一致的数值解析，用来预判哪些行会被丢弃。"""
    raw = value.strip().replace(",", "").replace("起", "").replace("+", "")
    if not raw or raw == "-":
        return None
    multiplier = 1
    if "万" in raw:
        multiplier, raw = 10000, raw.replace("万", "")
    try:
        return float(raw) * multiplier
    except ValueError:
        return None


def similarity(left: str, right: str) -> float:
    from difflib import SequenceMatcher

    return SequenceMatcher(None, left, right).ratio()


def similar(left: str, right: str, threshold: float = 0.75) -> bool:
    return similarity(left, right) >= threshold


def reviewable_rows(tables: list[Table]) -> list[tuple[str, str, str, str]]:
    """挑出生成器会因为数字解析不了而丢掉的商品行，让人只核对这些。"""
    pending: list[tuple[str, str, str, str]] = []
    for table in tables:
        if table.kind != "goods":
            continue
        flagged = dict(table.flags)
        for name, problem in table.flags:
            pending.append((table.image, name, problem, table.category))
        for row in table.rows:
            _, name, sold, price, _, _ = row
            if not name or name == "-":
                continue
            bad = []
            if parse_number(sold) is None:
                bad.append(f"已售={sold}")
            if parse_number(price) is None:
                bad.append(f"单价={price}")
            if bad and name not in flagged:
                pending.append((table.image, name, " ".join(bad), table.category))
    return pending


def main() -> int:
    parser = argparse.ArgumentParser(description="潮玩雷达榜单截图 → 周数据 md")
    parser.add_argument("folder", nargs="?", help="周数据文件夹，例如 潮玩雷达数据/8.15数据")
    parser.add_argument("--date", default="", help="统计日期，例如 2026.8.15")
    parser.add_argument("--week", default="", help="周区间，用于输出文件名，例如 8.9-8.15")
    parser.add_argument("--out", default="", help="输出 md 路径")
    parser.add_argument("--category", default="", help="强制指定品类，兜底用")
    parser.add_argument("--write", action="store_true", help="写出 md 文件")
    parser.add_argument("--dry-run", action="store_true", help="只打印识别结果，不写任何文件")
    parser.add_argument("--dump", default="", help="把每张图的识别原文写到该目录，便于校对")
    parser.add_argument("--use-dump", default="", help="复用已有的识别原文目录，跳过 OCR（调参时省时间）")
    parser.add_argument("--compare", default="", help="与人工整理的 md 对比商品名召回率")
    args = parser.parse_args()

    rules = load_corrections()

    if not args.folder:
        parser.print_help()
        return 1
    folder = Path(args.folder)
    if not folder.is_absolute():
        folder = BASE / folder
    if not folder.exists():
        sys.exit(f"找不到文件夹：{folder}")

    images = sorted(p for p in folder.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES)
    if not images:
        sys.exit(f"{folder} 里没有图片")

    engine = None if args.use_dump else build_engine()
    tables: list[Table] = []
    all_cells: dict[str, list[Cell]] = {}

    for image in images:
        if args.use_dump:
            cached = Path(args.use_dump)
            if not cached.is_absolute():
                cached = BASE / cached
            cells = load_dump(cached / f"{image.stem}.txt", rules)
        else:
            cells = ocr_image(engine, image, rules)
        all_cells[image.name] = cells
        table = parse_table(cells, image.name)
        if table and table.rows:
            if args.category:
                table.category = args.category
            tables.append(table)
        status = "识别为表格" if table else "未识别出表头，已跳过"
        count = len(table.rows) if table else 0
        print(f"[OCR] {image.name}：{len(cells)} 个文本块 / {count} 行 · {status}", file=sys.stderr)

    if args.dump:
        dump_dir = Path(args.dump)
        if not dump_dir.is_absolute():
            dump_dir = BASE / dump_dir
        dump_dir.mkdir(parents=True, exist_ok=True)
        for name, cells in all_cells.items():
            lines = [
                f"{round(c.x0)},{round(c.y0)},{round(c.x1)},{round(c.y1)}\t{round(c.score, 3)}\t{c.text}"
                for c in sorted(cells, key=lambda c: (c.cy, c.x0))
            ]
            (dump_dir / f"{Path(name).stem}.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"[OCR] 识别原文已导出：{dump_dir}", file=sys.stderr)

    if not tables:
        print("没有识别出任何可用表格。可先用 --dump 导出识别原文人工确认。", file=sys.stderr)
        return 1

    body = "\n".join(table_to_md(t, i, args.date) for i, t in enumerate(tables, start=1))

    pending = reviewable_rows(tables)
    if pending:
        print(f"[核对] {len(pending)} 行数字没认全，需要人工过一眼：", file=sys.stderr)
        for image, name, problem, category in pending:
            print(f"  - {category}｜{name}｜{problem}（{image}）", file=sys.stderr)

    if args.compare:
        expected = read_reference_names(Path(args.compare))
        got = {re.sub(r"\s+", "", row[1]) for t in tables for row in t.rows if row[1] and row[1] != "-"}
        hit = {
            n
            for n in expected
            if any(n in g or g in n or similar(n, g) for g in got)
        }
        recall = len(hit) / len(expected) if expected else 0
        print(
            f"[对比] 人工 md 商品名 {len(expected)} 条，OCR 命中 {len(hit)} 条，召回率 {recall:.1%}；"
            f"OCR 多识别出 {len(got - expected)} 条",
            file=sys.stderr,
        )
        missed = sorted(expected - hit)
        if missed:
            print(f"[对比] 未命中 {len(missed)} 条，多是形近字噪声，可补进 ocr_corrections.json：", file=sys.stderr)
            for name in missed[:20]:
                close = max(got, key=lambda g: similarity(name, g), default="")
                print(f"  - {name}  ←→  {close}", file=sys.stderr)

    if args.write:
        out = Path(args.out) if args.out else folder / f"潮玩品类数据{args.week}.md"
        if not out.is_absolute():
            out = BASE / out
        out.write_text(body, encoding="utf-8")
        print(f"[OCR] 已写出：{out}", file=sys.stderr)
        if pending:
            checklist = out.with_name(out.stem + "-待核对.md")
            lines = [
                "# OCR 待核对清单",
                "",
                f"来源：{folder}",
                "",
                "| 品类 | 商品名 | 问题 | 截图 |",
                "| :--- | :--- | :--- | :--- |",
            ]
            lines += [f"| {c} | {n} | {p} | {i} |" for i, n, p, c in pending]
            checklist.write_text("\n".join(lines) + "\n", encoding="utf-8")
            print(f"[OCR] 待核对清单已写出：{checklist}", file=sys.stderr)
    else:
        print(body)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
