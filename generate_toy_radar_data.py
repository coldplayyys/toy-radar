from __future__ import annotations

import json
import re
import statistics
from collections import Counter
from datetime import date
from pathlib import Path


BASE = Path(__file__).resolve().parent
DATA_DIR = BASE / "潮玩雷达数据"
OUT = BASE / "toy-radar-data.js"

# 文件名里的周区间，例如“潮玩品类数据7.26-8.1.md”
WEEK_RE = re.compile(r"(\d{1,2})\.(\d{1,2})\s*[-~]\s*(\d{1,2})\.(\d{1,2})")

# 渠道关键词，用于从表格标题中识别数据来源
CHANNEL_ALIASES = ["天猫", "抖音", "京东", "淘宝"]


def parse_number(value: str) -> float | None:
    raw = value.strip().replace(",", "")
    raw = raw.replace("起", "").replace("+", "")
    if not raw:
        return None
    multiplier = 1
    if "万" in raw:
        multiplier = 10000
        raw = raw.replace("万", "")
    try:
        return float(raw) * multiplier
    except ValueError:
        return None


def clean_text(value: str) -> str:
    return value.replace("\xa0", " ").strip()


def section_slug(title: str) -> str:
    if "盲盒" in title:
        return "blind_box"
    if "可动手办" in title or "高达" in title or "机甲" in title:
        return "action_figure"
    if "卡牌" in title:
        return "trading_card"
    if "AI" in title:
        return "ai_toy"
    return "section"


def section_label(title: str) -> str:
    if "盲盒" in title:
        return "盲盒"
    if "可动手办" in title or "高达" in title or "机甲" in title:
        return "可动手办"
    if "卡牌" in title:
        return "收藏卡牌"
    if "AI" in title:
        return "AI 玩具"
    return title


def clean_title(title: str) -> str:
    """去掉“表N：”前缀、括号备注和开头渠道词，得到干净的展示标题。"""
    title = re.sub(r"^表[一二三四五六七八九十百\d]+[:：]\s*", "", title)
    title = re.sub(r"[（(][^）)]*[）)]", "", title)
    title = title.strip(" ：:，,、")
    while True:
        stripped = False
        for ch in CHANNEL_ALIASES:
            if title.startswith(ch):
                title = title[len(ch):].lstrip("、,， ")
                stripped = True
        if not stripped:
            break
    return title.strip()


def extract_channel(title: str) -> str:
    found = [ch for ch in CHANNEL_ALIASES if ch in title]
    return " / ".join(dict.fromkeys(found)) or "综合"


def build_insight(slug: str) -> str:
    return {
        "blind_box": "本周走量主战场，低客单、高复购，适合盯爆款复制和门店补货速度。",
        "action_figure": "中高客单与收藏属性并存，首发、联名和模型党偏好是关键。",
        "trading_card": "高客单分化最强，稀缺卡和联名盘子更容易拉高客单与讨论度。",
        "ai_toy": "教育、陪伴和功能卖点驱动明显，适合观察新品功能叙事与亲子场景。",
    }.get(slug, "观察本周热卖结构变化。")


def build_role_notes(slug: str) -> dict[str, str]:
    return {
        "consumer": {
            "blind_box": "适合买入：单价低，适合尝新和蹲隐藏款。",
            "action_figure": "适合买入：适合收藏和摆件型消费。",
            "trading_card": "适合买入：看稀缺卡和热门 IP，别只看低价。",
            "ai_toy": "适合买入：更适合亲子/陪伴场景，先看功能再看颜值。",
        }.get(slug, "先看热度再看预算。"),
        "operator": {
            "blind_box": "运营建议：保持上新节奏，重点盯 TOPTOY / 泡泡玛特渠道。",
            "action_figure": "运营建议：关注联名和展会首发，适合做预售和限量策略。",
            "trading_card": "运营建议：高价卡适合内容种草，低价卡适合走量。",
            "ai_toy": "运营建议：功能点要讲清楚，亲子、教育和陪伴场景最关键。",
        }.get(slug, "持续观察渠道与库存。"),
    }


