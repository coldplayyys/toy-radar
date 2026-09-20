/**
 * 知识库纯逻辑单测（不依赖浏览器）：node tests/kb.test.js
 * 覆盖：分词、切块、BM25 检索、混合排序、引用解析、原文定位。
 */

const assert = require("assert");
const kb = require("../toy-radar-kb.js");

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  ✗ ${name}\n      ${error.message}`);
  }
}

console.log("知识库逻辑单测");

test("分词：中文出单字与二元组，英文数字成词", () => {
  const tokens = kb.tokenize("泡泡玛特 LABUBU 3.0 盲盒");
  assert.ok(tokens.includes("泡泡"), "应包含二元组 泡泡");
  assert.ok(tokens.includes("labubu"), "英文应转小写成词");
  assert.ok(tokens.includes("3.0"), "版本号应保留");
  assert.ok(!tokens.includes("的"), "停用字应被过滤");
});

test("切块：保留页码、控制长度、块间有重叠", () => {
  const pages = [
    { page: 1, text: "盲盒是走量主力。".repeat(60) },
    { page: 2, text: "卡牌客单价更高。".repeat(60) },
  ];
  const chunks = kb.chunkPages(pages, { target: 200, overlap: 40 });
  assert.ok(chunks.length >= 6, `应切出多块，实际 ${chunks.length}`);
  assert.ok(chunks.every((chunk) => chunk.text.length > 0));
  assert.deepStrictEqual([...new Set(chunks.map((c) => c.page))].sort(), [1, 2]);
  assert.ok(
    chunks.every((chunk) => chunk.text.length <= 200 * 1.8),
    "单块长度不应失控"
  );
  assert.deepStrictEqual(
    chunks.map((chunk) => chunk.seq),
    chunks.map((_chunk, index) => index),
    "序号应连续"
  );
});

test("BM25：能按关键词命中正确切片并排序", () => {
  const texts = [
    "本周盲盒品类销量最高的是 YOYO 萌趣歪头盲盒，单价 49 元。",
    "收藏卡牌里篮球帕尼尼国宝系列单价 40000 元，走的是稀缺卡路线。",
    "AI 玩具以早教翻译机为主，客单价集中在 200 到 500 元。",
  ];
  const chunks = texts.map((text, index) => ({ id: `c${index}`, text, seq: index, page: 1 }));
  const index_ = kb.buildBm25(chunks);
  const hits = kb.bm25Search(index_, "帕尼尼 卡牌", 3);
  assert.strictEqual(chunks[hits[0].index].id, "c1");
  assert.ok(hits[0].score > 0);
});

test("混合检索：词法与向量分数合并后仍按 chunk id 去重", () => {
  const merged = kb.mergeScores(
    [
      { id: "a", score: 10 },
      { id: "b", score: 5 },
    ],
    [
      { id: "b", score: 0.9 },
      { id: "c", score: 0.5 },
    ],
    { lex: 0.5, vec: 0.5 }
  );
  assert.deepStrictEqual(merged.map((item) => item.id).sort(), ["a", "b", "c"]);
  const b = merged.find((item) => item.id === "b");
  assert.ok(b.lex > 0 && b.vec > 0, "b 应同时拿到两路分数");
  assert.strictEqual(merged[0].id, "b", "两路都命中的 b 应排第一");
  assert.strictEqual(merged[1].id, "a", "只有词法分的 a 排第二");
});

test("余弦相似度：同向为 1，正交为 0，长度不一致为 0", () => {
  assert.ok(Math.abs(kb.cosine(Float32Array.from([1, 0]), Float32Array.from([2, 0])) - 1) < 1e-6);
  assert.strictEqual(kb.cosine(Float32Array.from([1, 0]), Float32Array.from([0, 1])), 0);
  assert.strictEqual(kb.cosine(Float32Array.from([1, 0]), Float32Array.from([1, 0, 0])), 0);
});

test("引用解析：按出现顺序去重，越界编号忽略", () => {
  assert.deepStrictEqual(kb.parseCitations("盲盒走量[1]，卡牌客单高[3]，印证了这点[1][9]", 6), [1, 3]);
  assert.deepStrictEqual(kb.parseCitations("没有任何引用的答案", 6), []);
});

test("原文定位：精确命中与截断探测都能给出高亮区间", () => {
  const source = "本周盲盒品类销量最高的是 YOYO 萌趣歪头盲盒，单价 49 元。";
  const exact = kb.locateSpan(source, "YOYO 萌趣歪头盲盒");
  assert.ok(exact, "精确匹配应命中");
  assert.strictEqual(source.slice(exact[0], exact[1]), "YOYO 萌趣歪头盲盒");
  const loose = kb.locateSpan(source, "YOYO 萌趣歪头盲盒，单价 49 元，合计销量 20 万。");
  assert.ok(loose, "长片段应按前 24 字探测命中");
  assert.strictEqual(kb.locateSpan(source, "完全不相关的内容"), null);
});

test("端到端（无网络）：入库文本 → 建索引 → 检索 → 定位原文", () => {
  const pages = [
    {
      page: 3,
      text:
        "2026 年 8 月 15 日周报：盲盒品类合计销量 860200，其中 YOYO 萌趣歪头盲盒销量 200000 件，单价 49 元，店铺为 miniso 名创优品旗舰店。\n" +
        "收藏卡牌品类合计销量 98600，篮球帕尼尼国宝系列单价 40000 元。",
    },
  ];
  const chunks = kb.chunkPages(pages, { target: 120, overlap: 20 }).map((chunk, index) => ({
    id: `e${index}`,
    ...chunk,
  }));
  const index_ = kb.buildBm25(chunks);
  const hits = kb.bm25Search(index_, "YOYO 销量", 2);
  assert.ok(hits.length > 0, "应检索到内容");
  const top = chunks[hits[0].index];
  const span = kb.locateSpan(top.text, "YOYO 萌趣歪头盲盒销量 200000 件");
  assert.ok(span, "应在原文中定位到引用片段");
  assert.strictEqual(top.page, 3, "页码应保留");
});

test("SSE 流式解析：分包切断 JSON 也能拼回完整答案", () => {
  const extractor = kb.sseDeltaExtractor();
  const frames = [
    'data: {"choices":[{"delta":{"content":"盲盒"}}]}\n',
    "\n",
    'data: {"choices":[{"delta":{"content":"是最"}}]}\n\ndata: {"cho',
    'ices":[{"delta":{"content":"走量的品类"}}]}\n\n',
    "data: [DONE]\n\n",
  ];
  const text =
    frames.map((frame) => extractor.push(frame).content).join("") + extractor.push("\n").content;
  assert.strictEqual(text, "盲盒是最走量的品类");
});

test("SSE 流式解析：忽略非 data 行与坏 JSON", () => {
  const extractor = kb.sseDeltaExtractor();
  const text =
    extractor.push(": keep-alive\n\n").content +
    extractor.push('data: {"choices":[{"delta":{"content":"A"}}]}\n').content +
    extractor.push("data: {坏掉的 json}\n").content +
    extractor.push('data: {"choices":[{"delta":{"content":"B"}}]}\n').content;
  assert.strictEqual(text, "AB");
});

test("SSE 流式解析：推理型模型的 reasoning_content 与正文分开", () => {
  const extractor = kb.sseDeltaExtractor();
  const first = extractor.push('data: {"choices":[{"delta":{"reasoning_content":"先想想…"}}]}\n');
  const second = extractor.push(
    'data: {"choices":[{"delta":{"reasoning_content":"再想想。"}}]}\n' +
      'data: {"choices":[{"delta":{"content":"结论"}}]}\n'
  );
  assert.strictEqual(first.content, "");
  assert.strictEqual(first.reasoning, "先想想…");
  assert.strictEqual(second.content, "结论");
  assert.strictEqual(second.reasoning, "再想想。");
});

console.log(`\n通过 ${passed} 项，失败 ${failures.length} 项`);
if (failures.length) {
  failures.forEach(({ name, error }) => console.log(`\n[${name}]\n${error.stack}`));
  process.exit(1);
}
