/*!
 * 潮玩雷达 · 知识库（RAG）
 *
 * 闭环：上传文档 → 解析（PDF/DOCX/TXT/MD/HTML）→ 切块 → 建索引（BM25 + 可选向量）
 *       → 提问检索 → 大模型只依据检索到的原文作答 → 每条结论点回原文页面
 *
 * 全程跑在浏览器里：文档、切片、向量都存在本机 IndexedDB，API Key 只存 localStorage。
 * 没有配置 Key 时，检索与原文引用照样可用（降级为「检索 + 原文片段」模式）。
 */
(function () {
  "use strict";

  const IS_BROWSER = typeof window !== "undefined" && typeof document !== "undefined";

  /* ======================================================================
   * 一、纯逻辑层（不依赖浏览器，可在 Node 里单测）
   * ==================================================================== */

  const STOPWORDS = new Set([
    "的", "了", "是", "在", "和", "与", "及", "或", "有", "也", "就", "都", "而", "被",
    "把", "对", "为", "以", "于", "这", "那", "个", "我", "你", "他", "它", "们", "很",
    "a", "an", "the", "of", "to", "and", "or", "is", "are",
  ]);

  /** 中英混排分词：汉字取单字 + 二元组，英文/数字按词，既保召回又保区分度。 */
  function tokenize(text) {
    const lower = String(text || "").toLowerCase();
    const tokens = [];
    for (const run of lower.match(/[\u4e00-\u9fff]+/g) || []) {
      for (let i = 0; i < run.length; i += 1) {
        const single = run[i];
        if (!STOPWORDS.has(single)) tokens.push(single);
        if (i + 1 < run.length) tokens.push(run.slice(i, i + 2));
      }
    }
    for (const word of lower.match(/[a-z0-9][a-z0-9._+-]*/g) || []) {
      if (word.length > 1 && !STOPWORDS.has(word)) tokens.push(word);
    }
    return tokens;
  }

  const SENTENCE_END = /(?<=[。！？!?；;：:]|\n)/;

  function splitSentences(text) {
    return String(text || "")
      .replace(/\r/g, "")
      .split(SENTENCE_END)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function tailChars(text, count) {
    if (text.length <= count) return text;
    const cut = text.slice(-count);
    const boundary = cut.search(/[。！？!?；;\n]/);
    return boundary >= 0 && boundary < cut.length - 8 ? cut.slice(boundary + 1) : cut;
  }

  /**
   * 按页切块：保留页码，块与块之间留一点重叠，避免答案正好卡在切口上。
   * pages: [{ page, text }]
   */
  function chunkPages(pages, options) {
    const { target = 420, overlap = 90, minLen = 40 } = options || {};
    const chunks = [];
    let seq = 0;

    const flush = (text, page) => {
      const value = String(text || "").trim();
      if (value.length < minLen) return false;
      chunks.push({ seq: seq++, page, text: value });
      return true;
    };

    for (const page of pages || []) {
      const pageNo = page.page || 1;
      let buffer = "";
      for (const sentence of splitSentences(page.text)) {
        let piece = sentence;
        // 超长句（例如没有标点的表格行）直接硬切
        while (piece.length > target * 1.6) {
          const head = piece.slice(0, target);
          if (buffer) {
            flush(buffer + head, pageNo);
          } else {
            flush(head, pageNo);
          }
          piece = piece.slice(target - overlap);
        }
        if (buffer && buffer.length + piece.length > target) {
          flush(buffer, pageNo);
          buffer = tailChars(buffer, overlap) + piece;
        } else {
          buffer += piece;
        }
      }
      flush(buffer, pageNo);
    }
    return chunks;
  }

  /** BM25 索引（k1/b 用检索里的常用默认值）。 */
  function buildBm25(chunks) {
    const postings = [];
    const docLen = [];
    const df = new Map();
    let totalLen = 0;
    (chunks || []).forEach((chunk) => {
      const tokens = chunk.tokens || tokenize(chunk.text);
      const tf = new Map();
      tokens.forEach((token) => tf.set(token, (tf.get(token) || 0) + 1));
      tf.forEach((_count, token) => df.set(token, (df.get(token) || 0) + 1));
      postings.push(tf);
      docLen.push(tokens.length);
      totalLen += tokens.length;
    });
    const n = postings.length;
    return { postings, docLen, df, n, avgLen: n ? totalLen / n : 1 };
  }

  function bm25Search(index, query, topK) {
    const limit = topK || 8;
    const scores = new Float64Array(index.n);
    const k1 = 1.5;
    const b = 0.75;
    for (const token of new Set(tokenize(query))) {
      const df = index.df.get(token);
      if (!df) continue;
      const idf = Math.log(1 + (index.n - df + 0.5) / (df + 0.5));
      for (let i = 0; i < index.n; i += 1) {
        const tf = index.postings[i].get(token);
        if (!tf) continue;
        const norm = 1 - b + (b * index.docLen[i]) / (index.avgLen || 1);
        scores[i] += (idf * (tf * (k1 + 1))) / (tf + k1 * norm);
      }
    }
    return Array.from(scores)
      .map((score, index_) => ({ index: index_, score }))
      .filter((item) => item.score > 0)
      .sort((a, b_) => b_.score - a.score)
      .slice(0, limit);
  }

  function cosine(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i += 1) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    if (!na || !nb) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  function normalizeScores(list) {
    const max = list.reduce((acc, item) => Math.max(acc, item.score), 0);
    if (!max) return list.map((item) => ({ ...item, norm: 0 }));
    return list.map((item) => ({ ...item, norm: item.score / max }));
  }

  /** 混合检索：词法分与向量分各自归一化后加权合并。 */
  function mergeScores(lexical, vector, weights) {
    const { lex = 0.45, vec = 0.55 } = weights || {};
    const merged = new Map();
    normalizeScores(lexical || []).forEach((item) => {
      merged.set(item.id, { id: item.id, score: item.norm * lex, lex: item.norm, vec: 0 });
    });
    normalizeScores(vector || []).forEach((item) => {
      const hit = merged.get(item.id) || { id: item.id, score: 0, lex: 0, vec: 0 };
      hit.vec = item.norm;
      hit.score = hit.lex * lex + item.norm * vec;
      merged.set(item.id, hit);
    });
    return Array.from(merged.values()).sort((a, b) => b.score - a.score);
  }

  /** 从答案里解析 [1][2] 这类引用编号，返回出现顺序去重后的编号数组。 */
  function parseCitations(answer, maxIndex) {
    const limit = maxIndex || 99;
    const seen = [];
    const pattern = /\[(\d{1,2})\]/g;
    let match = pattern.exec(String(answer || ""));
    while (match) {
      const index = Number(match[1]);
      if (index >= 1 && index <= limit && !seen.includes(index)) seen.push(index);
      match = pattern.exec(answer);
    }
    return seen;
  }

  /** 在原文里定位引用片段，返回高亮用的 [start, end]；找不到返回 null。 */
  function locateSpan(haystack, needle) {
    const source = String(haystack || "");
    const target = String(needle || "").trim();
    if (!source || !target) return null;

    const direct = source.indexOf(target);
    if (direct >= 0) return [direct, direct + target.length];

    // 引用片段常常比原文长（模型会补字），逐级缩短前缀去试探
    for (const size of [48, 32, 24, 16, 12, 8, 6]) {
      if (target.length <= size) continue;
      const probe = target.slice(0, size);
      const found = source.indexOf(probe);
      if (found >= 0) return [found, Math.min(source.length, found + target.length)];
    }

    // 再兜一层：找两段文字的最长公共片段，够长就当作命中
    const common = longestCommonSpan(source, target);
    if (common && common.length >= 6) return [common.start, common.start + common.length];
    return null;
  }

  /** 朴素最长公共子串（片段量级很小，够用）。 */
  function longestCommonSpan(source, target) {
    if (source.length > 4000 || target.length > 300) return null;
    let best = { length: 0, start: 0 };
    const previous = new Array(target.length + 1).fill(0);
    for (let i = 1; i <= source.length; i += 1) {
      const current = new Array(target.length + 1).fill(0);
      for (let j = 1; j <= target.length; j += 1) {
        if (source[i - 1] === target[j - 1]) {
          current[j] = previous[j - 1] + 1;
          if (current[j] > best.length) best = { length: current[j], start: i - current[j] };
        }
      }
      previous.splice(0, previous.length, ...current);
    }
    return best.length ? best : null;
  }

  /* ======================================================================
   * 二、浏览器层
   * ==================================================================== */

  const PROVIDERS = {
    deepseek: {
      label: "DeepSeek",
      base: "https://api.deepseek.com/v1",
      chat: "deepseek-chat",
      embed: "",
    },
    siliconflow: {
      label: "硅基流动 SiliconFlow",
      base: "https://api.siliconflow.cn/v1",
      chat: "Qwen/Qwen2.5-7B-Instruct",
      embed: "BAAI/bge-m3",
    },
    zhipu: {
      label: "智谱 GLM",
      base: "https://open.bigmodel.cn/api/paas/v4",
      chat: "glm-4-flash",
      embed: "embedding-3",
    },
    moonshot: {
      label: "月之暗面 Kimi",
      base: "https://api.moonshot.cn/v1",
      chat: "moonshot-v1-8k",
      embed: "",
    },
    openai: {
      label: "OpenAI",
      base: "https://api.openai.com/v1",
      chat: "gpt-4o-mini",
      embed: "text-embedding-3-small",
    },
    custom: { label: "自定义（OpenAI 兼容）", base: "", chat: "", embed: "" },
  };

  const SYSTEM_PROMPT = [
    "你是「潮玩雷达」的行业资料助手，服务对象是潮玩消费者和从业者。",
    "规则：",
    "1. 只能依据【参考资料】回答，不要使用资料之外的知识，也不要脑补数字。",
    "2. 每个结论后面用 [编号] 标注来源，编号对应参考资料序号；一句话可以用多个编号，如 [1][3]。",
    "3. 资料里没有的，直接回答「资料里没有提到」，并说明还缺什么资料。",
    "4. 数字必须原样引用（销量、单价、日期），不确定就说不确定。",
    "5. 用简洁中文回答，可以用短列表，但不要超过 6 条。",
  ].join("\n");

  const SETTINGS_KEY = "toyradar-kb-settings";
  const DB_NAME = "toy-radar-kb";
  const DB_VERSION = 1;

  const state = {
    ready: false,
    docs: [],
    chunks: [],
    bm25: null,
    chunkById: new Map(),
    settings: {
      provider: "deepseek",
      base: PROVIDERS.deepseek.base,
      key: "",
      chatModel: PROVIDERS.deepseek.chat,
      embedModel: "",
      useVector: false,
      preferProxy: true,
    },
    busy: false,
    lastHits: [],
    readerDocId: "",
  };

  const els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[ch]));
  }

  function uid(prefix) {
    return `${prefix || "id"}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /* ---------------------------------- 存储 --------------------------------- */

  const memory = { docs: new Map(), chunks: new Map() };
  let dbPromise = null;
  let dbDisabled = false;

  function openDb() {
    if (dbDisabled || typeof indexedDB === "undefined") return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("docs")) db.createObjectStore("docs", { keyPath: "id" });
        if (!db.objectStoreNames.contains("chunks")) {
          const store = db.createObjectStore("chunks", { keyPath: "id" });
          store.createIndex("docId", "docId", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbDisabled = true;
        resolve(null);
      };
    });
    return dbPromise;
  }

  function tx(db, store, mode) {
    return db.transaction(store, mode).objectStore(store);
  }

  async function dbPut(store, values) {
    const db = await openDb();
    const list = Array.isArray(values) ? values : [values];
    if (!db) {
      list.forEach((value) => memory[store].set(value.id, value));
      return;
    }
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(store, "readwrite");
      const objectStore = transaction.objectStore(store);
      list.forEach((value) => objectStore.put(value));
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    }).catch(() => {
      // 浏览器拒绝持久化（例如隐私模式）时退回内存，功能不中断
      list.forEach((value) => memory[store].set(value.id, value));
    });
  }

  async function dbAll(store) {
    const db = await openDb();
    if (!db) return Array.from(memory[store].values());
    return new Promise((resolve) => {
      const request = tx(db, store, "readonly").getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve(Array.from(memory[store].values()));
    });
  }

  async function dbDelete(store, id) {
    const db = await openDb();
    memory[store].delete(id);
    if (!db) return;
    await new Promise((resolve) => {
      const request = tx(db, store, "readwrite").delete(id);
      request.onsuccess = resolve;
      request.onerror = resolve;
    });
  }

  async function dbChunksOf(docId) {
    const db = await openDb();
    if (!db) return Array.from(memory.chunks.values()).filter((c) => c.docId === docId);
    return new Promise((resolve) => {
      const index = tx(db, "chunks", "readonly").index("docId");
      const request = index.getAll(docId);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  }

  /* --------------------------------- 文档解析 -------------------------------- */

  function pseudoPages(text, size) {
    const limit = size || 2000;
    const clean = String(text || "").replace(/\r/g, "").trim();
    if (!clean) return [];
    if (clean.length <= limit) return [{ page: 1, text: clean }];
    const parts = clean.split(/\n{2,}/);
    const pages = [];
    let buffer = "";
    let pageNo = 1;
    parts.forEach((part) => {
      if (buffer && buffer.length + part.length > limit) {
        pages.push({ page: pageNo++, text: buffer.trim() });
        buffer = "";
      }
      buffer += (buffer ? "\n\n" : "") + part;
    });
    if (buffer.trim()) pages.push({ page: pageNo, text: buffer.trim() });
    return pages;
  }

  let pdfLibPromise = null;

  async function loadPdfLib() {
    if (!pdfLibPromise) {
      pdfLibPromise = import("./vendor/pdf.min.mjs").then((mod) => {
        const lib = mod.default || mod;
        lib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.mjs";
        return lib;
      });
    }
    return pdfLibPromise;
  }

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[data-src="${src}"]`)) return resolve();
      const script = document.createElement("script");
      script.src = src;
      script.dataset.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`加载失败：${src}`));
      document.head.appendChild(script);
    });
  }

  async function parsePdf(file) {
    const lib = await loadPdfLib();
    const data = await file.arrayBuffer();
    const pdf = await lib.getDocument({ data }).promise;
    const pages = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      let text = "";
      content.items.forEach((item) => {
        text += item.str || "";
        if (item.hasEOL) text += "\n";
      });
      if (text.trim()) pages.push({ page: pageNo, text: text.trim() });
    }
    return { pages, kind: "PDF" };
  }

  async function parseDocx(file) {
    await loadScriptOnce("./vendor/mammoth.browser.min.js");
    if (!window.mammoth) throw new Error("mammoth 未加载成功");
    const buffer = await file.arrayBuffer();
    const result = await window.mammoth.extractRawText({ arrayBuffer: buffer });
    return { pages: pseudoPages(result.value), kind: "Word" };
  }

  async function parseHtml(file) {
    const raw = await file.text();
    const doc = new DOMParser().parseFromString(raw, "text/html");
    doc.querySelectorAll("script,style,nav,footer,header").forEach((node) => node.remove());
    const text = (doc.body ? doc.body.innerText || doc.body.textContent : "") || "";
    return { pages: pseudoPages(text), kind: "HTML" };
  }

  async function parseText(file) {
    const raw = await file.text();
    return { pages: pseudoPages(raw), kind: file.name.toLowerCase().endsWith(".md") ? "Markdown" : "文本" };
  }

  async function parseFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".pdf")) return parsePdf(file);
    if (name.endsWith(".docx")) return parseDocx(file);
    if (name.endsWith(".html") || name.endsWith(".htm")) return parseHtml(file);
    if (name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".markdown")) return parseText(file);
    throw new Error("暂不支持这种格式，请用 PDF / Word / TXT / Markdown / HTML");
  }

  /* --------------------------------- 向量层 -------------------------------- */

  function resolveBase(settings) {
    return (settings.base || "").replace(/\/+$/, "");
  }

  function endpoint(settings, path) {
    return `${resolveBase(settings)}${path}`;
  }

  function canUseLocalProxy() {
    return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  }

  /** 统一请求入口：本地代理优先（绕开 CORS），失败再直连。 */
  async function apiFetch(path, body, settings) {
    if (!resolveBase(settings)) {
      throw new Error("还没填接口地址：在「模型设置」里选一个服务商，或手填 OpenAI 兼容地址");
    }
    const payload = { base: resolveBase(settings), key: settings.key, ...body };
    const attempts = [];
    if (settings.preferProxy && canUseLocalProxy()) {
      attempts.push({ url: `/api/llm${path}`, body: payload, headers: { "Content-Type": "application/json" } });
    }
    attempts.push({
      url: endpoint(settings, path),
      body,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.key}` },
    });

    let lastError = null;
    for (const attempt of attempts) {
      try {
        const response = await fetch(attempt.url, {
          method: "POST",
          headers: attempt.headers,
          body: JSON.stringify(attempt.body),
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          throw new Error(`HTTP ${response.status} ${detail.slice(0, 180)}`);
        }
        return response;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("请求失败");
  }

  async function embedTexts(texts) {
    const settings = state.settings;
    if (!settings.key || !settings.embedModel) return null;
    const response = await apiFetch("/embeddings", { model: settings.embedModel, input: texts }, settings);
    const data = await response.json();
    return (data.data || []).map((item) => Float32Array.from(item.embedding || []));
  }

  /* --------------------------------- 检索层 -------------------------------- */

  function rebuildIndex() {
    state.bm25 = buildBm25(state.chunks);
    state.chunkById = new Map(state.chunks.map((chunk) => [chunk.id, chunk]));
  }

  async function retrieve(question, topK) {
    const limit = topK || 6;
    const lexical = bm25Search(state.bm25, question, limit * 3)
      .map((hit) => ({ id: state.chunks[hit.index].id, score: hit.score }));

    let vector = [];
    const withVectors = state.chunks.filter((chunk) => chunk.vector && chunk.vector.length);
    if (state.settings.useVector && state.settings.key && withVectors.length) {
      try {
        const [queryVector] = (await embedTexts([question])) || [];
        if (queryVector) {
          vector = withVectors
            .map((chunk) => ({ id: chunk.id, score: cosine(queryVector, chunk.vector) }))
            .filter((item) => item.score > 0.05)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit * 3);
        }
      } catch (error) {
        setStatus(`向量检索不可用，已降级为关键词检索：${error.message}`, "warn");
      }
    }

    const merged = mergeScores(lexical, vector, vector.length ? { lex: 0.45, vec: 0.55 } : { lex: 1, vec: 0 });
    const hits = merged
      .slice(0, limit)
      .map((item) => ({ chunk: state.chunkById.get(item.id), score: item.score, lex: item.lex, vec: item.vec }))
      .filter((hit) => hit.chunk);
    state.lastHits = hits;
    return hits;
  }

  /* --------------------------------- 生成层 -------------------------------- */

  function buildPrompt(question, hits) {
    const blocks = hits.map((hit, index) => {
      const doc = state.docs.find((item) => item.id === hit.chunk.docId);
      const title = doc ? doc.title : "未知文档";
      return `【${index + 1}】来源：《${title}》第 ${hit.chunk.page} 页\n${hit.chunk.text}`;
    });
    return [
      "【参考资料】",
      blocks.join("\n\n"),
      "",
      `【问题】${question}`,
      "",
      "请依据参考资料作答，并在结论后用 [编号] 标注来源。",
    ].join("\n");
  }

  async function streamChat(messages, settings, onDelta) {
    const response = await apiFetch(
      "/chat/completions",
      { model: settings.chatModel, messages, stream: true, temperature: 0.2 },
      settings
    );
    const contentType = response.headers.get("content-type") || "";
    if (!response.body || !contentType.includes("event-stream")) {
      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || "";
      if (text) onDelta(text);
      return text;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    const extractor = sseDeltaExtractor();
    let full = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const delta = extractor.push(decoder.decode(value, { stream: true }));
      if (delta) {
        full += delta;
        onDelta(delta);
      }
    }
    const tail = extractor.push("\n");
    if (tail) {
      full += tail;
      onDelta(tail);
    }
    return full;
  }

  /** SSE 增量解析：网络分包会把一行 JSON 切成两半，这里负责攒够再解析。 */
  function sseDeltaExtractor() {
    let buffer = "";
    return {
      push(chunk) {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        let output = "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const json = JSON.parse(payload);
            output += json.choices?.[0]?.delta?.content || "";
          } catch (_error) {
            /* 半截 JSON 继续等下一包 */
          }
        }
        return output;
      },
    };
  }

  /* ---------------------------------- 渲染 --------------------------------- */

  function setStatus(text, tone) {
    if (!els.status) return;
    els.status.textContent = text || "";
    els.status.dataset.tone = tone || "";
    els.status.classList.toggle("hidden", !text);
  }

  function renderStats() {
    const docCount = state.docs.length;
    const chunkCount = state.chunks.length;
    const chars = state.docs.reduce((sum, doc) => sum + (doc.charCount || 0), 0);
    const vectorCount = state.chunks.filter((chunk) => chunk.vector && chunk.vector.length).length;
    els.stats.innerHTML = [
      ["文档", docCount],
      ["切片", chunkCount],
      ["字数", chars > 10000 ? `${(chars / 10000).toFixed(1)} 万` : chars],
      ["已向量化", vectorCount],
    ]
      .map(
        ([label, value]) =>
          `<div class="kb-stat"><span class="kb-stat-value">${escapeHtml(value)}</span><span class="kb-stat-label">${label}</span></div>`
      )
      .join("");
  }

  function renderDocs() {
    if (!els.docs) return;
    if (!state.docs.length) {
      els.docs.innerHTML =
        '<p class="kb-empty">还没有资料。先上传一份 PDF / Word / Markdown，或点「导入站内榜单数据」用现成的三周数据试一次。</p>';
      return;
    }
    els.docs.innerHTML = state.docs
      .slice()
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .map((doc) => {
        const chunks = state.chunks.filter((chunk) => chunk.docId === doc.id).length;
        return `<div class="kb-doc" data-doc="${escapeHtml(doc.id)}">
          <div class="kb-doc-main">
            <div class="kb-doc-title">${escapeHtml(doc.title)}</div>
            <div class="kb-doc-meta">${escapeHtml(doc.kind)} · ${chunks} 个切片 · ${escapeHtml(
          (doc.charCount || 0).toLocaleString("zh-CN")
        )} 字${doc.pages ? ` · ${doc.pages} 页` : ""}</div>
          </div>
          <div class="kb-doc-actions">
            <button class="kb-mini" data-read="${escapeHtml(doc.id)}">阅读</button>
            <button class="kb-mini danger" data-del="${escapeHtml(doc.id)}">删除</button>
          </div>
        </div>`;
      })
      .join("");
  }

  function renderHits(hits) {
    if (!els.hits) return;
    if (!hits.length) {
      els.hits.innerHTML = "";
      return;
    }
    els.hits.innerHTML = hits
      .map((hit, index) => {
        const doc = state.docs.find((item) => item.id === hit.chunk.docId);
        return `<div class="kb-hit" data-hit="${index}">
          <div class="kb-hit-head">
            <span class="kb-hit-idx">[${index + 1}]</span>
            <span class="kb-hit-src">${escapeHtml(doc ? doc.title : "未知文档")} · 第 ${hit.chunk.page} 页</span>
            <span class="kb-hit-score">匹配 ${(hit.score * 100).toFixed(0)}%</span>
          </div>
          <p class="kb-hit-text">${escapeHtml(hit.chunk.text.slice(0, 220))}${hit.chunk.text.length > 220 ? "…" : ""}</p>
          <button class="kb-mini" data-jump="${index}">查看原文</button>
        </div>`;
      })
      .join("");
  }

  function renderAnswerHtml(answerText, hits) {
    const escaped = escapeHtml(answerText);
    const withCites = escaped.replace(/\[(\d{1,2})\]/g, (raw, num) => {
      const index = Number(num);
      if (index < 1 || index > hits.length) return raw;
      return `<button class="kb-cite" data-cite="${index}">[${index}]</button>`;
    });
    return withCites.replace(/\n/g, "<br />");
  }

  function renderReader() {
    const doc = state.docs.find((item) => item.id === state.readerDocId);
    if (!doc || !els.readerBody) return;
    els.readerTitle.textContent = `${doc.title}（${doc.kind}）`;
    const chunks = state.chunks
      .filter((chunk) => chunk.docId === doc.id)
      .sort((a, b) => a.seq - b.seq);
    const highlight = state.readerHighlight || "";
    els.readerBody.innerHTML = chunks
      .map((chunk) => {
        let body = escapeHtml(chunk.text);
        const span = highlight ? locateSpan(chunk.text, highlight) : null;
        if (span) {
          const before = escapeHtml(chunk.text.slice(0, span[0]));
          const middle = escapeHtml(chunk.text.slice(span[0], span[1]));
          const after = escapeHtml(chunk.text.slice(span[1]));
          body = `${before}<mark class="kb-mark">${middle}</mark>${after}`;
        }
        return `<div class="kb-chunk${span ? " is-target" : ""}" id="kbchunk-${escapeHtml(chunk.id)}">
          <div class="kb-chunk-head">第 ${chunk.page} 页 · 片段 ${chunk.seq + 1}</div>
          <p>${body}</p>
        </div>`;
      })
      .join("");
    els.reader.classList.remove("hidden");
    const target = els.readerBody.querySelector(".is-target");
    if (target) target.scrollIntoView({ block: "center" });
    else els.readerBody.scrollTop = 0;
  }

  function openReader(docId, highlight) {
    state.readerDocId = docId;
    state.readerHighlight = highlight || "";
    renderReader();
  }

  function closeReader() {
    state.readerDocId = "";
    state.readerHighlight = "";
    els.reader.classList.add("hidden");
  }

  /* --------------------------------- 入库流程 ------------------------------- */

  async function addDocument({ title, kind, pages, source }) {
    const chunks = chunkPages(pages);
    if (!chunks.length) throw new Error("没解析出可用文字（扫描版 PDF 需要先做 OCR）");
    const doc = {
      id: uid("doc"),
      title,
      kind,
      source: source || "upload",
      pages: pages.length,
      charCount: pages.reduce((sum, page) => sum + (page.text || "").length, 0),
      createdAt: Date.now(),
    };
    const records = chunks.map((chunk) => ({
      id: uid("chk"),
      docId: doc.id,
      seq: chunk.seq,
      page: chunk.page,
      text: chunk.text,
      vector: null,
    }));

    if (state.settings.useVector && state.settings.key && state.settings.embedModel) {
      try {
        const vectors = await embedTexts(records.map((record) => record.text));
        if (vectors) {
          vectors.forEach((vector, index) => {
            if (records[index]) records[index].vector = vector;
          });
        }
      } catch (error) {
        setStatus(`向量化失败，已只建关键词索引：${error.message}`, "warn");
      }
    }

    await dbPut("docs", doc);
    await dbPut("chunks", records);
    state.docs.push(doc);
    state.chunks.push(...records);
    rebuildIndex();
    renderStats();
    renderDocs();
    return doc;
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    state.busy = true;
    for (const file of files) {
      setStatus(`正在解析《${file.name}》…`);
      try {
        const parsed = await parseFile(file);
        const doc = await addDocument({
          title: file.name.replace(/\.[^.]+$/, ""),
          kind: parsed.kind,
          pages: parsed.pages,
        });
        setStatus(`已入库《${file.name}》：${doc.pages} 页 / ${doc.charCount.toLocaleString("zh-CN")} 字`, "ok");
      } catch (error) {
        setStatus(`《${file.name}》入库失败：${error.message}`, "error");
      }
    }
    state.busy = false;
  }

  /** 把站内三周榜单数据变成可检索的文档，方便没资料时也能演示。 */
  async function importSiteData() {
    const raw = window.TOY_RADAR_DATA;
    if (!raw || !raw.weeklySnapshots || !raw.weeklySnapshots.length) {
      setStatus("站内榜单数据还没加载出来", "warn");
      return;
    }
    let added = 0;
    for (const snapshot of raw.weeklySnapshots) {
      const detail = snapshot.detail || {};
      const lines = [];
      lines.push(`潮玩雷达周报 · ${snapshot.label}（统计日 ${detail.statDate || ""}）`);
      lines.push(
        `本周共收录 ${detail.totalItems} 款商品，合计销量 ${Number(detail.totalSold || 0).toLocaleString("zh-CN")}，均价 ${detail.avgPrice} 元，价格区间 ${detail.priceMin}–${detail.priceMax} 元。`
      );
      (detail.sections || []).forEach((section) => {
        const label = (section.items && section.items[0] && section.items[0].sectionLabel) || section.title || section.id;
        lines.push(
          `品类「${label}」：上架 ${section.itemCount} 款，合计销量 ${Number(
            section.totalSold || 0
          ).toLocaleString("zh-CN")}，中位价 ${section.medianPrice} 元。`
        );
        const top = (section.items || [])
          .slice(0, 12)
          .map(
            (item) =>
              `${item.name}（店铺 ${item.shop}，单价 ${item.priceLabel || item.price} 元，已售 ${item.soldLabel || item.sold}）`
          );
        if (top.length) lines.push(`代表商品：${top.join("；")}。`);
      });
      (detail.topIps || []).slice(0, 8).forEach((ip) => {
        lines.push(
          `IP「${ip.ip}」本周在榜 ${ip.items} 款，合计销量 ${Number(ip.sold || 0).toLocaleString("zh-CN")}。`
        );
      });
      const storeLine = (detail.topStores || [])
        .slice(0, 10)
        .map((store) => `${store.shop}（${store.items} 款，销量 ${Number(store.sold || 0).toLocaleString("zh-CN")}）`)
        .join("；");
      if (storeLine) lines.push(`本周热区店铺：${storeLine}。`);

      const title = `潮玩雷达周报 ${snapshot.label}`;
      if (state.docs.some((doc) => doc.title === title)) continue;
      await addDocument({
        title,
        kind: "站内数据",
        source: "site",
        pages: pseudoPages(lines.join("\n\n"), 1400),
      });
      added += 1;
    }
    setStatus(added ? `已导入 ${added} 份站内周报到知识库` : "站内周报已全部入库，无需重复导入", added ? "ok" : "warn");
  }

  /* --------------------------------- 提问流程 ------------------------------- */

  async function ask() {
    const question = els.question.value.trim();
    if (!question) {
      setStatus("先写个问题，比如：这周盲盒里卖得最好的是哪几款？", "warn");
      return;
    }
    if (!state.chunks.length) {
      setStatus("知识库还是空的，先上传资料或导入站内榜单数据", "warn");
      return;
    }
    els.ask.disabled = true;
    els.answer.innerHTML = "";
    setStatus("正在检索资料…");
    try {
      const hits = await retrieve(question, 6);
      renderHits(hits);
      if (!hits.length) {
        setStatus("没检索到相关原文，换个说法或补一份资料试试", "warn");
        return;
      }
      if (!state.settings.key) {
        els.answer.innerHTML =
          '<div class="kb-note">未配置模型 Key，当前是「检索 + 原文片段」模式：上面 6 段是按相关度排序的原文，点「查看原文」可以读上下文。填上 Key 后即可让模型基于这些原文作答。</div>';
        setStatus("检索完成（未配置模型 Key）", "ok");
        return;
      }
      setStatus("正在基于原文生成答案…");
      let acc = "";
      await streamChat(
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildPrompt(question, hits) },
        ],
        state.settings,
        (delta) => {
          acc += delta;
          els.answer.innerHTML = renderAnswerHtml(acc, hits);
        }
      );
      const cited = parseCitations(acc, hits.length);
      els.answer.innerHTML = `${renderAnswerHtml(acc, hits)}
        <div class="kb-cite-bar">${
          cited.length
            ? `引用来源：${cited.map((index) => `<button class="kb-cite" data-cite="${index}">[${index}]</button>`).join(" ")}`
            : "本次答案没有标注引用，建议核对原文后再采信"
        }</div>`;
      setStatus(`完成：检索 ${hits.length} 段原文，引用 ${cited.length} 段`, "ok");
    } catch (error) {
      setStatus(`生成失败：${error.message}`, "error");
    } finally {
      els.ask.disabled = false;
    }
  }

  /* ---------------------------------- 设置 --------------------------------- */

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      Object.assign(state.settings, saved);
    } catch (_error) {
      /* 忽略坏数据 */
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    } catch (_error) {
      /* 隐私模式下写不进去就算了 */
    }
  }

  function applyProvider(providerKey) {
    const preset = PROVIDERS[providerKey] || PROVIDERS.custom;
    state.settings.provider = providerKey;
    if (providerKey !== "custom") {
      state.settings.base = preset.base;
      state.settings.chatModel = preset.chat;
      state.settings.embedModel = preset.embed;
      if (!preset.embed) state.settings.useVector = false;
    }
    syncSettingsForm();
    saveSettings();
  }

  function syncSettingsForm() {
    els.provider.value = state.settings.provider;
    els.base.value = state.settings.base;
    els.key.value = state.settings.key;
    els.chatModel.value = state.settings.chatModel;
    els.embedModel.value = state.settings.embedModel;
    els.useVector.checked = !!state.settings.useVector;
    els.proxy.checked = !!state.settings.preferProxy;
    els.vectorHint.textContent = state.settings.useVector
      ? state.settings.key
        ? "已开启：上传新文档时会调用向量模型，并缓存到本机"
        : "需要先填 Key 才能真正向量化"
      : "关闭时只用关键词（BM25）检索，不消耗向量额度";
  }

  /* ---------------------------------- 初始化 -------------------------------- */

  function bindEvents() {
    els.pick.addEventListener("click", () => els.file.click());
    els.file.addEventListener("change", (event) => {
      handleFiles(event.target.files);
      event.target.value = "";
    });

    ["dragenter", "dragover"].forEach((type) =>
      els.drop.addEventListener(type, (event) => {
        event.preventDefault();
        els.drop.classList.add("is-over");
      })
    );
    ["dragleave", "drop"].forEach((type) =>
      els.drop.addEventListener(type, (event) => {
        event.preventDefault();
        els.drop.classList.remove("is-over");
      })
    );
    els.drop.addEventListener("drop", (event) => handleFiles(event.dataTransfer.files));

    els.importSite.addEventListener("click", importSiteData);
    els.ask.addEventListener("click", ask);
    if (els.samples) {
      els.samples.addEventListener("click", (event) => {
        const text = (event.target.textContent || "").trim();
        if (!text) return;
        els.question.value = text;
        ask();
      });
    }
    els.question.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") ask();
    });

    els.docs.addEventListener("click", async (event) => {
      const readId = event.target.dataset && event.target.dataset.read;
      const delId = event.target.dataset && event.target.dataset.del;
      if (readId) openReader(readId, "");
      if (delId) {
        const doc = state.docs.find((item) => item.id === delId);
        if (!doc || !window.confirm(`删除《${doc.title}》及其全部切片？`)) return;
        for (const chunk of state.chunks.filter((item) => item.docId === delId)) {
          await dbDelete("chunks", chunk.id);
        }
        await dbDelete("docs", delId);
        state.docs = state.docs.filter((item) => item.id !== delId);
        state.chunks = state.chunks.filter((item) => item.docId !== delId);
        rebuildIndex();
        renderStats();
        renderDocs();
        setStatus(`已删除《${doc.title}》`, "ok");
      }
    });

    els.hits.addEventListener("click", (event) => {
      const jump = event.target.dataset && event.target.dataset.jump;
      if (jump === undefined || jump === null || jump === "") return;
      const hit = state.lastHits[Number(jump)];
      if (hit) openReader(hit.chunk.docId, hit.chunk.text.slice(0, 60));
    });

    els.answer.addEventListener("click", (event) => {
      const index = event.target.dataset && event.target.dataset.cite;
      if (!index) return;
      const hit = state.lastHits[Number(index) - 1];
      if (hit) openReader(hit.chunk.docId, hit.chunk.text.slice(0, 60));
    });

    els.readerClose.addEventListener("click", closeReader);
    els.reader.addEventListener("click", (event) => {
      if (event.target === els.reader) closeReader();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && els.reader && !els.reader.classList.contains("hidden")) closeReader();
    });

    els.provider.addEventListener("change", (event) => applyProvider(event.target.value));
    [els.base, els.key, els.chatModel, els.embedModel].forEach((input) =>
      input.addEventListener("change", () => {
        state.settings.base = els.base.value.trim();
        state.settings.key = els.key.value.trim();
        state.settings.chatModel = els.chatModel.value.trim();
        state.settings.embedModel = els.embedModel.value.trim();
        saveSettings();
        syncSettingsForm();
      })
    );
    els.useVector.addEventListener("change", () => {
      state.settings.useVector = els.useVector.checked;
      saveSettings();
      syncSettingsForm();
    });
    els.proxy.addEventListener("change", () => {
      state.settings.preferProxy = els.proxy.checked;
      saveSettings();
    });
  }

  async function init() {
    els.stats = $("kbStats");
    if (!els.stats || state.ready) return;
    els.drop = $("kbDrop");
    els.file = $("kbFile");
    els.pick = $("kbPick");
    els.importSite = $("kbImportSite");
    els.status = $("kbStatus");
    els.docs = $("kbDocs");
    els.question = $("kbQuestion");
    els.ask = $("kbAsk");
    els.answer = $("kbAnswer");
    els.hits = $("kbHits");
    els.reader = $("kbReader");
    els.readerBody = $("kbReaderBody");
    els.readerTitle = $("kbReaderTitle");
    els.readerClose = $("kbReaderClose");
    els.provider = $("kbProvider");
    els.base = $("kbBase");
    els.key = $("kbKey");
    els.chatModel = $("kbChatModel");
    els.embedModel = $("kbEmbedModel");
    els.useVector = $("kbUseVector");
    els.proxy = $("kbProxy");
    els.vectorHint = $("kbVectorHint");
    els.samples = $("kbSamples");

    loadSettings();
    syncSettingsForm();
    bindEvents();

    state.docs = await dbAll("docs");
    state.chunks = await dbAll("chunks");
    rebuildIndex();
    renderStats();
    renderDocs();
    state.ready = true;
  }

  const api = {
    init,
    importSiteData,
    parseFile,
    addDocument,
    handleFiles,
    retrieve,
    ask,
    state,
    tokenize,
    chunkPages,
    buildBm25,
    bm25Search,
    cosine,
    mergeScores,
    parseCitations,
    locateSpan,
    splitSentences,
    tailChars,
    sseDeltaExtractor,
  };

  if (IS_BROWSER) {
    window.ToyRadarKB = api;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }

  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