def parse_md(path: Path) -> dict:
    """解析一份周数据 md，返回该周的结构化结果。"""
    text = path.read_text(encoding="utf-8")
    sections: list[dict] = []
    raw_rows: list[dict] = []

    current_title = None
    current_rows: list[list[str]] = []
    for line in text.splitlines():
        if line.startswith("### "):
            if current_title and current_rows:
                sections.append({"title": current_title, "rows": current_rows})
            current_title = line[4:].strip()
            current_rows = []
            continue
        if line.startswith("|"):
            cells = [clean_text(cell) for cell in line.strip("|").split("|")]
            current_rows.append(cells)
    if current_title and current_rows:
        sections.append({"title": current_title, "rows": current_rows})

    parsed_sections: list[dict] = []
    store_counter = Counter()
    store_sold = Counter()
    price_band_sold = Counter()
    all_items: list[dict] = []
    all_prices: list[float] = []
    stat_dates: list[str] = []

    # 同一品类可能拆成多张表（如“可动手办”和“高达模型”），按品类 id 合并
    merged_sections: dict[str, dict] = {}
    merged_order: list[str] = []

    for section in sections:
        rows = section["rows"]
        if len(rows) < 3:
            continue
        data_rows = rows[2:]
        title = section["title"]
        slug = section_slug(title)
        label = section_label(title)
        channel = extract_channel(title)

        items = []
        sold_values = []
        price_values = []
        for row in data_rows:
            if len(row) != 6:
                continue
            category, name, sold_raw, price_raw, shop, stat_date = row
            sold = parse_number(sold_raw)
            price = parse_number(price_raw)
            if sold is None or price is None:
                continue
            if stat_date not in stat_dates:
                stat_dates.append(stat_date)
            item = {
                "category": category,
                "name": name,
                "soldLabel": sold_raw,
                "sold": int(sold),
                "priceLabel": price_raw,
                "price": price,
                "shop": shop,
                "date": stat_date,
                "section": slug,
                "sectionLabel": label,
            }
            items.append(item)
            sold_values.append(sold)
            price_values.append(price)
            all_items.append(item)
            all_prices.append(price)
            store_counter[shop] += 1
            store_sold[shop] += sold
            if price < 100:
                price_band_sold["under100"] += sold
            elif price < 300:
                price_band_sold["100_299"] += sold
            elif price < 1000:
                price_band_sold["300_999"] += sold
            else:
                price_band_sold["1000_plus"] += sold

        if not items:
            continue  # 纯店铺榜等没有商品数据的表跳过

        if slug not in merged_sections:
            merged_sections[slug] = {
                "id": slug,
                "title": clean_title(title),
                "source": channel,
                "summary": build_insight(slug),
                "roleNotes": build_role_notes(slug),
                "items": [],
                "sold_values": [],
                "price_values": [],
            }
            merged_order.append(slug)
        entry = merged_sections[slug]
        entry["items"].extend(items)
        entry["sold_values"].extend(sold_values)
        entry["price_values"].extend(price_values)
        channels = set(entry["source"].split(" / ")) | set(channel.split(" / "))
        channels.discard("")
        entry["source"] = " / ".join(sorted(channels))

    for slug in merged_order:
        entry = merged_sections[slug]
        items_sorted = sorted(entry["items"], key=lambda x: x["sold"], reverse=True)
        parsed_sections.append({
            "id": slug,
            "title": entry["title"],
            "source": entry["source"],
            "summary": entry["summary"],
            "roleNotes": entry["roleNotes"],
            "itemCount": len(items_sorted),
            "totalSold": int(sum(entry["sold_values"])),
            "medianPrice": statistics.median(entry["price_values"]) if entry["price_values"] else 0,
            "priceMin": min(entry["price_values"]) if entry["price_values"] else 0,
            "priceMax": max(entry["price_values"]) if entry["price_values"] else 0,
            "topItem": items_sorted[0] if items_sorted else None,
            "items": items_sorted,
        })

    stat_date = stat_dates[0] if stat_dates else ""
    year = stat_date.split(".")[0] if stat_date else str(date.today().year)
    week_match = WEEK_RE.search(path.stem)
    week_label = (
        f"{week_match.group(1)}.{week_match.group(2)}-{week_match.group(3)}.{week_match.group(4)}"
        if week_match
        else stat_date
    )
    week_range = (
        f"{year}.{week_match.group(1)}.{week_match.group(2)} - {year}.{week_match.group(3)}.{week_match.group(4)}"
        if week_match
        else (f"{year}.{stat_date}" if stat_date else "本周")
    )

    total_sold = sum(section["totalSold"] for section in parsed_sections)
    return {
        "weekLabel": week_label,
        "weekRange": week_range,
        "statDate": stat_date,
        "totalItems": len(all_items),
        "totalSold": int(total_sold),
        "avgPrice": round(sum(all_prices) / len(all_prices), 1) if all_prices else 0,
        "priceMin": min(all_prices) if all_prices else 0,
        "priceMax": max(all_prices) if all_prices else 0,
        "sections": parsed_sections,
        "allItems": all_items,
        "allPrices": all_prices,
        "store_counter": store_counter,
        "store_sold": store_sold,
        "price_band_sold": price_band_sold,
    }


