from __future__ import annotations

import json
import re
import statistics
import unicodedata
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

# 商品名 → IP/系列 的识别词表（覆盖盲盒/手办/卡牌里的收藏向 IP，AI 玩具等以功能为主的商品不归入 IP）
IP_RULES = [
    (("crybaby",), "CRYBABY"),
    (("dimoo",), "DIMOO"),
    (("skullpanda",), "SKULLPANDA"),
    (("星星人",), "星星人"),
    (("zsiga",), "ZSIGA"),
    (("yoyo",), "YOYO"),
    (("宝可梦",), "宝可梦"),
    (("小嗷",), "小嗷"),
    (("一日一菇",), "一日一菇"),
    (("dora",), "DORA"),
    (("wakuku",), "WAKUKU 哇库库"),
    (("哇库库",), "WAKUKU 哇库库"),
    (("hellokitty",), "Hello Kitty"),
    (("雪王",), "雪王"),
    (("米菲",), "米菲"),
    (("吉伊卡哇",), "吉伊卡哇"),
    (("chiikawa",), "吉伊卡哇"),
    (("凡人修仙传",), "凡人修仙传"),
    (("凡人动画",), "凡人修仙传"),
    (("莉洛洛",), "莉洛洛"),
    (("糯米儿",), "糯米儿"),
    (("duiduidui",), "DUIDUIDUI 怼堆堆"),
    (("怼堆堆",), "DUIDUIDUI 怼堆堆"),
    (("猫猫pai",), "猫猫pai"),
    (("奥比岛",), "奥比岛"),
    (("小水豚",), "小水豚噜噜"),
    (("阿玛莉莉丝",), "阿玛莉莉丝"),
    (("玩具总动员",), "玩具总动员"),
    (("巴斯光年",), "巴斯光年"),
    (("我是大王",), "我是大王"),
    (("爱宠大机密",), "爱宠大机密"),
    (("shyshy",), "ShyShy 兔"),
    (("芭萨卡",), "芭萨卡"),
    (("喜羊羊",), "喜羊羊与灰太狼"),
    (("heyone",), "HEYONE 黑玩"),
    (("黑玩",), "HEYONE 黑玩"),
    (("dodo rara",), "DODO RARA"),
    (("pingu",), "Pingu"),
    (("relax",), "RELAX"),
    (("小马宝莉",), "小马宝莉"),
    (("帕尼尼",), "帕尼尼"),
    (("游戏王",), "游戏王"),
    (("哪吒",), "哪吒"),
    (("乘风2026",), "乘风2026"),
    (("永恒之镜",), "永恒之镜"),
    (("现在就出发",), "现在就出发"),
    (("怪奇物语",), "怪奇物语"),
    (("卡游",), "卡游"),
    (("hitcard",), "Hitcard"),
    (("卡牌对对碰",), "卡牌对对碰"),
    (("战锤",), "战锤40K"),
    (("40k",), "战锤40K"),
    (("暗源",), "暗源"),
    (("变形金刚",), "变形金刚"),
    (("蝙蝠侠",), "蝙蝠侠"),
    (("inart",), "INART"),
    (("黑神话",), "黑神话：悟空"),
    (("超人",), "DC 超人"),
    (("超级少女",), "DC 超级少女"),
    (("蹂躏者",), "DC 黑暗之夜"),
    (("破晓诡灯",), "DC 黑暗之夜"),
    (("阿卡姆",), "DC 蝙蝠侠"),
    (("街头霸王",), "街头霸王"),
    (("莱欧斯利",), "原神"),
    (("高达",), "高达"),
    (("模寿",), "模寿"),
    (("猎人 clutch",), "猎人 CLUTCH"),
]


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


def extract_ip(name: str) -> str:
    low = name.lower()
    for keywords, label in IP_RULES:
        if all(keyword in low for keyword in keywords):
            return label
    return ""


def normalize_product_name(name: str) -> str:
    """商品名归一化：只用于判断“是不是同一款”，不改变展示名。"""
    value = unicodedata.normalize("NFKC", name or "").lower()
    value = value.replace("×", "x").replace("✕", "x").replace("＊", "*")
    value = re.sub(r"[\s\u3000]+", "", value)
    value = re.sub(r"[·•・]", "", value)
    value = re.sub(r"[，,。.;；:：!！?？\"'“”‘’（）()\[\]【】]", "", value)
    return value


def format_sold_label(value: float) -> str:
    if value >= 10000:
        wan = value / 10000
        text = f"{wan:.1f}".rstrip("0").rstrip(".")
        return f"{text}万+"
    return f"{int(round(value))}+"


def format_price_label(low: float, high: float) -> str:
    if abs(low - high) < 1e-9:
        return f"{low:g}"
    return f"{low:g}–{high:g}"


CATEGORY_PRIORITY = {"盲盒": 0, "收藏卡牌": 1, "可动手办": 2, "AI玩具": 3}


