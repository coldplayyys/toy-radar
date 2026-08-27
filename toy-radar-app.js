const RAW = window.TOY_RADAR_DATA;

if (!RAW) {
  throw new Error("TOY_RADAR_DATA not loaded");
}

const ALL_SNAPSHOTS = RAW.weeklySnapshots && RAW.weeklySnapshots.length
  ? RAW.weeklySnapshots
  : [{ label: RAW.weekRange, weekRange: RAW.weekRange, statDate: RAW.statDate, sections: {}, detail: RAW }];

let weekIndex = ALL_SNAPSHOTS.length - 1;
let DATA = ALL_SNAPSHOTS[weekIndex].detail;
let sectionMap = {};
let allItems = [];

const state = {
  persona: "consumer",
  category: "all",
  rankCategory: "all",
  rankSort: "sold-desc",
  rankSearch: "",
  heroQuery: "",
  view: "overview",
  demo: false,
};

const nf = new Intl.NumberFormat("zh-CN");

const sectionAccent = {
  blind_box: "#ec4899",
  action_figure: "#7c6cf0",
  trading_card: "#f59e0b",
  ai_toy: "#10b981",
};

const sectionLabel = {
  blind_box: "盲盒",
  action_figure: "可动手办",
  trading_card: "收藏卡牌",
  ai_toy: "AI 玩具",
};

const sectionOrder = ["blind_box", "action_figure", "trading_card", "ai_toy"];

function channelOf(section) {
  return (section.source || "").replace(/\s*\d{4}\.\d{1,2}\.\d{1,2}/, "").trim();
}

function activateWeek(index) {
  const snap = ALL_SNAPSHOTS[index];
  if (!snap) return;
  weekIndex = index;
  DATA = snap.detail;
  const newFaces = new Set((DATA.vsPrev?.newFaces || []).map((i) => `${i.name}|${i.shop}`));
  sectionMap = Object.fromEntries(DATA.sections.map((section) => [section.id, section]));
  allItems = DATA.sections.flatMap((section) =>
    section.items.map((item) => ({
      ...item,
      sectionTitle: section.title,
      sectionSummary: section.summary,
      roleNotes: section.roleNotes,
      channel: channelOf(section),
      isNew: newFaces.has(`${item.name}|${item.shop}`),
    }))
  );
}

activateWeek(ALL_SNAPSHOTS.length - 1);

const els = {
  tabs: document.getElementById("tabs"),
  weekBadge: document.getElementById("weekBadge"),
  heroSearch: document.getElementById("heroSearch"),
  heroSearchCount: document.getElementById("heroSearchCount"),
  heroSearchResults: document.getElementById("heroSearchResults"),
  heroStory: document.getElementById("heroStory"),
  heroEmoji: document.getElementById("heroEmoji"),
  rankSummary: document.getElementById("rankSummary"),
  rankCategoryChips: document.getElementById("rankCategoryChips"),
  rankSearch: document.getElementById("rankSearch"),
  rankSort: document.getElementById("rankSort"),
  rankBody: document.getElementById("rankBody"),
  donutBox: document.getElementById("donutBox"),
  donutLegend: document.getElementById("donutLegend"),
  bandBars: document.getElementById("bandBars"),
  storeBars: document.getElementById("storeBars"),
  lineChart: document.getElementById("lineChart"),
  lineLegend: document.getElementById("lineLegend"),
  lineNote: document.getElementById("lineNote"),
  demoToggle: document.getElementById("demoToggle"),
  insightList: document.getElementById("insightList"),
  modal: document.getElementById("modal"),
  modalBackdrop: document.getElementById("modalBackdrop"),
  footerNote: document.getElementById("footerNote"),
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatWan(value, digits = 1) {
  if (value >= 10000) {
    return `${Number((value / 10000).toFixed(digits)).toString()}万`;
  }
  return nf.format(value);
}

function formatMoney(value) {
  if (value === null || value === undefined) return "--";
  return Number.isInteger(value) ? `¥${nf.format(value)}` : `¥${Number(value.toFixed(1))}`;
}

function formatPriceRange(min, max) {
  return `${formatMoney(min)} - ${formatMoney(max)}`;
}

function getSection(key) {
  return sectionMap[key] || sectionMap.blind_box;
}

function getFilteredRankItems() {
  let items = allItems;
  if (state.rankCategory !== "all") {
    items = items.filter((item) => item.section === state.rankCategory);
  }
  const query = state.rankSearch.trim().toLowerCase();
  if (query) {
    items = items.filter(
      (item) =>
        item.name.toLowerCase().includes(query) ||
        item.shop.toLowerCase().includes(query) ||
        (item.ip || "").toLowerCase().includes(query) ||
        item.sectionLabel.toLowerCase().includes(query)
    );
  }
  return [...items];
}

function getSortedRankItems() {
  const items = getFilteredRankItems();
  switch (state.rankSort) {
    case "price-desc":
      return items.sort((a, b) => b.price - a.price);
    case "price-asc":
      return items.sort((a, b) => a.price - b.price);
    case "sold-desc":
    default:
      return items.sort((a, b) => b.sold - a.sold);
  }
}

function bindPersonaToggle(container) {
  const buttons = [
    { key: "consumer", label: "潮玩用户" },
    { key: "operator", label: "从业者" },
  ];
  container.innerHTML = buttons
    .map(
      (item) =>
        `<button class="persona-btn ${state.persona === item.key ? "active" : ""}" data-persona="${item.key}">${escapeHtml(item.label)}</button>`
    )
    .join("");

  container.querySelectorAll(".persona-btn").forEach((button) => {
    button.addEventListener("click", () => {
      state.persona = button.dataset.persona;
      renderAll();
    });
  });
}

function bindTabs() {
  els.tabs.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
  });
}