def week_sort_key(path: Path) -> tuple[int, int]:
    """按文件名里的周起始日期排序；解析不到就排最后。"""
    match = WEEK_RE.search(path.stem)
    if match:
        return (int(match.group(1)), int(match.group(2)))
    return (99, 99)


def main() -> None:
    sources = sorted(
        (path for path in DATA_DIR.rglob("潮玩品类数据*.md") if path.is_file()),
        key=week_sort_key,
    )
    if not sources:
        raise SystemExit(f"未在 {DATA_DIR} 找到周数据 md 文件")

    parsed = [parse_md(path) for path in sources]
    latest = parsed[-1]

    weekly_snapshots = [
        {
            "week": week["weekLabel"],
            "label": week["weekLabel"],
            "totalSold": week["totalSold"],
            "totalItems": week["totalItems"],
            "sections": {section["id"]: section["totalSold"] for section in week["sections"]},
        }
        for week in parsed
    ]

    total_sold = latest["totalSold"]
    price_bands = [
        {"key": "under100", "label": "100 元以下", "sold": int(latest["price_band_sold"]["under100"])},
        {"key": "100_299", "label": "100-299 元", "sold": int(latest["price_band_sold"]["100_299"])},
        {"key": "300_999", "label": "300-999 元", "sold": int(latest["price_band_sold"]["300_999"])},
        {"key": "1000_plus", "label": "1000 元以上", "sold": int(latest["price_band_sold"]["1000_plus"])},
    ]
    for band in price_bands:
        band["share"] = round(band["sold"] / total_sold * 100, 1) if total_sold else 0

    top_stores = [
        {"shop": shop, "sold": int(sold), "items": latest["store_counter"][shop]}
        for shop, sold in latest["store_sold"].most_common(10)
    ]

    all_items_sorted = sorted(latest["allItems"], key=lambda x: x["sold"], reverse=True)
    top_items = all_items_sorted[:10]

    payload = {
        "weekRange": latest["weekRange"],
        "generatedAt": date.today().isoformat(),
        "totalItems": latest["totalItems"],
        "totalSold": latest["totalSold"],
        "avgPrice": latest["avgPrice"],
        "priceMin": latest["priceMin"],
        "priceMax": latest["priceMax"],
        "topStore": top_stores[0]["shop"] if top_stores else "",
        "topStoreSold": top_stores[0]["sold"] if top_stores else 0,
        "sections": latest["sections"],
        "topItems": top_items,
        "topStores": top_stores,
        "priceBands": price_bands,
        "weeklySnapshots": weekly_snapshots,
        "consumerPicks": [
            top_items[0] if top_items else None,
            next((item for item in top_items if item["price"] < 100), top_items[0] if top_items else None),
            next((item for item in top_items if item["price"] >= 1000), top_items[-1] if top_items else None),
        ],
        "practitionerPicks": [
            latest["sections"][0]["topItem"] if latest["sections"] else None,
            latest["sections"][1]["topItem"] if len(latest["sections"]) > 1 else None,
            latest["sections"][2]["topItem"] if len(latest["sections"]) > 2 else None,
        ],
    }

    lines = [
        "window.TOY_RADAR_DATA = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";",
    ]
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"已生成 {OUT.name}，共 {len(sources)} 个周快照：{', '.join(w['week'] for w in weekly_snapshots)}")


if __name__ == "__main__":
    main()