def merge_duplicate_items(items: list[dict]) -> list[dict]:
    """全周范围内，把同名商品的多店铺/多渠道/多榜单记录合并为一条。

    销量求和；价格给出区间；店铺保留明细，榜单上显示“主店铺 等 N 家”。
    若同一款同时出现在盲盒榜与手办榜，优先保留更贴近商品本身的品类。
    """
    groups: dict[str, list[dict]] = {}
    order: list[str] = []
    for item in items:
        key = normalize_product_name(item["name"])
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(item)

    merged: list[dict] = []
    for key in order:
        group = groups[key]
        total_sold = sum(item["sold"] for item in group)
        representative = max(
            group,
            key=lambda item: (item["sold"], -CATEGORY_PRIORITY.get(item["category"], 9)),
        )

        shop_records: dict[str, dict] = {}
        for item in group:
            shop = (item.get("shop") or "").strip()
            if not shop:
                continue
            record = shop_records.setdefault(
                shop,
                {
                    "shop": shop,
                    "sold": 0,
                    "priceMin": item["price"],
                    "priceMax": item["price"],
                },
            )
            record["sold"] += item["sold"]
            record["priceMin"] = min(record["priceMin"], item["price"])
            record["priceMax"] = max(record["priceMax"], item["price"])

        shops = sorted(shop_records.values(), key=lambda record: record["sold"], reverse=True)
        for record in shops:
            record["soldLabel"] = format_sold_label(record["sold"])
            record["priceLabel"] = format_price_label(record["priceMin"], record["priceMax"])

        price_low = min(item["price"] for item in group)
        price_high = max(item["price"] for item in group)
        price_weighted = (
            sum(item["price"] * item["sold"] for item in group) / total_sold
            if total_sold
            else representative["price"]
        )
        shop_label = (
            shops[0]["shop"]
            if len(shops) == 1
            else f"{shops[0]['shop']} 等 {len(shops)} 家"
            if shops
            else representative.get("shop", "")
        )

        merged.append({
            **representative,
            "name": representative["name"],
            "sold": int(total_sold),
            "soldLabel": format_sold_label(total_sold),
            "price": round(price_weighted, 2),
            "priceMin": price_low,
            "priceMax": price_high,
            "priceLabel": format_price_label(price_low, price_high),
            "shop": shop_label,
            "shops": shops,
            "shopCount": len(shops),
            "sourceCount": len(group),
        })

    return sorted(merged, key=lambda item: item["sold"], reverse=True)


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
                "ip": extract_ip(name),
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

    # 先在全周范围内合并同名商品（跨店铺、跨渠道、跨榜单），再按归属品类组装
    raw_items = [item for slug in merged_order for item in merged_sections[slug]["items"]]
    all_items = merge_duplicate_items(raw_items)
    for slug in merged_order:
        entry = merged_sections[slug]
        items_sorted = [item for item in all_items if item["section"] == slug]
        if not items_sorted:
            continue
        parsed_sections.append({
            "id": slug,
            "title": entry["title"],
            "source": entry["source"],
            "summary": entry["summary"],
            "roleNotes": entry["roleNotes"],
            "itemCount": len(items_sorted),
            "totalSold": int(sum(item["sold"] for item in items_sorted)),
            "medianPrice": statistics.median(item["price"] for item in items_sorted),
            "priceMin": min(item["priceMin"] for item in items_sorted),
            "priceMax": max(item["priceMax"] for item in items_sorted),
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

    # 榜单按合并后的商品展示；店铺统计与价格带仍用原始行（同一商品在不同店的价格/销量各自归位）
    all_items = [item for section in parsed_sections for item in section["items"]]
    all_prices = [item["price"] for item in all_items]
    total_sold = sum(item["sold"] for item in all_items)
    avg_price = (
        sum(item["price"] * item["sold"] for item in all_items) / total_sold
        if total_sold
        else 0
    )
    return {
        "weekLabel": week_label,
        "weekRange": week_range,
        "statDate": stat_date,
        "totalItems": len(all_items),
        "totalSold": int(total_sold),
        "avgPrice": round(avg_price, 1),
        "priceMin": min((item["priceMin"] for item in all_items), default=0),
        "priceMax": max((item["priceMax"] for item in all_items), default=0),
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


def build_vs_prev(week: dict, prev: dict) -> dict:
    """计算本周相对上一周的环比指标与本周新上榜商品。"""

    def key(item: dict) -> tuple:
        # 合并后同一商品只有一个条目；身份只看商品名，避免品类归属变化被误判为新款
        return normalize_product_name(item["name"])

    cur_sections = {section["id"]: section["totalSold"] for section in week["sections"]}
    prev_sections = {section["id"]: section["totalSold"] for section in prev["sections"]}
    cur_keys = {key(item) for item in week["allItems"]}
    prev_keys = {key(item) for item in prev["allItems"]}
    new_items = sorted(
        (item for item in week["allItems"] if key(item) not in prev_keys),
        key=lambda x: x["sold"],
        reverse=True,
    )
    return {
        "prevLabel": prev["weekLabel"],
        "totalDeltaPct": round((week["totalSold"] - prev["totalSold"]) / prev["totalSold"] * 100, 1)
        if prev["totalSold"]
        else 0.0,
        "categoryDelta": {
            section_id: round((cur_sections[section_id] - prev_sections.get(section_id, 0)) / prev_sections[section_id] * 100, 1)
            if prev_sections.get(section_id)
            else 0.0
            for section_id in cur_sections
        },
        "newCount": len(new_items),
        "newFaces": new_items[:8],
        "repeatedCount": len(cur_keys & prev_keys),
    }


def build_payload(week: dict, prev: dict | None = None) -> dict:
    """把单周解析结果变成与主 payload 同形状的视图数据（不含 weeklySnapshots）。"""
    total_sold = week["totalSold"]
    price_bands = [
        {"key": "under100", "label": "100 元以下", "sold": int(week["price_band_sold"]["under100"])},
        {"key": "100_299", "label": "100-299 元", "sold": int(week["price_band_sold"]["100_299"])},
        {"key": "300_999", "label": "300-999 元", "sold": int(week["price_band_sold"]["300_999"])},
        {"key": "1000_plus", "label": "1000 元以上", "sold": int(week["price_band_sold"]["1000_plus"])},
    ]
    for band in price_bands:
        band["share"] = round(band["sold"] / total_sold * 100, 1) if total_sold else 0

    top_stores = [
        {"shop": shop, "sold": int(sold), "items": week["store_counter"][shop]}
        for shop, sold in week["store_sold"].most_common(10)
    ]

    all_items_sorted = sorted(week["allItems"], key=lambda x: x["sold"], reverse=True)
    top_items = all_items_sorted[:10]
    ip_sold = Counter()
    ip_items = Counter()
    for item in week["allItems"]:
        if item["ip"]:
            ip_sold[item["ip"]] += item["sold"]
            ip_items[item["ip"]] += 1
    top_ips = [
        {"ip": ip, "sold": int(ip_sold[ip]), "items": ip_items[ip]}
        for ip, _ in ip_sold.most_common(8)
    ]

    return {
        "weekRange": week["weekRange"],
        "statDate": week["statDate"],
        "vsPrev": build_vs_prev(week, prev) if prev else None,
        "totalItems": week["totalItems"],
        "totalSold": week["totalSold"],
        "avgPrice": week["avgPrice"],
        "priceMin": week["priceMin"],
        "priceMax": week["priceMax"],
        "topStore": top_stores[0]["shop"] if top_stores else "",
        "topStoreSold": top_stores[0]["sold"] if top_stores else 0,
        "sections": week["sections"],
        "topItems": top_items,
        "topStores": top_stores,
        "topIps": top_ips,
        "priceBands": price_bands,
        "consumerPicks": [
            top_items[0] if top_items else None,
            next((item for item in top_items if item["price"] < 100), top_items[0] if top_items else None),
            next((item for item in top_items if item["price"] >= 1000), top_items[-1] if top_items else None),
        ],
        "practitionerPicks": [
            week["sections"][0]["topItem"] if week["sections"] else None,
            week["sections"][1]["topItem"] if len(week["sections"]) > 1 else None,
            week["sections"][2]["topItem"] if len(week["sections"]) > 2 else None,
        ],
    }


def main() -> None:
    sources = sorted(
        (path for path in DATA_DIR.rglob("潮玩品类数据*.md") if path.is_file()),
        key=week_sort_key,
    )
    if not sources:
        raise SystemExit(f"未在 {DATA_DIR} 找到周数据 md 文件")

    parsed = [parse_md(path) for path in sources]
    latest = parsed[-1]

    # 每个周快照都携带完整明细，前端可随时切换查看任意一周
    weekly_snapshots = []
    for index, week in enumerate(parsed):
        prev = parsed[index - 1] if index > 0 else None
        weekly_snapshots.append({
            "week": week["weekLabel"],
            "label": week["weekLabel"],
            "weekRange": week["weekRange"],
            "statDate": week["statDate"],
            "totalSold": week["totalSold"],
            "totalItems": week["totalItems"],
            "sections": {section["id"]: section["totalSold"] for section in week["sections"]},
            "detail": build_payload(week, prev),
        })

    payload = build_payload(latest, parsed[-2] if len(parsed) > 1 else None)
    payload["generatedAt"] = date.today().isoformat()
    payload["weeklySnapshots"] = weekly_snapshots

    lines = [
        "window.TOY_RADAR_DATA = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";",
    ]
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"已生成 {OUT.name}，共 {len(sources)} 个周快照：{', '.join(w['week'] for w in weekly_snapshots)}")


if __name__ == "__main__":
    main()