function switchView(name) {
  state.view = name;
  els.tabs.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.view === name);
  });
  ["overview", "rankings", "trends"].forEach((viewName) => {
    document.getElementById(`view-${viewName}`).classList.toggle("hidden", viewName !== name);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function bindWeekSelect() {
  const select = document.getElementById("weekSelect");
  if (!select) return;
  select.innerHTML = ALL_SNAPSHOTS
    .map((snap, index) => {
      const isLatest = index === ALL_SNAPSHOTS.length - 1;
      return `<option value="${index}" ${index === weekIndex ? "selected" : ""}>${escapeHtml(snap.label)}${isLatest ? "（本周）" : ""}</option>`;
    })
    .join("");
  select.addEventListener("change", () => {
    activateWeek(Number(select.value));
    renderAll();
  });
}

/* ===================== 总览 ===================== */

function renderHeroHeadline() {
  const top = [...allItems].sort((a, b) => b.sold - a.sold)[0];
  const vs = DATA.vsPrev;
  if (!top) {
    els.heroHeadline.innerHTML = "";
    return;
  }
  let story;
  if (top.isNew) {
    story = `上周榜上还没有它，这周直接以 ${top.soldLabel} 销量登顶——就像那只闯入中央公园的雪鸮，一只特别的“款”就能让整周的目光都聚焦过来。`;
  } else if (vs) {
    story = `以 ${top.soldLabel} 销量领跑全榜；盲盒仍占本周总销量 ${((sectionMap.blind_box.totalSold / DATA.totalSold) * 100).toFixed(1)}%。爆款不是偶然，是渠道、IP 与定价共同作用的结果。`;
  } else {
    story = `以 ${top.soldLabel} 销量领跑首批快照，雷达从这里开始扫描市场。`;
  }
  const meta = [];
  if (vs) meta.push(`总销量环比 ${vs.totalDeltaPct >= 0 ? "↑" : "↓"} ${Math.abs(vs.totalDeltaPct).toFixed(1)}%`);
  if (vs) meta.push(`${vs.newCount} 款新上榜`);
  if (vs) meta.push(`对比 ${vs.prevLabel}`);
  const ipTag = top.ip ? ` · ${top.ip}` : "";
  els.heroHeadline.innerHTML = `
    <div class="hero-headline">
      <span class="headline-tag">本周头条 · WEEKLY SPARK</span>
      <h2 class="headline-title">${escapeHtml(top.name)}${escapeHtml(ipTag)}</h2>
      <p class="headline-story">${escapeHtml(story)}</p>
      ${meta.length ? `<div class="headline-meta">${meta.map((m) => `<span class="pill">${escapeHtml(m)}</span>`).join("")}</div>` : ""}
    </div>
  `;
}

function renderHeroStats() {
  const blind = sectionMap.blind_box;
  const vs = DATA.vsPrev;
  const totalDelta = vs
    ? `环比 ${vs.prevLabel} ${vs.totalDeltaPct >= 0 ? "↑" : "↓"} ${Math.abs(vs.totalDeltaPct).toFixed(1)}%`
    : "首批快照";
  const stats = [
    {
      label: "周总销量",
      value: formatWan(DATA.totalSold),
      delta: totalDelta,
    },
    {
      label: "盲盒占比",
      value: `${((blind.totalSold / DATA.totalSold) * 100).toFixed(1)}%`,
      delta: `${formatWan(blind.totalSold)} 销量`,
    },
    {
      label: "头部渠道",
      value: DATA.topStore,
      delta: `${formatWan(DATA.topStoreSold)} 贡献`,
    },
    {
      label: "价位跨度",
      value: formatPriceRange(DATA.priceMin, DATA.priceMax),
      delta: `从 ${formatMoney(DATA.priceMin)} 到 ${formatMoney(DATA.priceMax)}`,
    },
  ];

  els.heroStats.innerHTML = stats
    .map(
      (stat) => `
      <div class="stat">
        <span class="label">${escapeHtml(stat.label)}</span>
        <div class="value">${escapeHtml(stat.value)}</div>
        <div class="delta">${escapeHtml(stat.delta)}</div>
      </div>`
    )
    .join("");
}

function renderRadarBadges() {
  const blind = sectionMap.blind_box;
  els.radarA.textContent = `${((blind.totalSold / DATA.totalSold) * 100).toFixed(1)}%`;
  els.radarB.textContent = formatWan(DATA.topStoreSold);
  els.radarC.textContent = `${formatMoney(DATA.priceMin)}-${formatMoney(DATA.priceMax)}`;
}

function renderHeroSignal() {
  const personaTitle = state.persona === "consumer" ? "用户该怎么逛" : "从业者该怎么盯";
  const headline =
    state.persona === "consumer"
      ? "本周先看 100 元以下盲盒，最稳的入口仍在泡泡玛特和 TOPTOY。"
      : `盲盒贡献了 ${formatWan(sectionMap.blind_box.totalSold)} 销量，泡泡玛特旗舰店是头部渠道。`;
  const body =
    state.persona === "consumer"
      ? "如果只买一个品类，先从盲盒切入；如果想提高命中率，关注每个品类的代表款。"
      : "先看渠道，再看价位：低价带负责走量，高价带负责内容和收藏。";

  els.heroSignal.innerHTML = `
    <div class="tag">${escapeHtml(personaTitle)}</div>
    <p class="headline">${escapeHtml(headline)}</p>
    <p class="body">${escapeHtml(body)}</p>
  `;

  els.insightTitle.textContent = state.persona === "consumer" ? "用户视角" : "从业者视角";
  els.insightDesc.textContent =
    state.persona === "consumer" ? "先看值不值得买，再看买哪一类。" : "先看渠道和供给结构，再看单品。";
  els.insightNote.textContent = state.persona === "consumer" ? "买入建议" : "运营建议";
}

function renderHotList() {
  const items = [...allItems].sort((a, b) => b.sold - a.sold).slice(0, 5);
  const maxSold = items[0]?.sold || 1;
  els.feedTitle.textContent = "本周爆款 Top 5";
  els.feedDesc.textContent =
    state.persona === "consumer"
      ? "按销量排序，帮助潮玩用户先找到最容易入手的款。"
      : "按销量排序，帮助从业者看最该补货的款。";
  els.feedNote.textContent = "点击卡片查看单品详情";
  els.hotList.innerHTML = items
    .map((item, index) => {
      const accent = sectionAccent[item.section] || "#67e8f9";
      const section = sectionMap[item.section];
      const sharedNote = section.summary;
      const roleNote = section.roleNotes[state.persona];
      const width = Math.max(8, (item.sold / maxSold) * 100);
      return `
        <article class="hot-card" style="--accent:${accent}" data-id="${escapeHtml(item.name)}|${escapeHtml(item.shop)}">
          <div class="hot-head">
            <div>
              <div class="hot-rank">TOP ${index + 1} · ${escapeHtml(section.title)}</div>
              <h3>${escapeHtml(item.name)}</h3>
              <div class="hot-meta">
                ${item.isNew ? '<span class="new-pill">新</span>' : ""}
                <span class="pill">${escapeHtml(item.shop)}</span>
                <span class="pill">${escapeHtml(formatMoney(item.price))}</span>
                <span class="pill">${escapeHtml(item.soldLabel)}</span>
              </div>
            </div>
            <div class="hot-sold">${escapeHtml(item.soldLabel)}</div>
          </div>
          <div class="hot-bar"><span style="width:${width}%"></span></div>
          <p class="hot-note">${escapeHtml(sharedNote)}</p>
          <div class="hot-foot">${escapeHtml(roleNote)}</div>
        </article>
      `;
    })
    .join("");

  els.hotList.querySelectorAll(".hot-card").forEach((card) => {
    card.addEventListener("click", () => openModal(card.dataset.id));
  });
}

function renderPersonaPanel() {
  const bandRows = DATA.priceBands
    .map(
      (band) => `
      <div class="band-row">
        <div class="label">
          <span>${escapeHtml(band.label)}</span>
          <span>${escapeHtml(band.share.toFixed(1))}%</span>
        </div>
        <div class="band-track"><span style="width:${band.share}%"></span></div>
      </div>
    `
    )
    .join("");

  if (state.persona === "consumer") {
    const budget = [...allItems].filter((item) => item.price < 100).sort((a, b) => b.sold - a.sold)[0];
    const gift = [...allItems].filter((item) => item.price >= 100 && item.price < 300).sort((a, b) => b.sold - a.sold)[0];
    const collectible = [...allItems].filter((item) => item.price >= 1000).sort((a, b) => b.sold - a.sold)[0] ||
      [...allItems].filter((item) => item.price >= 300).sort((a, b) => b.sold - a.sold)[0];
    const picks = [budget, gift, collectible].filter(Boolean);

    els.personaPanel.innerHTML = `
      <article class="insight-card">
        <div class="eyebrow-mini">用户该看什么</div>
        <h3>先看价格带，再看代表款</h3>
        <p>100 元以下销量占比 ${bandShare("under100")}%，最适合新手和蹲首发；100-299 元适合礼物和尝鲜；300 元以上更偏收藏。</p>
      </article>
      <article class="insight-card">
        <div class="eyebrow-mini">价格带结构</div>
        <div class="band-list">${bandRows}</div>
      </article>
      <div class="pick-grid">
        ${picks
          .map(
            (item, index) => `
            <div class="pick-card" data-id="${escapeHtml(item.name)}|${escapeHtml(item.shop)}">
              <strong>${["入门款", "礼物款", "收藏款"][index]}</strong>
              <small>${escapeHtml(item.name)}</small>
              <small>${escapeHtml(item.soldLabel)} · ${escapeHtml(formatMoney(item.price))}</small>
            </div>
          `
          )
          .join("")}
      </div>
      <article class="insight-card">
        <div class="eyebrow-mini">一句话判断</div>
        <p>本周消费最友好的入口是盲盒，先从低价高频款切入，再去看联名和收藏盘。</p>
      </article>
    `;
  } else {
    const stores = DATA.topStores.slice(0, 4);
    els.personaPanel.innerHTML = `
      <article class="insight-card">
        <div class="eyebrow-mini">从业者该看什么</div>
        <h3>先看渠道和价位，不要只盯单品</h3>
        <p>泡泡玛特旗舰店贡献 ${formatWan(DATA.topStoreSold)} 销量，盲盒占总销量 ${((sectionMap.blind_box.totalSold / DATA.totalSold) * 100).toFixed(1)}%。</p>
      </article>
      <article class="insight-card">
        <div class="eyebrow-mini">价格带结构</div>
        <div class="band-list">${bandRows}</div>
      </article>
      <div class="store-list">
        ${stores
          .map((store) => {
            const width = Math.max(8, (store.sold / stores[0].sold) * 100);
            return `
              <div class="store-row" style="--accent:var(--lime)">
                <strong>${escapeHtml(store.shop)}</strong>
                <div class="store-meta">
                  <span class="pill">${escapeHtml(formatWan(store.sold))}</span>
                  <span class="pill">${store.items} 个上榜商品</span>
                </div>
                <div class="store-bar"><span style="width:${width}%"></span></div>
              </div>
            `;
          })
          .join("")}
      </div>
      <article class="insight-card">
        <div class="eyebrow-mini">运营判断</div>
        <p>盲盒仍是最大流量池，适合继续做快速上新；卡牌和 AI 玩具更适合讲故事和做差异化供给。</p>
      </article>
    `;
  }

  els.personaPanel.querySelectorAll("[data-id]").forEach((card) => {
    card.addEventListener("click", () => openModal(card.dataset.id));
  });
}

function bandShare(key) {
  return `${(DATA.priceBands.find((band) => band.key === key)?.share ?? 0).toFixed(1)}%`;
}

function renderCategoryCards() {
  els.categoryGrid.innerHTML = DATA.sections
    .map((section) => {
      const accent = sectionAccent[section.id] || "#66a6ff";
      const top = section.topItem;
      const share = ((section.totalSold / DATA.totalSold) * 100).toFixed(1);
      const delta = DATA.vsPrev?.categoryDelta?.[section.id];
      const deltaBadge = delta === undefined
        ? '<span class="delta-badge flat">首批</span>'
        : `<span class="delta-badge ${delta >= 0 ? "up" : "down"}">${delta >= 0 ? "↑" : "↓"}${Math.abs(delta).toFixed(1)}%</span>`;
      return `
        <article class="category-card" style="--accent:${accent}">
          <div class="category-top">
            <div>
              <div class="eyebrow-mini">${escapeHtml(channelOf(section))}</div>
              <h3>${escapeHtml(section.title)}</h3>
              <p class="mini">${escapeHtml(section.summary)}</p>
            </div>
            <div class="category-stat">
              <div class="stat">
                <span class="label">销量 ${deltaBadge}</span>
                <div class="value">${escapeHtml(formatWan(section.totalSold))}</div>
              </div>
              <div class="stat">
                <span class="label">中位价</span>
                <div class="value">${escapeHtml(formatMoney(section.medianPrice))}</div>
              </div>
              <div class="stat">
                <span class="label">占比</span>
                <div class="value">${share}%</div>
              </div>
            </div>
          </div>
          <div class="band-track"><span style="width:${share}%"></span></div>
          <div class="mini"><strong>代表款：</strong>${escapeHtml(top.name)} · ${escapeHtml(top.soldLabel)} · ${escapeHtml(formatMoney(top.price))}</div>
          <div class="mini">${escapeHtml(section.roleNotes[state.persona])}</div>
        </article>
      `;
    })
    .join("");
}

const IP_COLORS = ["#ec4899", "#7c6cf0", "#f59e0b", "#10b981", "#fb7185", "#f472b6", "#a78bfa", "#fda4af"];

function renderIpGrid() {
  const ips = DATA.topIps || [];
  const prevIps = weekIndex > 0 ? ALL_SNAPSHOTS[weekIndex - 1].detail.topIps || [] : [];
  const prevMap = new Map(prevIps.map((ip) => [ip.ip, ip.sold]));
  const maxSold = ips.length ? ips[0].sold : 1;
  els.ipGrid.innerHTML = ips
    .map((ip, index) => {
      const prevSold = prevMap.get(ip.ip);
      const delta = prevSold === undefined
        ? '<span class="delta-badge flat">新</span>'
        : `<span class="delta-badge ${ip.sold >= prevSold ? "up" : "down"}">${ip.sold >= prevSold ? "↑" : "↓"}${Math.round((Math.abs(ip.sold - prevSold) / prevSold) * 100)}%</span>`;
      const width = Math.max(8, (ip.sold / maxSold) * 100);
      return `
        <div class="ip-card" style="--accent:${IP_COLORS[index % IP_COLORS.length]}">
          <div class="ip-head">
            <span class="ip-rank">${String(index + 1).padStart(2, "0")}</span>
            <strong>${escapeHtml(ip.ip)}</strong>
            ${delta}
          </div>
          <div class="ip-meta">
            <span>${escapeHtml(formatWan(ip.sold))} 销量</span>
            <span>${ip.items} 款上榜</span>
          </div>
          <div class="band-track"><span style="width:${width}%"></span></div>
        </div>
      `;
    })
    .join("");
}

function renderParadox() {
  const items = [...allItems];
  const total = DATA.totalSold || 1;
  const sorted = [...items].sort((a, b) => b.sold - a.sold);
  const top5Share = (sorted.slice(0, 5).reduce((sum, item) => sum + item.sold, 0) / total) * 100;
  const medianSold = sorted[Math.floor(sorted.length / 2)]?.sold || 1;

  const W = 560;
  const H = 330;
  const pad = { top: 24, right: 18, bottom: 44, left: 50 };
  const prices = items.map((item) => Math.log10(Math.max(item.price, 1)));
  const solds = items.map((item) => Math.log10(Math.max(item.sold, 1)));
  const xMin = Math.min(...prices);
  const xMax = Math.max(...prices);
  const yMin = Math.min(...solds);
  const yMax = Math.max(...solds);
  const xFor = (price) => pad.left + ((Math.log10(price) - xMin) / (xMax - xMin || 1)) * (W - pad.left - pad.right);
  const yFor = (sold) => pad.top + (1 - (Math.log10(sold) - yMin) / (yMax - yMin || 1)) * (H - pad.top - pad.bottom);
  const xMid = xFor(100);
  const yMid = pad.top + (1 - (Math.log10(medianSold) - yMin) / (yMax - yMin || 1)) * (H - pad.top - pad.bottom);

  const grid = `
    <line x1="${pad.left}" y1="${yMid.toFixed(1)}" x2="${W - pad.right}" y2="${yMid.toFixed(1)}" stroke="rgba(255,255,255,0.16)" stroke-dasharray="4 5" />
    <line x1="${xMid.toFixed(1)}" y1="${pad.top}" x2="${xMid.toFixed(1)}" y2="${H - pad.bottom}" stroke="rgba(255,255,255,0.16)" stroke-dasharray="4 5" />
  `;
  const quadLabels = [
    { x: pad.left + 8, y: yMid - 8, text: "低价走量" },
    { x: xMid + 8, y: yMid - 8, text: "高价走量" },
    { x: pad.left + 8, y: yMid + 20, text: "低价长尾" },
    { x: xMid + 8, y: yMid + 20, text: "高价小众" },
  ]
    .map((q) => `<text x="${q.x}" y="${q.y}" fill="${q.text.includes("走量") ? "rgba(212,83,143,0.9)" : "rgba(74,52,64,0.45)"}" font-size="11">${q.text}</text>`)
    .join("");
  const dots = items
    .map((item) => {
      const accent = sectionAccent[item.section] || "#ec4899";
      const r = (5 + Math.log10(item.sold + 1) * 1.1).toFixed(1);
      return `
        <circle cx="${xFor(item.price).toFixed(1)}" cy="${yFor(item.sold).toFixed(1)}" r="${r}" fill="${accent}" fill-opacity="0.82" stroke="rgba(255,255,255,0.28)" stroke-width="0.6">
          <title>${escapeHtml(item.name)} · ${escapeHtml(item.soldLabel)} · ${escapeHtml(formatMoney(item.price))}</title>
        </circle>`;
    })
    .join("");
  const axis = `
    <text x="${pad.left}" y="${H - 14}" fill="rgba(74,52,64,0.45)" font-size="10">单价（对数 · ¥${nf.format(DATA.priceMin)} ~ ¥${nf.format(DATA.priceMax)}）</text>
    <text x="${xMid.toFixed(1)}" y="${pad.top - 7}" fill="rgba(255,255,255,0.5)" font-size="10" text-anchor="middle">¥100</text>
    <text x="${pad.left - 10}" y="${pad.top + 12}" fill="rgba(74,52,64,0.45)" font-size="10" text-anchor="end" transform="rotate(-90 ${pad.left - 10} ${pad.top + 12})">销量（对数）</text>
  `;
  els.paradoxChart.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="销量-单价四象限散点图">${grid}${dots}${quadLabels}${axis}</svg>`;

  const pricey = [...items].sort((a, b) => b.price - a.price)[0];
  const sleeper = sorted.slice(5, 12).find((item) => item.price < 100) || sorted[5];
  const newFace = DATA.vsPrev?.newFaces?.[0];
  const rows = [
    { k: "爆款集中度", v: `Top 5 商品贡献 ${top5Share.toFixed(1)}% 的销量——注意力高度集中在少数爆款上，长尾多数在陪跑。` },
    { k: "客单明星", v: `${escapeHtml(pricey.name)} 标价 ${formatMoney(pricey.price)}，仍有 ${escapeHtml(pricey.soldLabel)} 人买单：稀缺与 IP 信仰可以穿透价格。` },
    { k: "被忽略的潜力款", v: `榜单前五之外，${escapeHtml(sleeper.name)}（${escapeHtml(sleeper.soldLabel)} · ${formatMoney(sleeper.price)}）卖得不差却几乎没被讨论，可能是下周的黑马。` },
  ];
  if (DATA.vsPrev && newFace) {
    rows.push({ k: "本周新面孔", v: `${DATA.vsPrev.newCount} 款商品首次上榜，其中 ${escapeHtml(newFace.name)}（${escapeHtml(newFace.soldLabel)}）涨得最猛。` });
  }
  els.paradoxList.innerHTML = rows
    .map(
      (row, index) => `
      <div class="paradox-item">
        <span class="num">${String(index + 1).padStart(2, "0")}</span>
        <div><strong>${escapeHtml(row.k)}</strong><p>${row.v}</p></div>
      </div>
    `
    )
    .join("");
}

function renderStoreList() {
  els.storeList.innerHTML = DATA.topStores
    .map((store, index) => {
      const width = Math.max(8, (store.sold / DATA.topStores[0].sold) * 100);
      return `
        <div class="store-row" style="--accent:${index === 0 ? "var(--cyan)" : "var(--lime)"}">
          <strong>${escapeHtml(store.shop)}</strong>
          <div class="store-meta">
            <span class="pill">${escapeHtml(formatWan(store.sold))}</span>
            <span class="pill">${store.items} 款商品</span>
          </div>
          <div class="store-bar"><span style="width:${width}%"></span></div>
        </div>
      `;
    })
    .join("");
}

/* ===================== 榜单 ===================== */

function renderRankChips() {
  const chips = [
    { key: "all", label: "全部" },
    ...sectionOrder.map((key) => ({ key, label: sectionLabel[key] })),
  ];
  els.rankCategoryChips.innerHTML = chips
    .map(
      (chip) =>
        `<button class="chip-btn ${state.rankCategory === chip.key ? "active" : ""}" data-category="${chip.key}">${escapeHtml(chip.label)}</button>`
    )
    .join("");

  els.rankCategoryChips.querySelectorAll(".chip-btn").forEach((button) => {
    button.addEventListener("click", () => {
      state.rankCategory = button.dataset.category;
      renderRankings();
    });
  });
}

function renderRankTable() {
  const items = getSortedRankItems();
  const maxSold = Math.max(...items.map((item) => item.sold), 1);
  const channels = [...new Set(allItems.map((item) => item.channel))].join(" / ");

  els.rankSummary.innerHTML = `共 <strong>${items.length}</strong> 款商品 · 本周总销量 <strong>${formatWan(
    items.reduce((sum, item) => sum + item.sold, 0)
  )}</strong> · 渠道覆盖 ${escapeHtml(channels)}`;

  if (!items.length) {
    els.rankBody.innerHTML = `<tr><td colspan="8"><div class="empty-state">没有匹配的商品，换个关键词试试。</div></td></tr>`;
    return;
  }

  els.rankBody.innerHTML = items
    .map((item, index) => {
      const rank = index + 1;
      const accent = sectionAccent[item.section] || "#67e8f9";
      const sharePct = Math.round((item.sold / maxSold) * 100);
      const medal =
        rank <= 3
          ? `<div class="rank-medal g${rank}">${rank}</div>`
          : `<div class="rank-no">${rank}</div>`;
      return `
        <tr data-id="${escapeHtml(item.name)}|${escapeHtml(item.shop)}">
          <td>${medal}</td>
          <td class="cell-name">${escapeHtml(item.name)}${item.isNew ? '<span class="new-pill">新</span>' : ""}<small>${escapeHtml(item.channel)} · ${escapeHtml(item.date)}</small></td>
          <td><span class="cell-cat" style="--dot:${accent}"><i></i>${escapeHtml(item.sectionLabel)}</span></td>
          <td class="cell-num">${escapeHtml(item.channel)}</td>
          <td class="cell-num">${escapeHtml(item.shop)}</td>
          <td class="cell-num">${escapeHtml(formatMoney(item.price))}</td>
          <td class="cell-sold cell-num">${escapeHtml(item.soldLabel)}</td>
          <td>
            <div class="share-cell">
              <span class="pct">${sharePct}%</span>
              <div class="track"><span style="width:${Math.max(2, sharePct)}%"></span></div>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  els.rankBody.querySelectorAll("tr[data-id]").forEach((row) => {
    row.addEventListener("click", () => openModal(row.dataset.id));
  });
}

function renderRankings() {
  renderRankChips();
  renderRankTable();
}

/* ===================== 趋势 ===================== */

const DEMO_WEEKS = [
  { label: "7.5-7.11", factor: 0.52 },
  { label: "7.12-7.18", factor: 0.64 },
  { label: "7.19-7.25", factor: 0.8 },
];

function weekStart(label) {
  const match = String(label).match(/(\d{1,2})\.(\d{1,2})/);
  return match ? { m: Number(match[1]), d: Number(match[2]) } : null;
}

function buildTrendSeries() {
  const snapshots = ALL_SNAPSHOTS;
  const current = snapshots[snapshots.length - 1] ?? {
    label: DATA.weekRange,
    sections: Object.fromEntries(sectionOrder.map((key) => [key, sectionMap[key].totalSold])),
  };
  const firstReal = snapshots.length ? weekStart(snapshots[0].label) : null;
  const weeks = [];
  if (state.demo) {
    DEMO_WEEKS.forEach((week) => {
      const start = weekStart(week.label);
      if (firstReal && start && (start.m > firstReal.m || (start.m === firstReal.m && start.d >= firstReal.d))) {
        return;
      }
      weeks.push({
        label: week.label,
        simulated: true,
        sections: Object.fromEntries(
          sectionOrder.map((key) => [
            key,
            Math.round((current.sections[key] || 0) * week.factor),
          ])
        ),
      });
    });
  }
  snapshots.forEach((week) => {
    weeks.push({ label: week.label, simulated: false, sections: { ...week.sections } });
  });
  if (!weeks.length) {
    weeks.push({ label: current.label, simulated: false, sections: { ...current.sections } });
  }

  return weeks.map((week) => {
    const normalized = {};
    sectionOrder.forEach((key) => {
      const value = week.sections[key] || 0;
      const base = current.sections[key] || 1;
      normalized[key] = (value / base) * 100;
    });
    return { ...week, normalized };
  });
}

function renderDonut() {
  const total = DATA.totalSold;
  const R = 66;
  const C = 2 * Math.PI * R;
  let acc = 0;
  const segments = sectionOrder.map((key) => {
    const section = sectionMap[key];
    const frac = section.totalSold / total;
    const seg = { section, frac, offset: acc };
    acc += frac;
    return seg;
  });

  const arcs = segments
    .map(
      ({ section, frac, offset }) => `
      <circle cx="100" cy="100" r="${R}" fill="none" stroke="${sectionAccent[section.id]}" stroke-width="26"
        stroke-dasharray="${(frac * C).toFixed(1)} ${Math.max(0.5, (C - frac * C).toFixed(1))}"
        stroke-dashoffset="${(-offset * C).toFixed(1)}"
        transform="rotate(-90 100 100)" opacity="0.95"
        stroke-linecap="butt" />
    `
    )
    .join("");

  els.donutBox.innerHTML = `
    <svg width="200" height="200" viewBox="0 0 200 200" role="img" aria-label="品类销量占比环形图">
      <circle cx="100" cy="100" r="${R}" fill="none" stroke="rgba(244,114,182,0.14)" stroke-width="26" />
      ${arcs}
    </svg>
    <div class="donut-center">
      <div>
        <div class="v">${escapeHtml(formatWan(total))}</div>
        <div class="k">本周总销量</div>
      </div>
    </div>
  `;

  els.donutLegend.innerHTML = segments
    .map(
      ({ section, frac }) => `
      <div class="legend-row">
        <span class="swatch" style="--sw:${sectionAccent[section.id]}"></span>
        <span>${escapeHtml(section.title)}<br /><span class="sub">${escapeHtml(formatWan(section.totalSold))} · 中位价 ${escapeHtml(formatMoney(section.medianPrice))}</span></span>
        <span class="val">${(frac * 100).toFixed(1)}%</span>
      </div>
    `
    )
    .join("");
}

function renderBandBars() {
  const maxShare = Math.max(...DATA.priceBands.map((band) => band.share), 1);
  const colors = ["#ec4899", "#7c6cf0", "#f59e0b", "#10b981"];
  els.bandBars.innerHTML = DATA.priceBands
    .map((band, index) => `
      <div class="hbar-row">
        <div class="row-top">
          <span class="name">${escapeHtml(band.label)}</span>
          <span class="val">${escapeHtml(formatWan(band.sold))} <span class="sub">· ${band.share.toFixed(1)}%</span></span>
        </div>
        <div class="track"><span style="--hbar:${colors[index % colors.length]};width:${Math.max(2, (band.share / maxShare) * 100)}%"></span></div>
      </div>
    `)
    .join("");
}

function renderStoreBars() {
  const max = DATA.topStores[0]?.sold || 1;
  const palette = ["#ec4899", "#fb7185", "#f59e0b", "#10b981", "#7c6cf0", "#f472b6", "#ec4899", "#fb7185", "#f59e0b", "#10b981"];
  els.storeBars.innerHTML = DATA.topStores
    .map(
      (store, index) => `
      <div class="hbar-row">
        <div class="row-top">
          <span class="name">${escapeHtml(store.shop)}</span>
          <span class="val">${escapeHtml(formatWan(store.sold))} <span class="sub">· ${store.items} 款</span></span>
        </div>
        <div class="track"><span style="--hbar:${palette[index % palette.length]};width:${Math.max(2, (store.sold / max) * 100)}%"></span></div>
      </div>
    `
    )
    .join("");
}

function renderLineChart() {
  const series = buildTrendSeries();
  const W = 760;
  const H = 300;
  const pad = { top: 26, right: 26, bottom: 42, left: 46 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const maxY = 115;

  const xFor = (index) => pad.left + (innerW * index) / Math.max(1, series.length - 1);
  const yFor = (value) => pad.top + innerH - (Math.min(value, maxY) / maxY) * innerH;

  const grid = [0, 25, 50, 75, 100]
    .map(
      (g) => `
      <line x1="${pad.left}" y1="${yFor(g).toFixed(1)}" x2="${W - pad.right}" y2="${yFor(g).toFixed(1)}"
        stroke="rgba(122,86,105,0.14)" stroke-width="1" stroke-dasharray="3 5" />
      <text x="${pad.left - 10}" y="${(yFor(g) + 4).toFixed(1)}" fill="rgba(74,52,64,0.45)" font-size="10" text-anchor="end">${g}</text>
    `
    )
    .join("");

  const xLabels = series
    .map((week, index) => {
      const isLatest = !week.simulated && index === series.length - 1;
      return `
      <text x="${xFor(index).toFixed(1)}" y="${H - 14}" fill="${week.simulated ? "rgba(74,52,64,0.45)" : "#b04a76"}" font-size="11" text-anchor="middle">
        ${escapeHtml(week.label)}${isLatest ? "（本周）" : ""}
      </text>
    `;
    })
    .join("");

  const paths = sectionOrder
    .map((key) => {
      const color = sectionAccent[key];
      const points = series.map((week, index) => ({
        x: xFor(index),
        y: yFor(week.normalized[key]),
      }));
      const d = points.map((p, index) => `${index === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
      const dots = points
        .map((p, index) => {
          const isReal = !series[index].simulated;
          return `
            <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${isReal ? 6 : 4}" fill="${isReal ? color : "#ffffff"}"
              stroke="${color}" stroke-width="${isReal ? 2.5 : 1.5}"
              stroke-dasharray="${isReal ? "" : "2 2"}"
              opacity="${isReal ? 1 : 0.85}">
              <title>${escapeHtml(sectionLabel[key])} · ${escapeHtml(series[index].label)}${isReal ? "（真实）" : "（演示）"}</title>
            </circle>
          `;
        })
        .join("");
      return `
        <path d="${d}" fill="none" stroke="${color}" stroke-width="${series.length > 1 ? 2.6 : 0}" stroke-linecap="round" stroke-linejoin="round"
          stroke-dasharray="${series.length > 1 ? "" : "0"}" opacity="0.95"
          style="filter:drop-shadow(0 0 6px ${color}66)" />
        ${dots}
      `;
    })
    .join("");

  els.lineChart.innerHTML = `${grid}${xLabels}${paths}`;

  els.lineLegend.innerHTML = sectionOrder
    .map(
      (key) => `
      <span class="lg"><span class="dot" style="--lg:${sectionAccent[key]}"></span>${escapeHtml(sectionLabel[key])}
        <strong style="color:white">${escapeHtml(formatWan(sectionMap[key].totalSold))}</strong></span>
    `
    )
    .join("");

  els.lineNote.innerHTML = state.demo
    ? "演示模式：虚线为按本周销量比例生成的模拟历史（非真实数据），仅用于展示趋势形态；实心圆点为真实快照。后续每接入一周真实快照，折线会自动向前延伸。"
    : `当前已有 ${ALL_SNAPSHOTS.length} 期真实快照（${ALL_SNAPSHOTS.map((w) => w.label).join("、")}），各品类以最近一周为基准 100；趋势线会随每周数据自动延伸。`;
}

function renderInsights() {
  const blind = sectionMap.blind_box;
  const cards = sectionMap.trading_card;
  const ai = sectionMap.ai_toy;
  const figures = sectionMap.action_figure;
  const popoStores = DATA.topStores.filter((s) => s.shop.includes("泡泡玛特"));
  const popoSold = popoStores.reduce((sum, s) => sum + s.sold, 0);
  const under100 = DATA.priceBands.find((band) => band.key === "under100");
  const topFigure = figures.items[0];
  const priceyFigure = [...figures.items].sort((a, b) => b.price - a.price)[0];
  const cardMin = [...cards.items].sort((a, b) => a.price - b.price)[0];
  const cardMax = [...cards.items].sort((a, b) => b.price - a.price)[0];

  const insights = [
    {
      title: "盲盒仍是绝对主引擎",
      body: `盲盒贡献 ${formatWan(blind.totalSold)} 销量，占本周总销量的 ${((blind.totalSold / DATA.totalSold) * 100).toFixed(1)}%；中位价 ${formatMoney(blind.medianPrice)} 元，低价高频是基本盘。`,
    },
    {
      title: "头部渠道高度集中",
      body: `泡泡玛特双店合计贡献约 ${formatWan(popoSold)} 销量，占盲盒品类 ${((popoSold / blind.totalSold) * 100).toFixed(1)}%；对渠道方来说，头部旗舰店的补货与上新节奏直接决定大盘。`,
    },
    {
      title: "卡牌价格带断层明显",
      body: `同一榜单从 ${formatMoney(cardMin?.price)}（${cardMin?.name ?? "—"}）到 ${formatMoney(cardMax?.price)}（${cardMax?.name ?? "—"}），走量靠低价拆卡、声量靠稀缺收藏卡，是典型的内容驱动品类。`,
    },
    {
      title: "AI 玩具客单最高、量级最小",
      body: `中位价 ${formatMoney(ai.medianPrice)} 元为四品类最高，但本周上榜总销量约 ${formatWan(ai.totalSold)}，教育/陪伴叙事决定购买意愿，适合做高客单慢周转。`,
    },
    {
      title: "可动手办双引擎：走量与客单",
      body: `走量靠 ${topFigure?.name ?? "—"}（${topFigure?.soldLabel ?? "—"}，${formatMoney(topFigure?.price)}），高客单由 ${priceyFigure?.name ?? "—"}（${formatMoney(priceyFigure?.price)}）撑起，IP 粉丝盘的复购价值高于泛流量。`,
    },
    {
      title: "100 元以下是走量主战场",
      body: `${under100.label}销量占比 ${under100.share.toFixed(1)}%，合计 ${formatWan(under100.sold)}。对从业者：低价带拼上新速度和渠道覆盖，高价带拼内容与稀缺性。`,
    },
  ];

  els.insightList.innerHTML = insights
    .map(
      (item, index) => `
      <div class="insight-item">
        <div class="num">${String(index + 1).padStart(2, "0")}</div>
        <div>
          <h4>${escapeHtml(item.title)}</h4>
          <p>${escapeHtml(item.body)}</p>
        </div>
      </div>
    `
    )
    .join("");
}

function renderTrends() {
  renderDonut();
  renderBandBars();
  renderStoreBars();
  renderLineChart();
  renderInsights();
}

/* ===================== 单品详情 ===================== */

function findItem(id) {
  const [name, shop] = id.split("|");
  return allItems.find((item) => item.name === name && item.shop === shop);
}

function openModal(id) {
  const item = findItem(id);
  if (!item) return;

  const section = sectionMap[item.section];
  const rank = [...allItems].sort((a, b) => b.sold - a.sold).findIndex((x) => x.name === item.name && x.shop === item.shop) + 1;
  const share = ((item.sold / section.totalSold) * 100).toFixed(1);
  const roleNote = section.roleNotes[state.persona];
  const accent = sectionAccent[item.section] || "#ec4899";

  const chart = buildModalSpark(item);

  els.modal.innerHTML = `
    <button class="modal-close" id="modalClose" aria-label="关闭">×</button>
    <div class="eyebrow-mini">${escapeHtml(item.sectionLabel)} · ${escapeHtml(item.channel)} · 全榜第 ${rank} 名</div>
    <h2 class="modal-title" id="modalTitle">${escapeHtml(item.name)}</h2>
    <div class="modal-meta">
      <span class="pill">${escapeHtml(item.shop)}</span>
      <span class="pill">${escapeHtml(item.date)}</span>
      <span class="pill" style="color:${accent}">${escapeHtml(section.title)}</span>
    </div>
    <div class="modal-stats">
      <div class="modal-stat"><div class="k">已售</div><div class="v">${escapeHtml(item.soldLabel)}</div></div>
      <div class="modal-stat"><div class="k">单价</div><div class="v">${escapeHtml(formatMoney(item.price))}</div></div>
      <div class="modal-stat"><div class="k">占品类销量</div><div class="v">${share}%</div></div>
      <div class="modal-stat"><div class="k">品类中位价</div><div class="v">${escapeHtml(formatMoney(section.medianPrice))}</div></div>
    </div>
    <div class="modal-chart-head">
      <h4>销量周趋势（演示）</h4>
      <span>以本周为基准 100 · 模拟历史仅用于展示</span>
    </div>
    <div class="line-chart-wrap">
      <svg class="line-chart" style="height:170px" viewBox="0 0 640 170" preserveAspectRatio="none">${chart}</svg>
    </div>
    <div class="modal-note"><strong>一句话判断：</strong>${escapeHtml(roleNote)} ${escapeHtml(section.summary)}</div>
  `;

  els.modal.classList.remove("hidden");
  els.modalBackdrop.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  document.getElementById("modalClose").addEventListener("click", closeModal);
}

function buildModalSpark(item) {
  const W = 640;
  const H = 170;
  const pad = { top: 18, right: 16, bottom: 26, left: 42 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const maxY = 115;
  const yFor = (v) => pad.top + innerH - (Math.min(v, maxY) / maxY) * innerH;

  const weeks = [
    ...DEMO_WEEKS.map((week) => ({ label: week.label, value: week.factor * 100, simulated: true })),
    { label: "本周", value: 100, simulated: false },
  ];
  const xFor = (index) => pad.left + (innerW * index) / (weeks.length - 1);

  const grid = [0, 50, 100]
    .map(
      (g) => `
      <line x1="${pad.left}" y1="${yFor(g).toFixed(1)}" x2="${W - pad.right}" y2="${yFor(g).toFixed(1)}" stroke="rgba(122,86,105,0.14)" stroke-dasharray="3 5" />
      <text x="${pad.left - 8}" y="${(yFor(g) + 4).toFixed(1)}" fill="rgba(74,52,64,0.45)" font-size="9" text-anchor="end">${g}</text>
    `
    )
    .join("");

  const points = weeks.map((week, index) => ({ x: xFor(index), y: yFor(week.value), week }));
  const d = points.map((p, index) => `${index === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const dots = points
    .map((p) => `
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.week.simulated ? 4 : 6}"
        fill="${p.week.simulated ? "#ffffff" : sectionAccent[item.section] || "#ec4899"}"
        stroke="${sectionAccent[item.section] || "#ec4899"}" stroke-width="2"
        stroke-dasharray="${p.week.simulated ? "2 2" : ""}" />
      <text x="${p.x.toFixed(1)}" y="${H - 8}" fill="${p.week.simulated ? "rgba(74,52,64,0.45)" : "#b04a76"}" font-size="10" text-anchor="middle">${escapeHtml(p.week.label)}</text>
    `)
    .join("");

  return `${grid}<path d="${d}" fill="none" stroke="${sectionAccent[item.section] || "#ec4899"}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="5 4" style="filter:drop-shadow(0 0 6px ${sectionAccent[item.section] || "#ec4899"}66)"/>${dots}`;
}

function closeModal() {
  els.modal.classList.add("hidden");
  els.modalBackdrop.classList.add("hidden");
  document.body.style.overflow = "";
}

/* ===================== 渲染入口 ===================== */

const IP_EMOJI = {
  CRYBABY: "😭",
  DIMOO: "👦",
  SKULLPANDA: "👻",
  YOYO: "🐰",
  星星人: "✨",
  宝可梦: "⚡",
  小嗷: "🐯",
  一日一菇: "🍄",
  "WAKUKU 哇库库": "🎈",
  DORA: "😼",
  "HEYONE 黑玩": "🖤",
};
const DEFAULT_EMOJI = "🧸";

function renderHeroStory() {
  const top = [...allItems].sort((a, b) => b.sold - a.sold)[0];
  const vs = DATA.vsPrev;
  if (els.heroEmoji) {
    els.heroEmoji.textContent = (top && top.ip && IP_EMOJI[top.ip]) || DEFAULT_EMOJI;
  }
  if (!top) {
    els.heroStory.innerHTML = "";
    return;
  }
  let story;
  if (top.isNew) {
    story = `上周榜上还没有它，这周以 ${top.soldLabel} 销量直接登顶——像一只突然出现的“雪鸮”，让整周的目光都聚焦过来。`;
  } else if (vs) {
    story = `它以 ${top.soldLabel} 销量领跑本周${top.ip ? `（${top.ip}）` : ""}；总销量环比 ${vs.totalDeltaPct >= 0 ? "↑" : "↓"} ${Math.abs(vs.totalDeltaPct).toFixed(1)}%，${vs.newCount} 款新面孔登场。`;
  } else {
    story = `它以 ${top.soldLabel} 销量领跑首批快照，雷达从这里开始扫描市场。`;
  }
  const meta = [];
  if (vs) meta.push(`${vs.newCount} 款新上榜`);
  if (vs) meta.push(`对比 ${vs.prevLabel}`);
  els.heroStory.innerHTML = `
    <span class="headline-tag">本周头条 · WEEKLY SPARK</span>
    <h2 class="headline-title">${escapeHtml(top.name)}${top.ip ? ` · ${escapeHtml(top.ip)}` : ""}</h2>
    <p class="headline-story">${escapeHtml(story)}</p>
    ${meta.length ? `<div class="headline-meta">${meta.map((m) => `<span class="pill">${escapeHtml(m)}</span>`).join("")}</div>` : ""}
  `;
}

function getHeroSearchItems() {
  const query = state.heroQuery.trim().toLowerCase();
  if (!query) return [];
  return [...allItems]
    .filter(
      (item) =>
        item.name.toLowerCase().includes(query) ||
        (item.ip || "").toLowerCase().includes(query) ||
        item.shop.toLowerCase().includes(query) ||
        item.sectionLabel.toLowerCase().includes(query)
    )
    .sort((a, b) => b.sold - a.sold)
    .slice(0, 12);
}

function renderHeroResults() {
  if (!els.heroSearchResults || !els.heroSearchCount) return;
  const query = state.heroQuery.trim();
  if (!query) {
    els.heroSearchResults.classList.add("hidden");
    els.heroSearchCount.textContent = "";
    return;
  }
  const items = getHeroSearchItems();
  els.heroSearchCount.textContent = `${items.length} 个结果`;
  if (!items.length) {
    els.heroSearchResults.classList.remove("hidden");
    els.heroSearchResults.innerHTML = `<div class="hero-empty">没有找到匹配的商品，换个关键词试试。</div>`;
    return;
  }
  els.heroSearchResults.classList.remove("hidden");
  els.heroSearchResults.innerHTML = items
    .map((item) => {
      const accent = sectionAccent[item.section] || "#ec4899";
      return `
        <div class="hero-result" data-id="${escapeHtml(item.name)}|${escapeHtml(item.shop)}">
          <div>
            <div class="r-name">${escapeHtml(item.name)}${item.isNew ? '<span class="new-pill">新</span>' : ""}</div>
            <div class="r-meta">
              <span class="cell-cat" style="--dot:${accent}"><i></i>${escapeHtml(item.sectionLabel)}</span>
              ${item.ip ? `<span class="pill">${escapeHtml(item.ip)}</span>` : ""}
              <span>${escapeHtml(item.shop)}</span>
            </div>
          </div>
          <div class="r-side">
            <div class="r-sold">${escapeHtml(item.soldLabel)}</div>
            <div class="r-price">${escapeHtml(formatMoney(item.price))}</div>
          </div>
        </div>
      `;
    })
    .join("");
  els.heroSearchResults.querySelectorAll(".hero-result").forEach((card) => {
    card.addEventListener("click", () => openModal(card.dataset.id));
  });
}

function renderOverview() {
  renderHeroStory();
  renderHeroResults();
}

function renderAll() {
  els.weekBadge.textContent = DATA.weekRange;
  const channels = [...new Set(allItems.flatMap((item) => item.channel.split(" / ")))].join(" / ");
  els.footerNote.innerHTML = `${DATA.weekRange} 周度快照（统计日 ${DATA.statDate}）· 数据来源：${escapeHtml(channels)}热销榜<br />当前已有 ${ALL_SNAPSHOTS.length} 期真实快照：趋势图中“模拟前 3 周”为演示数据，仅用于展示产品形态，不代表真实历史。<br /><em class="footer-sign">雷达的意义，不在于记录热度，而在于看见——每周更新，欢迎回来。</em>`;
  renderOverview();
  renderRankings();
  renderTrends();
}

/* ===================== 事件绑定 ===================== */

bindTabs();
bindWeekSelect();

els.heroSearch.addEventListener("input", (event) => {
  state.heroQuery = event.target.value;
  renderHeroResults();
});

els.heroSearch.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && state.heroQuery.trim()) {
    state.rankSearch = state.heroQuery.trim();
    els.rankSearch.value = state.rankSearch;
    switchView("rankings");
    renderRankings();
  }
});

els.rankSearch.addEventListener("input", (event) => {
  state.rankSearch = event.target.value;
  renderRankTable();
});

els.rankSort.addEventListener("change", (event) => {
  state.rankSort = event.target.value;
  renderRankTable();
});

els.demoToggle.addEventListener("change", (event) => {
  state.demo = event.target.checked;
  renderLineChart();
});

els.modalBackdrop.addEventListener("click", closeModal);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.modal.classList.contains("hidden")) {
    closeModal();
  }
});

renderAll();
