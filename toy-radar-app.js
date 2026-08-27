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
  view: "overview",
  demo: false,
};

const nf = new Intl.NumberFormat("zh-CN");

const sectionAccent = {
  blind_box: "#67e8f9",
  action_figure: "#ff6bb5",
  trading_card: "#ff8d4d",
  ai_toy: "#a7ff83",
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
  sectionMap = Object.fromEntries(DATA.sections.map((section) => [section.id, section]));
  allItems = DATA.sections.flatMap((section) =>
    section.items.map((item) => ({
      ...item,
      sectionTitle: section.title,
      sectionSummary: section.summary,
      roleNotes: section.roleNotes,
      channel: channelOf(section),
    }))
  );
}

activateWeek(ALL_SNAPSHOTS.length - 1);

const els = {
  tabs: document.getElementById("tabs"),
  personaToggle: document.getElementById("personaToggle"),
  heroPersonaToggle: document.getElementById("heroPersonaToggle"),
  weekBadge: document.getElementById("weekBadge"),
  heroWeekBadge: document.getElementById("heroWeekBadge"),
  heroStats: document.getElementById("heroStats"),
  radarA: document.getElementById("radarA"),
  radarB: document.getElementById("radarB"),
  radarC: document.getElementById("radarC"),
  heroSignal: document.getElementById("heroSignal"),
  feedTitle: document.getElementById("feedTitle"),
  feedDesc: document.getElementById("feedDesc"),
  feedNote: document.getElementById("feedNote"),
  hotList: document.getElementById("hotList"),
  insightTitle: document.getElementById("insightTitle"),
  insightDesc: document.getElementById("insightDesc"),
  insightNote: document.getElementById("insightNote"),
  personaPanel: document.getElementById("personaPanel"),
  categoryGrid: document.getElementById("categoryGrid"),
  storeList: document.getElementById("storeList"),
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
    tab.addEventListener("click", () => {
      state.view = tab.dataset.view;
      els.tabs.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
      ["overview", "rankings", "trends"].forEach((name) => {
        document.getElementById(`view-${name}`).classList.toggle("hidden", name !== state.view);
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
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

function renderHeroStats() {
  const blind = sectionMap.blind_box;
  const stats = [
    {
      label: "周总销量",
      value: formatWan(DATA.totalSold),
      delta: `${DATA.totalItems} 条记录`,
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
                <span class="label">销量</span>
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
          <td class="cell-name">${escapeHtml(item.name)}<small>${escapeHtml(item.channel)} · ${escapeHtml(item.date)}</small></td>
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
      <circle cx="100" cy="100" r="${R}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="26" />
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
  const colors = ["#67e8f9", "#66a6ff", "#ff8d4d", "#ff6bb5"];
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
  const palette = ["#67e8f9", "#66a6ff", "#ff8d4d", "#a7ff83", "#ff6bb5", "#ffd166", "#67e8f9", "#66a6ff", "#ff8d4d", "#a7ff83"];
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
        stroke="rgba(255,255,255,0.07)" stroke-width="1" stroke-dasharray="3 5" />
      <text x="${pad.left - 10}" y="${(yFor(g) + 4).toFixed(1)}" fill="rgba(232,242,255,0.42)" font-size="10" text-anchor="end">${g}</text>
    `
    )
    .join("");

  const xLabels = series
    .map((week, index) => {
      const isLatest = !week.simulated && index === series.length - 1;
      return `
      <text x="${xFor(index).toFixed(1)}" y="${H - 14}" fill="${week.simulated ? "rgba(232,242,255,0.4)" : "#c8f7ff"}" font-size="11" text-anchor="middle">
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
            <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${isReal ? 6 : 4}" fill="${isReal ? color : "rgba(5,10,16,0.9)"}"
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
  const accent = sectionAccent[item.section] || "#67e8f9";

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
      <line x1="${pad.left}" y1="${yFor(g).toFixed(1)}" x2="${W - pad.right}" y2="${yFor(g).toFixed(1)}" stroke="rgba(255,255,255,0.07)" stroke-dasharray="3 5" />
      <text x="${pad.left - 8}" y="${(yFor(g) + 4).toFixed(1)}" fill="rgba(232,242,255,0.4)" font-size="9" text-anchor="end">${g}</text>
    `
    )
    .join("");

  const points = weeks.map((week, index) => ({ x: xFor(index), y: yFor(week.value), week }));
  const d = points.map((p, index) => `${index === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const dots = points
    .map((p) => `
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.week.simulated ? 4 : 6}"
        fill="${p.week.simulated ? "rgba(5,10,16,0.9)" : sectionAccent[item.section] || "#67e8f9"}"
        stroke="${sectionAccent[item.section] || "#67e8f9"}" stroke-width="2"
        stroke-dasharray="${p.week.simulated ? "2 2" : ""}" />
      <text x="${p.x.toFixed(1)}" y="${H - 8}" fill="${p.week.simulated ? "rgba(232,242,255,0.4)" : "#c8f7ff"}" font-size="10" text-anchor="middle">${escapeHtml(p.week.label)}</text>
    `)
    .join("");

  return `${grid}<path d="${d}" fill="none" stroke="${sectionAccent[item.section] || "#67e8f9"}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="5 4" style="filter:drop-shadow(0 0 6px ${sectionAccent[item.section] || "#67e8f9"}66)"/>${dots}`;
}

function closeModal() {
  els.modal.classList.add("hidden");
  els.modalBackdrop.classList.add("hidden");
  document.body.style.overflow = "";
}

/* ===================== 渲染入口 ===================== */

function renderOverview() {
  renderHeroStats();
  renderRadarBadges();
  renderHeroSignal();
  renderHotList();
  renderPersonaPanel();
  renderCategoryCards();
  renderStoreList();
}

function renderAll() {
  bindPersonaToggle(els.personaToggle);
  bindPersonaToggle(els.heroPersonaToggle);
  els.weekBadge.textContent = DATA.weekRange;
  els.heroWeekBadge.textContent = DATA.weekRange;
  const channels = [...new Set(allItems.flatMap((item) => item.channel.split(" / ")))].join(" / ");
  els.footerNote.innerHTML = `${DATA.weekRange} 周度快照（统计日 ${DATA.statDate}）· 数据来源：${escapeHtml(channels)}热销榜<br />当前已有 ${ALL_SNAPSHOTS.length} 期真实快照：趋势图中“模拟前 3 周”为演示数据，仅用于展示产品形态，不代表真实历史。`;
  renderOverview();
  renderRankings();
  renderTrends();
}

/* ===================== 事件绑定 ===================== */

bindTabs();
bindWeekSelect();

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
