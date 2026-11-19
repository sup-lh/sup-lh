/**
 * Generate the GitHub profile SVGs (hero + workbench) for light and dark themes.
 *
 * Design synthesis:
 *   - Dark theme:  Swiss Modernist Minimalist Tech (0px sharp geometry, 1px hairline
 *                  grid, Obsidian + Sapphire atmosphere + Neon Jade surgical accent).
 *   - Light theme: Quiet Precision V4 (80% pure-white 1px Swiss open canvas, 20% single
 *                  stationary focal vessel with cold-quartz top beam & stationary 2px
 *                  metallic ridge, 95% obsidian-slate neutrality, zero pill soup).
 *
 * All text is converted to vector outlines so typography renders identically across
 * GitHub web/mobile regardless of installed system fonts.
 *
 * Fonts (all SIL OFL): Geist[wght].ttf, GeistMono[wght].ttf, NotoSansSC[wght].ttf.
 *
 *   pnpm --dir scripts install
 *   node scripts/build.mjs <font-dir> <out-dir>
 */
import fs from "node:fs";
import path from "node:path";
import * as fontkit from "fontkit";

const [, , fontDirArg, outDirArg] = process.argv;
if (!fontDirArg || !outDirArg) {
  console.error("Usage: node scripts/build.mjs <font-dir> <out-dir>");
  process.exit(1);
}

const FONT_DIR = path.resolve(fontDirArg);
const OUT_DIR = path.resolve(outDirArg);

const FONT_FILES = {
  sans: "Geist.ttf",
  mono: "GeistMono.ttf",
  cjk: "NotoSansSC.ttf",
};

const baseFontCache = new Map();
const varFontCache = new Map();

function getFont(key, wght = 400) {
  const cacheKey = `${key}:${wght}`;
  if (varFontCache.has(cacheKey)) return varFontCache.get(cacheKey);

  let base = baseFontCache.get(key);
  if (!base) {
    base = fontkit.openSync(path.join(FONT_DIR, FONT_FILES[key]));
    baseFontCache.set(key, base);
  }
  const clamped = key === "cjk" ? Math.min(Math.max(wght, 400), 700) : wght;
  const inst = base.variationAxes?.wght
    ? base.getVariation({ wght: clamped })
    : base;
  varFontCache.set(cacheKey, inst);
  return inst;
}

function num(v) {
  const s = v.toFixed(1);
  if (s === "-0.0" || s === "0.0") return "0";
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Proportional Latin punctuation that should stay crisp in Geist instead of wide CJK full-width
const PROPORTIONAL_PUNCT = new Set(["·", "–", "↔", "→"]);

/**
 * Split a string into contiguous font runs, choosing main font if it contains
 * the glyph, keeping Latin & middle-dot crisp in Geist, and falling back to Noto Sans SC.
 */
function segmentRuns(str, key, wght) {
  const main = getFont(key, wght);
  const cjk = getFont("cjk", wght);
  const sans = key === "sans" ? main : getFont("sans", wght);

  const runs = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    let chosen;
    if (key === "cjk") {
      if ((cp <= 0x007e || PROPORTIONAL_PUNCT.has(ch)) && ch !== " " && sans.hasGlyphForCodePoint(cp)) {
        chosen = sans;
      } else if (cjk.hasGlyphForCodePoint(cp)) {
        chosen = cjk;
      } else if (sans.hasGlyphForCodePoint(cp)) {
        chosen = sans;
      } else {
        throw new Error(`Missing glyph for U+${cp.toString(16)} (${ch})`);
      }
    } else if (key === "mono" && ch === "·" && sans.hasGlyphForCodePoint(cp)) {
      // Keep middle-dot tight & crisp inside mono metadata strips
      chosen = sans;
    } else if (main.hasGlyphForCodePoint(cp)) {
      chosen = main;
    } else if (cjk.hasGlyphForCodePoint(cp)) {
      chosen = cjk;
    } else if (sans.hasGlyphForCodePoint(cp)) {
      chosen = sans;
    } else {
      throw new Error(`Missing glyph for U+${cp.toString(16)} (${ch})`);
    }

    if (runs.length && runs[runs.length - 1].font === chosen) {
      runs[runs.length - 1].text += ch;
    } else {
      runs.push({ font: chosen, text: ch });
    }
  }
  return runs;
}

function layoutRuns(str, key, size, wght = 400, tracking = 0) {
  const runs = segmentRuns(str, key, wght);
  const items = [];
  let totalW = 0;
  let glyphCount = 0;

  for (const run of runs) {
    const f = run.font;
    const sc = size / f.unitsPerEm;
    const layout = f.layout(run.text, { tnum: true, kern: true });
    for (let i = 0; i < layout.glyphs.length; i++) {
      const g = layout.glyphs[i];
      const pos = layout.positions[i];
      if (g.id === 0 && run.text[i] !== " ") {
        throw new Error(`Notdef glyph encountered in "${str}" at "${run.text[i]}"`);
      }
      items.push({ glyph: g, pos, sc });
      totalW += pos.xAdvance * sc + tracking;
      glyphCount++;
    }
  }
  if (glyphCount > 0) totalW -= tracking;
  return { items, width: totalW };
}

function measure(str, key, size, wght = 400, tracking = 0) {
  if (!str) return 0;
  return layoutRuns(str, key, size, wght, tracking).width;
}

function assertFits(str, key, size, maxW, wght = 400, tracking = 0) {
  const w = measure(str, key, size, wght, tracking);
  if (w > maxW) {
    throw new Error(`Text overflow: "${str}" measured ${w.toFixed(1)}px > max ${maxW}px`);
  }
  return w;
}

function fmtCoords(vals) {
  let out = "";
  for (let i = 0; i < vals.length; i++) {
    const s = num(vals[i]);
    if (i > 0 && !s.startsWith("-")) out += " ";
    out += s;
  }
  return out;
}

function glyphPathD(glyph, sc, ox, oy) {
  const cmds = glyph.path.commands;
  if (!cmds || cmds.length === 0) return "";
  const out = [];
  let lx = null;
  let ly = null;
  let prevCmd = "";

  for (const c of cmds) {
    const a = c.args;
    switch (c.command) {
      case "moveTo": {
        const x = ox + a[0] * sc;
        const y = oy - a[1] * sc;
        out.push(`M${fmtCoords([x, y])}`);
        lx = x;
        ly = y;
        prevCmd = "M";
        break;
      }
      case "lineTo": {
        const x = ox + a[0] * sc;
        const y = oy - a[1] * sc;
        const sx = num(x);
        const sy = num(y);
        if (lx !== null && sx === num(lx) && sy === num(ly)) break;
        if (lx !== null && sy === num(ly)) {
          out.push(prevCmd === "H" ? ` ${sx}` : `H${sx}`);
          prevCmd = "H";
        } else if (lx !== null && sx === num(lx)) {
          out.push(prevCmd === "V" ? ` ${sy}` : `V${sy}`);
          prevCmd = "V";
        } else {
          const coords = fmtCoords([x, y]);
          out.push(prevCmd === "M" || prevCmd === "L" ? (coords.startsWith("-") ? coords : ` ${coords}`) : `L${coords}`);
          prevCmd = "L";
        }
        lx = x;
        ly = y;
        break;
      }
      case "quadraticCurveTo": {
        const x1 = ox + a[0] * sc;
        const y1 = oy - a[1] * sc;
        const x2 = ox + a[2] * sc;
        const y2 = oy - a[3] * sc;
        const coords = fmtCoords([x1, y1, x2, y2]);
        out.push(prevCmd === "Q" ? (coords.startsWith("-") ? coords : ` ${coords}`) : `Q${coords}`);
        lx = x2;
        ly = y2;
        prevCmd = "Q";
        break;
      }
      case "bezierCurveTo": {
        const x1 = ox + a[0] * sc;
        const y1 = oy - a[1] * sc;
        const x2 = ox + a[2] * sc;
        const y2 = oy - a[3] * sc;
        const x3 = ox + a[4] * sc;
        const y3 = oy - a[5] * sc;
        const coords = fmtCoords([x1, y1, x2, y2, x3, y3]);
        out.push(prevCmd === "C" ? (coords.startsWith("-") ? coords : ` ${coords}`) : `C${coords}`);
        lx = x3;
        ly = y3;
        prevCmd = "C";
        break;
      }
      case "closePath":
        out.push("Z");
        prevCmd = "Z";
        break;
    }
  }
  return out.join("");
}

function text(
  str,
  key,
  size,
  x,
  y,
  fill,
  { wght = 400, tracking = 0, anchor = "start", attrs = "" } = {}
) {
  if (!str) return "";
  const { items, width } = layoutRuns(str, key, size, wght, tracking);
  let cx = x;
  if (anchor === "end") cx -= width;
  else if (anchor === "middle") cx -= width / 2;

  const parts = [];
  for (const { glyph, pos, sc } of items) {
    const ox = cx + (pos.xOffset || 0) * sc;
    const oy = y - (pos.yOffset || 0) * sc;
    const d = glyphPathD(glyph, sc, ox, oy);
    if (d) parts.push(d);
    cx += pos.xAdvance * sc + tracking;
  }
  if (!parts.length) return "";
  return `<path fill="${fill}"${attrs ? " " + attrs : ""} d="${parts.join("")}"/>`;
}

function wrap(str, key, size, maxW, wght = 400, tracking = 0) {
  const tokens = str.match(/[A-Za-z0-9~./+\-]+|\s+|./g) || [];
  const noLineStart = new Set([..."，。、；：）·—！？】》"]);
  const lines = [];
  let cur = "";
  for (const tok of tokens) {
    if (
      cur &&
      measure(cur + tok, key, size, wght, tracking) > maxW &&
      !noLineStart.has(tok)
    ) {
      lines.push(cur.trimEnd());
      cur = tok.trimStart();
    } else {
      cur += tok;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function para(str, key, size, x, y, maxW, fill, { wght = 400, lh = 22, tracking = 0.2, maxLines = 4 } = {}) {
  const lines = wrap(str, key, size, maxW, wght, tracking);
  if (lines.length > maxLines) {
    throw new Error(`Paragraph exceeded ${maxLines} lines (${lines.length}): "${str}" -> ${JSON.stringify(lines)}`);
  }
  return lines
    .map((line, i) => text(line, key, size, x, y + i * lh, fill, { wght, tracking }))
    .join("");
}

// ---------------------------------------------------------------------------
// 1.45px Geometric AI & Workbench Symbols (Quiet Precision V4 exact paths)
// ---------------------------------------------------------------------------

function iconGroup(x, y, size, color, inner, attrs = "") {
  const s = size / 16;
  return (
    `<g transform="translate(${num(x)} ${num(y)}) scale(${num(s)})" ` +
    `fill="none" stroke="${color}" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"${attrs ? " " + attrs : ""}>` +
    inner +
    `</g>`
  );
}

const ICONS = {
  orderPrism: (x, y, size, color) =>
    iconGroup(
      x,
      y,
      size,
      color,
      `<path d="M8 1.75 13.75 5v6L8 14.25 2.25 11V5L8 1.75Z"/>` +
        `<path d="M8 1.75V8m0 0 5.75 3M8 8 2.25 11" opacity=".55"/>` +
        `<circle cx="8" cy="8" r="1.65" fill="${color}" stroke="none"/>`
    ),
  causalSplit: (x, y, size, color) =>
    iconGroup(
      x,
      y,
      size,
      color,
      `<path d="M8 2.25v11.5" opacity=".5"/>` +
        `<path d="M8 5.25h4.75M8 8.25H3.5M8 11.25h3.25"/>` +
        `<circle cx="12.75" cy="5.25" r="1.15" fill="${color}" stroke="none"/>` +
        `<circle cx="3.5" cy="8.25" r="1.15" fill="${color}" stroke="none"/>`
    ),
  evidenceTrace: (x, y, size, color) =>
    iconGroup(
      x,
      y,
      size,
      color,
      `<path d="M4.75 3.25H3A1.25 1.25 0 0 0 1.75 4.5v7A1.25 1.25 0 0 0 3 12.75h1.75M11.25 3.25H13A1.25 1.25 0 0 1 14.25 4.5v7A1.25 1.25 0 0 1 13 12.75h-1.75M5.75 8h4.5"/>` +
        `<circle cx="8" cy="8" r="1.35" fill="${color}" stroke="none"/>`
    ),
  anomalyBeacon: (x, y, size, color) =>
    iconGroup(
      x,
      y,
      size,
      color,
      `<path d="M8 2 14 8l-6 6-6-6 6-6Z"/>` +
        `<circle cx="8" cy="8" r="1.5" fill="${color}" stroke="none"/>`
    ),
  playbookVector: (x, y, size, color) =>
    iconGroup(
      x,
      y,
      size,
      color,
      `<path d="M3.5 12.5 12.5 3.5M6.25 3.5h6.25v6.25"/>`
    ),
};

function hline(x1, x2, y, color) {
  return `<line x1="${num(x1)}" y1="${num(y + 0.5)}" x2="${num(x2)}" y2="${num(y + 0.5)}" stroke="${color}" stroke-width="1" shape-rendering="crispEdges"/>`;
}

function vline(x, y1, y2, color) {
  return `<line x1="${num(x + 0.5)}" y1="${num(y1)}" x2="${num(x + 0.5)}" y2="${num(y2)}" stroke="${color}" stroke-width="1" shape-rendering="crispEdges"/>`;
}

function checkMark(x, y, color, cls = "") {
  return `<path${cls ? ` class="${cls}"` : ""} d="M${num(x)} ${num(y)} l3.8 3.8 l7.4 -8.2" fill="none" stroke="${color}" stroke-width="1.65" stroke-linecap="square" stroke-linejoin="miter"/>`;
}

function wrapSvg(w, h, title, body, css = "") {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" ` +
    `role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>` +
    (css ? `<style>${css}</style>` : "") +
    body +
    `</svg>\n`
  );
}

// ---------------------------------------------------------------------------
// Independent Theme Calibration (NEVER naive CSS invert!)
//   - Light: Quiet Precision V4 (Pure White #FFFFFF + Cold Quartz #F8FAFC + Obsidian #090E18 + Cobalt #2563EB)
//   - Dark:  Transform9 Swiss Modernist (Obsidian #020801/#080B0E + Sapphire Atmosphere + Neon Jade #A2FA8E)
// ---------------------------------------------------------------------------

const THEMES = {
  light: {
    mode: "light",
    heroBg: "#ffffff",
    canvas: "#ffffff",
    subtle: "#f8fafc",
    track: "#f1f4f8",
    rowActive: "#f6f8fb",
    rule: "#e4e9f0",
    ruleSoft: "#edf1f6",
    borderStrong: "#cbd5e1",
    checkIdle: "#cbd5e1",
    ink: "#090e18",
    body: "#1e293b",
    muted: "#64748b",
    faint: "#94a3b8",
    accent: "#2563eb",
    accentInk: "#ffffff",
    accentSoft: "#2563eb0f",
    liveDot: "#0d9488",
    infoDot: "#2563eb",
    gridLine: "rgba(9,14,24,0.032)",
    atmoA: "#dce7fa",
    atmoB: "#eff6ff",
    atmoC: "#dbeafe",
    ridgeStops: ["#090e18", "#1e40af", "#2563eb", "#1e40af", "#090e18"],
    vesselFill: "#ffffff",
    vesselShadow: "rgba(9,14,24,0.08)",
    vesselShadowSm: "rgba(9,14,24,0.03)",
    ctaFill: "#090e18",
    ctaInk: "#ffffff",
    citeBg: "#f1f5f9",
    citeDash: "#cbd5e1",
    citeSolid: "#090e18",
    supBg: "#f1f4f8",
    supInk: "#475569",
    supActiveBg: "#090e18",
    supActiveInk: "#ffffff",
    filament: "#090e18",
    barBase: "#cbd5e1",
    barPeak: "#2563eb",
    spectrum: [
      { fill: "#090e18", ink: "#ffffff", hatch: false },
      { fill: "#1e40af", ink: "#ffffff", hatch: false },
      { fill: "#475569", ink: "#ffffff", hatch: true },
      { fill: "#0f766e", ink: "#ffffff", hatch: false },
    ],
    hatchColor: "rgba(255,255,255,0.22)",
  },
  dark: {
    mode: "dark",
    heroBg: "#020801",
    canvas: "#080b0e",
    subtle: "#10161e",
    track: "#151d27",
    rowActive: "#0e151d",
    rule: "#232c36",
    ruleSoft: "#171f28",
    borderStrong: "#2f3d4d",
    checkIdle: "#364556",
    ink: "#f8fafc",
    body: "#cbd5e1",
    muted: "#8494a7",
    faint: "#58687c",
    accent: "#a2fa8e",
    accentInk: "#020801",
    accentSoft: "rgba(162,250,142,0.075)",
    liveDot: "#a2fa8e",
    infoDot: "#38bdf8",
    gridLine: "rgba(255,255,255,0.04)",
    atmoA: "#0042ac",
    atmoB: "#001a6a",
    atmoC: "#168ae2",
    ridgeStops: ["#10161e", "#0042ac", "#168ae2", "#a2fa8e", "#168ae2", "#10161e"],
    vesselFill: "#0c1117",
    vesselShadow: "rgba(0,0,0,0.48)",
    vesselShadowSm: "rgba(0,0,0,0.22)",
    ctaFill: "#a2fa8e",
    ctaInk: "#020801",
    citeBg: "rgba(162,250,142,0.10)",
    citeDash: "#364659",
    citeSolid: "#a2fa8e",
    supBg: "#18222e",
    supInk: "#94a3b8",
    supActiveBg: "#a2fa8e",
    supActiveInk: "#020801",
    filament: "#a2fa8e",
    barBase: "#283442",
    barPeak: "#a2fa8e",
    spectrum: [
      { fill: "#1d4ed8", ink: "#ffffff", hatch: false },
      { fill: "#0f766e", ink: "#ffffff", hatch: false },
      { fill: "#334155", ink: "#f8fafc", hatch: true },
      { fill: "#a2fa8e", ink: "#020801", hatch: false },
    ],
    hatchColor: "rgba(255,255,255,0.16)",
  },
};

const W = 1200;

// ---------------------------------------------------------------------------
// Data (100% Verified from sup-lh GitHub Account & Public Repositories)
// ---------------------------------------------------------------------------

const PIPELINE = [
  ["01", "感知与采集", "BLE 硬件 · 飞书 · 电商后台 · Win32"],
  ["02", "归因与推演", "确定性因子拆解 · LLM · 本地 Whisper"],
  ["03", "执行与路由", "Agent Skills · 桌面自动化 · 安全投递"],
  ["04", "闭环与交付", "经营驾驶舱 · 原生工具 · 复查沉淀"],
];

const HERO_METRICS = [
  {
    idx: "01 / DELIVERY",
    value: "50",
    suffix: "+",
    tag: "",
    caption: "企业 AI 场景从需求拆解到上线",
    monoCaption: false,
  },
  {
    idx: "02 / ORIGINAL REPOS",
    value: "62",
    suffix: "",
    tag: "25 IN 2026",
    caption: "2021–2026 原创工程仓库",
    monoCaption: false,
  },
  {
    idx: "03 / OPEN SOURCE",
    value: "03",
    suffix: "",
    tag: "PUBLIC",
    caption: "airdrop-win · beanbridge · salesup",
    monoCaption: true,
  },
  {
    idx: "04 / DESIGN SYSTEM",
    value: "V4",
    suffix: "",
    tag: "SWISS · QP",
    caption: "1px 细线画布与人机归因规范",
    monoCaption: false,
  },
];

const LEDGER_ROWS = [
  {
    name: "airdrop-win",
    meta: "v1.0.0 · PUBLIC",
    status: "live",
    desc: "Windows ↔ Apple 局域网高速互传与双向剪贴板",
    stack: "Go · TypeScript · Win32 · PWA · Shortcuts",
    spec: "~9 MB 单文件",
    specSub: "零依赖 · 免装 App",
    active: true,
  },
  {
    name: "beanbridge",
    meta: "v0.5.1 · PUBLIC",
    status: "live",
    desc: "安克 D3200 蓝牙纯内存 Whisper 转写与安全路由",
    stack: "Swift · AppKit · BLE · whisper.cpp · Python",
    spec: "65 项测试",
    specSub: "Apple Silicon 原生",
    active: false,
  },
  {
    name: "salesup",
    meta: "FULL-STACK · PUBLIC",
    status: "info",
    desc: "销售新人培养闯关、课程考核、复盘与数据看板",
    stack: "React · NestJS · PostgreSQL · MinIO · Docker",
    spec: "Monorepo",
    specSub: "全栈生产部署",
    active: false,
  },
  {
    name: "经营归因工作台",
    meta: "COMMERCIAL · PRIVATE",
    status: "private",
    desc: "跨境多店经营驾驶舱、异常检测与 3 秒人机拍板",
    stack: "Go · React · TypeScript · PostgreSQL · 飞书",
    spec: "AI 闭环",
    specSub: "确定性拆解 + 溯源",
    active: false,
  },
  {
    name: "Agent & 自动化",
    meta: "SYSTEMS · PRIVATE",
    status: "private",
    desc: "设计规范 Skills、跨境采集分析与 AI 视频流水线",
    stack: "MCP · Playwright · CDP · Seedance · pgvector",
    spec: "50+ 场景",
    specSub: "从拆解到上线交付",
    active: false,
  },
];

const PILLARS = [
  {
    idx: "01",
    label: "企业 AI 工作台",
    title: "可溯源经营驾驶舱",
    desc: "异常检测、确定性因子拆解、可追溯 RAG 知识库，以及飞书多维表格与审批闭环。",
    spec: "GO · REACT · PGVECTOR",
  },
  {
    idx: "02",
    label: "原生工具与硬件",
    title: "零依赖跨端器物",
    desc: "macOS 蓝牙纯内存 Whisper 转写工作台；Windows 单文件 Go 隔空传与双向剪贴板。",
    spec: "SWIFT · WIN32 · BLE",
  },
  {
    idx: "03",
    label: "Agent 与 Skills",
    title: "让模型操作真实软件",
    desc: "Computer-Use 桌面与浏览器智能体，沉淀 Swiss / Quiet Precision 设计规范。",
    spec: "MCP · CDP · PLAYWRIGHT",
  },
  {
    idx: "04",
    label: "跨境与 AI 产线",
    title: "数据管道与内容生成",
    desc: "TikTok 运营采集与广告异常告警；脚本、分镜、图生视频到剪辑的自动化流水线。",
    spec: "SEEDANCE · KLING · FFMPEG",
  },
];

const SPECTRUM_ITEMS = [
  { name: "企业工作台与业务系统", count: 9, pct: 36 },
  { name: "Agent 工程与 Skills", count: 6, pct: 24 },
  { name: "跨境数据与 AI 产线", count: 6, pct: 24 },
  { name: "跨端原生工具与硬件", count: 4, pct: 16 },
];

const TRAJECTORY = [
  { yr: "2021", count: 3, cap: "Java 起步" },
  { yr: "2022", count: 4, cap: "校园小程序" },
  { yr: "2024", count: 10, cap: "政企系统" },
  { yr: "2025", count: 19, cap: "AI 平台" },
  { yr: "2026", count: 26, cap: "工作台 & 原生", peak: true },
];

const STACK = [
  ["LANGUAGES", "Go · TypeScript · Swift · Python · Java"],
  ["SYSTEMS & UI", "React · Next.js · AppKit · Gin · NestJS"],
  ["AI & DATA", "PostgreSQL · pgvector · whisper.cpp · MCP"],
  ["ECOSYSTEM", "飞书生态 · Win32 · BLE · Docker"],
];

// ---------------------------------------------------------------------------
// SVG 1: Hero (1200 x 524, Strict 0px Swiss Modernist Architecture)
// ---------------------------------------------------------------------------

function buildHero(t) {
  const H = 524;
  const splitX = 736;
  const topH = 48;
  const midBottom = 370;
  const p = [];

  const atmoDefs =
    t.mode === "dark"
      ? `<radialGradient id="atmo1" cx="78%" cy="22%" r="58%">` +
        `<stop offset="0%" stop-color="${t.atmoA}" stop-opacity="0.44"/>` +
        `<stop offset="52%" stop-color="${t.atmoB}" stop-opacity="0.22"/>` +
        `<stop offset="100%" stop-color="${t.heroBg}" stop-opacity="0"/>` +
        `</radialGradient>` +
        `<radialGradient id="atmo2" cx="95%" cy="8%" r="36%">` +
        `<stop offset="0%" stop-color="${t.atmoC}" stop-opacity="0.22"/>` +
        `<stop offset="100%" stop-color="${t.heroBg}" stop-opacity="0"/>` +
        `</radialGradient>` +
        `<radialGradient id="atmo3" cx="22%" cy="56%" r="38%">` +
        `<stop offset="0%" stop-color="${t.accent}" stop-opacity="0.05"/>` +
        `<stop offset="100%" stop-color="${t.heroBg}" stop-opacity="0"/>` +
        `</radialGradient>`
      : `<radialGradient id="atmo1" cx="84%" cy="18%" r="50%">` +
        `<stop offset="0%" stop-color="${t.atmoA}" stop-opacity="0.46"/>` +
        `<stop offset="55%" stop-color="${t.atmoB}" stop-opacity="0.22"/>` +
        `<stop offset="100%" stop-color="${t.heroBg}" stop-opacity="0"/>` +
        `</radialGradient>` +
        `<radialGradient id="atmo2" cx="18%" cy="15%" r="36%">` +
        `<stop offset="0%" stop-color="${t.atmoC}" stop-opacity="0.16"/>` +
        `<stop offset="100%" stop-color="${t.heroBg}" stop-opacity="0"/>` +
        `</radialGradient>`;

  p.push(
    `<defs>` +
      `<pattern id="tech-grid" width="40" height="40" patternUnits="userSpaceOnUse">` +
      `<path d="M40 0H0V40" fill="none" stroke="${t.gridLine}" stroke-width="1"/>` +
      `</pattern>` +
      atmoDefs +
      `<clipPath id="mid-clip"><rect x="1" y="${topH + 1}" width="${W - 2}" height="${midBottom - topH - 1}"/></clipPath>` +
      `</defs>`
  );

  p.push(`<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="${t.heroBg}" stroke="${t.rule}" stroke-width="1" shape-rendering="crispEdges"/>`);
  p.push(`<g clip-path="url(#mid-clip)">`);
  p.push(`<rect x="1" y="${topH + 1}" width="${W - 2}" height="${midBottom - topH - 1}" fill="url(#atmo1)"/>`);
  p.push(`<rect x="1" y="${topH + 1}" width="${W - 2}" height="${midBottom - topH - 1}" fill="url(#atmo2)"/>`);
  if (t.mode === "dark") {
    p.push(`<rect x="1" y="${topH + 1}" width="${W - 2}" height="${midBottom - topH - 1}" fill="url(#atmo3)"/>`);
  }
  p.push(`<rect x="1" y="${topH + 1}" width="${W - 2}" height="${midBottom - topH - 1}" fill="url(#tech-grid)"/>`);
  p.push(`</g>`);

  // Shared 1px structural rails
  p.push(hline(1, W - 1, topH, t.rule));
  p.push(hline(1, W - 1, midBottom, t.rule));
  p.push(vline(splitX, topH + 1, midBottom, t.rule));
  for (let i = 1; i < 4; i++) {
    p.push(vline(i * (W / 4), midBottom + 1, H - 1, t.rule));
  }

  // ---- Top Architectural Rail (y = 0..48)
  p.push(ICONS.orderPrism(32, 16, 16, t.ink));
  p.push(text("LOWKII / SUP-LH", "mono", 12.5, 58, 28.5, t.ink, { wght: 600, tracking: 1.6 }));
  p.push(vline(236, 16, 32, t.rule));
  p.push(text("AI SYSTEMS & NATIVE TOOLS", "mono", 11.5, 254, 28.5, t.muted, { wght: 400, tracking: 1.5 }));

  const rightStatus = "EST. 2021 · 62 REPOS · 2026 ACTIVE";
  const rightStatusW = measure(rightStatus, "mono", 11.5, 500, 1.3);
  p.push(`<circle cx="${num(W - 32 - rightStatusW - 12)}" cy="24" r="3" fill="${t.liveDot}" class="pulse"/>`);
  p.push(text(rightStatus, "mono", 11.5, W - 32, 28.5, t.muted, { wght: 500, tracking: 1.3, anchor: "end" }));

  // ---- Left Column (x = 0..736)
  p.push(text("00 / PROFILE", "mono", 11.5, 32, 84, t.faint, { wght: 500, tracking: 1.8 }));

  const wmSize = 128;
  const wmX = 26;
  const wmY = 212;
  const wmW = measure("Lowkii", "sans", wmSize, 400, -4.6);
  p.push(text("Lowkii", "sans", wmSize, wmX, wmY, t.ink, { wght: 400, tracking: -4.6 }));
  p.push(`<rect x="${num(wmX + wmW + 10)}" y="${num(wmY - 18)}" width="18" height="18" fill="${t.accent}"/>`);

  p.push(text("把 AI 落进真实业务与原生工具的全栈工程师。", "cjk", 24, 32, 272, t.ink, { wght: 500, tracking: 0.3 }));
  p.push(
    text("Enterprise AI workbenches, autonomous agents, and native cross-platform instruments.", "sans", 15, 32, 306, t.muted, {
      wght: 400,
    })
  );
  p.push(text("GO · TYPESCRIPT · SWIFT · PYTHON · FEISHU · MCP", "mono", 11.5, 32, 342, t.faint, { wght: 500, tracking: 1.5 }));

  // ---- Right Column (x = 736..1200): 0px Hairline Execution Loop
  const rx = splitX;
  const rw = W - rx - 1;
  const subH = 44;
  const stageTop = topH + subH;
  const rowH = (midBottom - stageTop) / 4;

  p.push(hline(rx + 1, W - 1, stageTop, t.rule));
  p.push(ICONS.causalSplit(rx + 24, topH + 14.5, 15, t.muted));
  p.push(text("EXECUTION LOOP", "mono", 11.5, rx + 48, topH + 26.5, t.muted, { wght: 500, tracking: 1.6 }));

  const runW = measure("RUNNING", "mono", 11.5, 600, 1.6);
  p.push(`<circle cx="${num(W - 32 - runW - 10)}" cy="${num(topH + 22)}" r="3" fill="${t.liveDot}" class="pulse"/>`);
  p.push(text("RUNNING", "mono", 11.5, W - 32, topH + 26.5, t.mode === "dark" ? t.accent : t.liveDot, { wght: 600, tracking: 1.6, anchor: "end" }));

  p.push(
    `<g class="hl">` +
      `<rect x="${rx + 1}" y="${num(stageTop + 1)}" width="${rw - 1}" height="${num(rowH - 1)}" fill="${t.accentSoft}"/>` +
      `<rect x="${rx + 10}" y="${num(stageTop + 16)}" width="2" height="${num(rowH - 32)}" rx="1" fill="${t.filament}"/>` +
      `</g>`
  );

  PIPELINE.forEach(([idx, title, detail], i) => {
    const ry = stageTop + i * rowH;
    if (i > 0) p.push(hline(rx + 1, W - 1, ry, t.ruleSoft));
    p.push(text(idx, "mono", 12, rx + 24, ry + 30, t.faint, { wght: 500, tracking: 1 }));
    p.push(text(idx, "mono", 12, rx + 24, ry + 30, t.accent, { wght: 600, tracking: 1, attrs: `class="n${i}"` }));
    p.push(text(title, "cjk", 16.5, rx + 58, ry + 30, t.ink, { wght: 500, tracking: 0.3 }));
    p.push(text(detail, "cjk", 12.5, rx + 58, ry + 52, t.muted, { wght: 400, tracking: 0.1 }));
    p.push(checkMark(W - 44, ry + 33, t.checkIdle));
    p.push(checkMark(W - 44, ry + 33, t.mode === "dark" ? t.accent : t.liveDot, `n${i}`));
  });

  // ---- Bottom Row (y = 370..524): 01-04 Indexed Proven Results Rail
  const colW = W / 4;
  HERO_METRICS.forEach((m, i) => {
    const cx = i * colW + 28;
    p.push(text(m.idx, "mono", 11, cx, midBottom + 28, t.faint, { wght: 500, tracking: 1.5 }));

    const valY = midBottom + 98;
    p.push(text(m.value, "sans", 48, cx - 2, valY, t.ink, { wght: 400, tracking: -1.8 }));
    const vw = measure(m.value, "sans", 48, 400, -1.8);

    if (m.suffix) {
      p.push(text(m.suffix, "sans", 44, cx - 2 + vw + 2, valY - 2, t.accent, { wght: 400 }));
    } else if (m.tag) {
      const tx = cx - 2 + vw + 12;
      if (m.tag === "PUBLIC") {
        p.push(`<circle cx="${num(tx + 3)}" cy="${num(valY - 6)}" r="3" fill="${t.liveDot}"/>`);
        p.push(text(m.tag, "mono", 11.5, tx + 12, valY - 2, t.muted, { wght: 500, tracking: 1.3 }));
      } else {
        p.push(
          text(m.tag, "mono", 11.5, tx, valY - 2, m.tag.includes("2026") ? (t.mode === "dark" ? t.accent : t.liveDot) : t.muted, {
            wght: 500,
            tracking: 1.2,
          })
        );
      }
    }

    assertFits(m.caption, m.monoCaption ? "mono" : "cjk", m.monoCaption ? 11.5 : 13, colW - 52, 400, m.monoCaption ? 0.2 : 0.2);
    p.push(
      text(m.caption, m.monoCaption ? "mono" : "cjk", m.monoCaption ? 11.5 : 13, cx, midBottom + 130, t.muted, {
        wght: 400,
        tracking: 0.2,
      })
    );
  });

  const CYCLE = 8.0;
  const slot = 100 / 5;
  const cssParts = [
    `.pulse{animation:pulse 2.4s ease-in-out infinite}`,
    `@keyframes pulse{0%,100%{opacity:1}50%{opacity:.28}}`,
    `.hl{animation:hl ${CYCLE}s cubic-bezier(.22,1,.36,1) infinite}`,
    `@keyframes hl{` +
      [0, 1, 2, 3]
        .map(
          (i) =>
            `${num(slot * i)}%,${num(slot * i + slot * 0.78)}%{transform:translateY(${num(rowH * i)}px);opacity:1}`
        )
        .join("") +
      `92%{transform:translateY(${num(rowH * 3)}px);opacity:1}100%{transform:translateY(${num(rowH * 3)}px);opacity:0}}`,
  ];
  for (let i = 0; i < 4; i++) {
    const on = slot * i + slot * 0.45;
    cssParts.push(
      `.n${i}{opacity:0;animation:n${i} ${CYCLE}s ease-out infinite}`,
      `@keyframes n${i}{0%,${num(on - 1)}%{opacity:0}${num(on + 3)}%,92%{opacity:1}100%{opacity:0}}`
    );
  }
  cssParts.push(`@media (prefers-reduced-motion:reduce){*{animation:none!important}.n0,.n1,.n2,.n3{opacity:1}}`);

  return wrapSvg(
    W,
    H,
    "Lowkii (sup-lh) — 把 AI 落进真实业务与原生工具的全栈工程师",
    p.join(""),
    cssParts.join("")
  );
}

// ---------------------------------------------------------------------------
// SVG 2: Quiet Precision Workbench (1200 x 928)
//   80% Continuous 1px Swiss Open-Canvas + 20% Single Stationary Focal Vessel
// ---------------------------------------------------------------------------

function buildWorkbench(t) {
  const H = 928;
  const band1H = 408;
  const band2H = 198; // y = 408 .. 606
  const band3H = 224; // y = 606 .. 830
  // band4: y = 830 .. 928 (98px)
  const split1X = 744;
  const split3X = 696;
  const p = [];

  const ridgeStops = t.ridgeStops
    .map((c, idx) => `<stop offset="${num((idx / (t.ridgeStops.length - 1)) * 100)}%" stop-color="${c}"/>`)
    .join("");

  p.push(
    `<defs>` +
      `<linearGradient id="metallic-ridge" x1="0%" y1="0%" x2="100%" y2="0%">${ridgeStops}</linearGradient>` +
      `<filter id="vessel-shadow" x="-6%" y="-6%" width="112%" height="118%">` +
      `<feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="${t.vesselShadowSm}"/>` +
      `<feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="${t.vesselShadow}"/>` +
      `</filter>` +
      `<pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">` +
      `<line x1="0" y1="0" x2="0" y2="8" stroke="${t.hatchColor}" stroke-width="2"/>` +
      `</pattern>` +
      `</defs>`
  );

  // Continuous 0px Swiss Open-Canvas Sheet
  p.push(`<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="${t.canvas}" stroke="${t.rule}" stroke-width="1" shape-rendering="crispEdges"/>`);

  // Master horizontal shared 1px rails
  p.push(hline(1, W - 1, band1H, t.rule));
  p.push(hline(1, W - 1, band1H + band2H, t.rule));
  p.push(hline(1, W - 1, band1H + band2H + band3H, t.rule));

  // Master vertical shared 1px rails
  p.push(vline(split1X, 1, band1H, t.rule));
  for (let i = 1; i < 4; i++) {
    p.push(vline(i * (W / 4), band1H + 1, band1H + band2H, t.rule));
    p.push(vline(i * (W / 4), band1H + band2H + band3H + 1, H - 1, t.rule));
  }
  p.push(vline(split3X, band1H + band2H + 1, band1H + band2H + band3H, t.rule));

  // =========================================================================
  // BAND 1 LEFT (x = 0..744): High-Signal Repository & Delivery Ledger
  // =========================================================================
  const headerH = 46;
  const colHdrH = 32;
  p.push(hline(1, split1X, headerH, t.rule));
  p.push(hline(1, split1X, headerH + colHdrH, t.ruleSoft));

  p.push(ICONS.evidenceTrace(28, 15.5, 15, t.muted));
  p.push(text("01 / SHIPPED REPOSITORIES & DELIVERY LEDGER", "mono", 11.5, 52, 27, t.muted, { wght: 500, tracking: 1.5 }));
  p.push(text("3 PUBLIC · 59 PRIVATE", "mono", 11, split1X - 28, 27, t.faint, { wght: 500, tracking: 1.2, anchor: "end" }));

  const thY = headerH + 20;
  p.push(text("PROJECT", "mono", 10.5, 28, thY, t.faint, { wght: 500, tracking: 1.4 }));
  p.push(text("ARCHITECTURE & SCOPE", "mono", 10.5, 226, thY, t.faint, { wght: 500, tracking: 1.4 }));
  p.push(text("VERIFIED SPEC", "mono", 10.5, split1X - 28, thY, t.faint, { wght: 500, tracking: 1.4, anchor: "end" }));

  const rowStart = headerH + colHdrH;
  const rowH = (band1H - rowStart) / LEDGER_ROWS.length;

  LEDGER_ROWS.forEach((r, i) => {
    const ry = rowStart + i * rowH;
    if (i > 0) p.push(hline(1, split1X, ry, t.ruleSoft));

    if (r.active) {
      p.push(`<rect x="1" y="${num(ry + 1)}" width="${split1X - 1}" height="${num(rowH - 1)}" fill="${t.rowActive}"/>`);
      p.push(`<rect x="12" y="${num(ry + 15)}" width="2" height="${num(rowH - 30)}" rx="1" fill="${t.filament}"/>`);
    }

    const dotCx = 31;
    const dotCy = ry + 24.5;
    if (r.status === "live") {
      p.push(`<circle cx="${dotCx}" cy="${dotCy}" r="3" fill="${t.liveDot}"/>`);
    } else if (r.status === "info") {
      p.push(`<circle cx="${dotCx}" cy="${dotCy}" r="3" fill="${t.infoDot}"/>`);
    } else {
      p.push(`<circle cx="${dotCx}" cy="${dotCy}" r="2.75" fill="none" stroke="${t.faint}" stroke-width="1.3"/>`);
    }

    const isCjkName = /[\u4e00-\u9fff]/.test(r.name);
    p.push(text(r.name, isCjkName ? "cjk" : "sans", 14.5, 44, ry + 29, t.ink, { wght: 600, tracking: isCjkName ? 0.2 : -0.2 }));
    p.push(text(r.meta, "mono", 10.5, 44, ry + 49, r.status === "private" ? t.faint : t.muted, { wght: 500, tracking: 0.9 }));

    assertFits(r.desc, "cjk", 13.2, 360, 400, 0.15);
    p.push(text(r.desc, "cjk", 13.2, 226, ry + 29, t.body, { wght: 400, tracking: 0.15 }));
    p.push(text(r.stack, "mono", 10.8, 226, ry + 49, t.faint, { wght: 400, tracking: 0.2 }));

    p.push(text(r.spec, "cjk", 13, split1X - 28, ry + 29, r.active ? t.ink : t.body, { wght: 600, anchor: "end" }));
    p.push(text(r.specSub, "cjk", 11, split1X - 28, ry + 49, t.muted, { wght: 400, anchor: "end" }));
  });

  // =========================================================================
  // BAND 1 RIGHT (x = 744..1200): THE SINGLE STATIONARY FOCAL VESSEL (20%)
  // =========================================================================
  const vx = split1X + 24;
  const vy = 22;
  const vw = W - split1X - 48; // 408
  const vh = band1H - 44; // 364
  const beamH = 44;

  p.push(`<g>`);
  p.push(
    `<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" rx="10" ` +
      `fill="${t.vesselFill}" stroke="${t.borderStrong}" stroke-width="1" filter="url(#vessel-shadow)"/>`
  );
  p.push(
    `<path d="M${vx + 10} ${vy + 0.5} H${vx + vw - 10} Q${vx + vw - 0.5} ${vy + 0.5} ${vx + vw - 0.5} ${vy + 10} ` +
      `V${vy + beamH} H${vx + 0.5} V${vy + 10} Q${vx + 0.5} ${vy + 0.5} ${vx + 10} ${vy + 0.5} Z" fill="${t.subtle}"/>`
  );
  // Stationary 2px Metallic Highlight Ridge on Cold Quartz Top Beam bottom edge
  p.push(`<rect x="${vx + 1}" y="${vy + beamH}" width="${vw - 2}" height="2" fill="url(#metallic-ridge)"/>`);

  p.push(ICONS.orderPrism(vx + 18, vy + 14.5, 15, t.ink));
  p.push(text("ENGINEERING DOCTRINE", "mono", 11, vx + 40, vy + 26, t.ink, { wght: 600, tracking: 1.4 }));

  const tagText = "QP · V4";
  const tagW = measure(tagText, "mono", 10.5, 500, 1.1) + 16;
  p.push(`<rect x="${num(vx + vw - 16 - tagW)}" y="${vy + 11.5}" width="${num(tagW)}" height="21" rx="5" fill="${t.track}" stroke="${t.rule}" stroke-width="1"/>`);
  p.push(text(tagText, "mono", 10.5, vx + vw - 16 - tagW / 2, vy + 25.5, t.muted, { wght: 500, tracking: 1.1, anchor: "middle" }));

  // Interior Zone A: Unbroken Inline Superscript Attribution Statement
  const ix = vx + 20;
  p.push(text("ATTRIBUTION & CRAFT", "mono", 10.5, ix, vy + 70, t.faint, { wght: 500, tracking: 1.5 }));

  const citeSize = 13.5;
  const citeLh = 26;
  const ly0 = vy + 98;

  p.push(text("不堆砌对话气泡与圆角卡片——把大模型", "cjk", citeSize, ix, ly0, t.body, { wght: 400, tracking: 0.2 }));

  // Line 2 with [1] dashed-underline inline superscript citation (tight punctuation!)
  const l2Pre = "编织为 ";
  const l2Phrase = "可溯源的业务因果组件";
  const l2Post = "，再以";
  let cx2 = ix;
  p.push(text(l2Pre, "cjk", citeSize, cx2, ly0 + citeLh, t.body, { wght: 400, tracking: 0.2 }));
  cx2 += measure(l2Pre, "cjk", citeSize, 400, 0.2);
  const w2 = measure(l2Phrase, "cjk", citeSize, 500, 0.2);
  p.push(text(l2Phrase, "cjk", citeSize, cx2, ly0 + citeLh, t.ink, { wght: 500, tracking: 0.2 }));
  p.push(
    `<line x1="${num(cx2)}" y1="${num(ly0 + citeLh + 4.5)}" x2="${num(cx2 + w2)}" y2="${num(ly0 + citeLh + 4.5)}" ` +
      `stroke="${t.citeDash}" stroke-width="1" stroke-dasharray="2.5 2"/>`
  );
  const sup1X = cx2 + w2 + 3;
  const sup1Y = ly0 + citeLh - 15;
  p.push(`<rect x="${num(sup1X)}" y="${num(sup1Y)}" width="15" height="15" rx="3" fill="${t.supBg}" stroke="${t.rule}" stroke-width="1"/>`);
  p.push(text("1", "mono", 9.5, sup1X + 7.5, sup1Y + 11.2, t.supInk, { wght: 600, anchor: "middle" }));
  p.push(text(l2Post, "cjk", citeSize, sup1X + 17, ly0 + citeLh, t.body, { wght: 400, tracking: 0.2 }));

  // Line 3 with [2] active solid-underline highlighted inline superscript citation
  const l3Phrase = "零冗余原生交互与人机闭环";
  const l3Post = " 交付。";
  const w3 = measure(l3Phrase, "cjk", citeSize, 500, 0.2);
  p.push(`<rect x="${num(ix - 3)}" y="${num(ly0 + citeLh * 2 - 14.5)}" width="${num(w3 + 6)}" height="20" rx="3" fill="${t.citeBg}"/>`);
  p.push(text(l3Phrase, "cjk", citeSize, ix, ly0 + citeLh * 2, t.ink, { wght: 500, tracking: 0.2 }));
  p.push(
    `<line x1="${num(ix)}" y1="${num(ly0 + citeLh * 2 + 4.5)}" x2="${num(ix + w3)}" y2="${num(ly0 + citeLh * 2 + 4.5)}" ` +
      `stroke="${t.citeSolid}" stroke-width="1.2"/>`
  );
  const sup2X = ix + w3 + 4;
  const sup2Y = ly0 + citeLh * 2 - 15;
  p.push(`<rect x="${num(sup2X)}" y="${num(sup2Y)}" width="15" height="15" rx="3" fill="${t.supActiveBg}"/>`);
  p.push(text("2", "mono", 9.5, sup2X + 7.5, sup2Y + 11.2, t.supActiveInk, { wght: 600, anchor: "middle" }));
  p.push(text(l3Post, "cjk", citeSize, sup2X + 17, ly0 + citeLh * 2, t.body, { wght: 400, tracking: 0.2 }));

  p.push(text("全站严守 1px 瑞士细线与 95/5 墨色秩序。", "cjk", citeSize, ix, ly0 + citeLh * 3, t.muted, { wght: 400, tracking: 0.2 }));

  // Internal 1px hairline divider
  const div1Y = vy + 194;
  p.push(hline(vx + 1, vx + vw - 1, div1Y, t.ruleSoft));

  // Interior Zone B: Matched Evidence Trace rows [1] & [2]
  const ev1Y = div1Y + 24;
  p.push(`<rect x="${ix}" y="${num(ev1Y - 11.5)}" width="16" height="16" rx="3" fill="${t.supBg}" stroke="${t.rule}" stroke-width="1"/>`);
  p.push(text("1", "mono", 10, ix + 8, ev1Y + 0.3, t.supInk, { wght: 600, anchor: "middle" }));
  p.push(text("确定性因子拆解 · 飞书与经营看板", "cjk", 12.5, ix + 24, ev1Y, t.body, { wght: 500, tracking: 0.1 }));
  p.push(text("50+ 企业场景 · 3 秒人工拍板与定时复查", "cjk", 11, ix + 24, ev1Y + 18, t.muted, { wght: 400, tracking: 0.1 }));

  const ev2Y = div1Y + 72;
  p.push(`<rect x="${ix}" y="${num(ev2Y - 11.5)}" width="16" height="16" rx="3" fill="${t.supActiveBg}"/>`);
  p.push(text("2", "mono", 10, ix + 8, ev2Y + 0.3, t.supActiveInk, { wght: 600, anchor: "middle" }));
  p.push(text("单文件 ~9 MB Go · Apple Silicon Swift", "cjk", 12.5, ix + 24, ev2Y, t.ink, { wght: 600, tracking: 0.1 }));
  p.push(text("airdrop-win v1.0.0 · beanbridge v0.5.1", "mono", 10.8, ix + 24, ev2Y + 18, t.muted, { wght: 400, tracking: 0.3 }));

  const div2Y = vy + vh - 58;
  p.push(hline(vx + 1, vx + vw - 1, div2Y, t.ruleSoft));

  // Interior Zone C: Compact Physical Keycap Footer (6px geometry)
  const ctaY = div2Y + 13;
  const ctaLabel = "下方查看公开仓库";
  const ctaTextW = measure(ctaLabel, "cjk", 12, 600, 0.2);
  const ctaW = ctaTextW + 44;
  p.push(`<rect x="${ix}" y="${ctaY}" width="${num(ctaW)}" height="32" rx="6" fill="${t.ctaFill}"/>`);
  p.push(text(ctaLabel, "cjk", 12, ix + 14, ctaY + 20.5, t.ctaInk, { wght: 600, tracking: 0.2 }));
  p.push(ICONS.playbookVector(ix + 14 + ctaTextW + 6, ctaY + 9.5, 13, t.ctaInk));

  const secLabel = "SWISS · 1PX GRID";
  const secW = measure(secLabel, "mono", 10.5, 500, 1.0) + 24;
  p.push(
    `<rect x="${num(vx + vw - 20 - secW)}" y="${ctaY}" width="${num(secW)}" height="32" rx="6" ` +
      `fill="${t.subtle}" stroke="${t.rule}" stroke-width="1"/>`
  );
  p.push(text(secLabel, "mono", 10.5, vx + vw - 20 - secW / 2, ctaY + 20, t.muted, { wght: 500, tracking: 1.0, anchor: "middle" }));

  p.push(`</g>`);

  // =========================================================================
  // BAND 2 (y = 408..606): 4-Column Capability Matrix on Open Swiss Canvas
  // =========================================================================
  const colW = W / 4;
  const b2Y = band1H;
  PILLARS.forEach((item, i) => {
    const cx = i * colW + 28;
    const nw = measure(item.idx, "mono", 11.5, 600, 1.2);
    p.push(text(item.idx, "mono", 11.5, cx, b2Y + 32, t.accent, { wght: 600, tracking: 1.2 }));
    p.push(text(item.label, "cjk", 12, cx + nw + 10, b2Y + 32, t.muted, { wght: 500, tracking: 0.8 }));

    p.push(text(item.title, "cjk", 18, cx, b2Y + 70, t.ink, { wght: 600, tracking: 0.3 }));
    p.push(para(item.desc, "cjk", 13.2, cx, b2Y + 99, colW - 56, t.muted, { wght: 400, lh: 21.5, tracking: 0.15, maxLines: 3 }));
    p.push(text(item.spec, "mono", 10.8, cx, b2Y + band2H - 22, t.faint, { wght: 500, tracking: 1.3 }));
  });

  // =========================================================================
  // BAND 3 (y = 606..830): Comparative Micro-Dataviz (Data-Honest Real Stats)
  // =========================================================================
  const b3Y = band1H + band2H;

  // ---- Left 58%: Precision Spectrum Meter
  p.push(text("02 / 2026 ACTIVE REPOSITORY SPECTRUM", "mono", 11.5, 28, b3Y + 32, t.muted, { wght: 500, tracking: 1.5 }));
  p.push(text("N = 25 REPOS", "mono", 11.5, split3X - 28, b3Y + 32, t.ink, { wght: 600, tracking: 1.2, anchor: "end" }));

  const barX = 28;
  const barY = b3Y + 58;
  const barW = split3X - 56;
  const barH = 28;
  const segGap = 2;
  const usableW = barW - segGap * (SPECTRUM_ITEMS.length - 1);

  p.push(`<rect x="${barX - 2}" y="${barY - 2}" width="${barW + 4}" height="${barH + 4}" rx="5" fill="${t.track}"/>`);

  let sx = barX;
  SPECTRUM_ITEMS.forEach((item, i) => {
    const sw = (usableW * item.pct) / 100;
    const style = t.spectrum[i];
    const rx = i === 0 || i === SPECTRUM_ITEMS.length - 1 ? 3 : 1;
    p.push(`<rect x="${num(sx)}" y="${barY}" width="${num(sw)}" height="${barH}" rx="${rx}" fill="${style.fill}"/>`);
    if (style.hatch) {
      p.push(`<rect x="${num(sx)}" y="${barY}" width="${num(sw)}" height="${barH}" rx="${rx}" fill="url(#hatch)"/>`);
    }
    p.push(text(`${item.pct}%`, "mono", 11.5, sx + sw / 2, barY + 18.5, style.ink, { wght: 600, anchor: "middle" }));
    sx += sw + segGap;
  });

  const legY0 = b3Y + 124;
  const legColW = (split3X - 56) / 2;
  SPECTRUM_ITEMS.forEach((item, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const lx = 28 + col * (legColW + 12);
    const ly = legY0 + row * 42;
    const style = t.spectrum[i];

    p.push(`<rect x="${num(lx)}" y="${num(ly - 9)}" width="10" height="10" rx="2" fill="${style.fill}"/>`);
    if (style.hatch) {
      p.push(`<rect x="${num(lx)}" y="${num(ly - 9)}" width="10" height="10" rx="2" fill="url(#hatch)"/>`);
    }
    p.push(text(item.name, "cjk", 13, lx + 18, ly, t.body, { wght: 500, tracking: 0.1 }));
    p.push(
      text(`${item.count} · ${item.pct}%`, "mono", 11.5, lx + legColW - 14, ly, t.muted, {
        wght: 500,
        anchor: "end",
      })
    );
    if (row === 0) {
      p.push(hline(lx, lx + legColW - 14, ly + 16, t.ruleSoft));
    }
  });

  // ---- Right 42%: 2021 -> 2026 Comparative Output Trajectory (32px header clearance!)
  const rx3 = split3X + 28;
  const rw3 = W - split3X - 56;
  p.push(text("03 / TRAJECTORY 2021 — 2026", "mono", 11.5, rx3, b3Y + 32, t.muted, { wght: 500, tracking: 1.5 }));
  p.push(text("62 ORIGINAL", "mono", 11.5, W - 28, b3Y + 32, t.ink, { wght: 600, tracking: 1.2, anchor: "end" }));

  const axisY = b3Y + 166;
  const maxBarH = 68;
  const maxCount = 26;
  p.push(hline(rx3, W - 28, axisY, t.rule));

  const slotW = rw3 / TRAJECTORY.length;
  const colBarW = 36;
  TRAJECTORY.forEach((pt, i) => {
    const cx = rx3 + slotW * i + slotW / 2;
    const bh = Math.max(10, Math.round((pt.count / maxCount) * maxBarH));
    const bx = cx - colBarW / 2;
    const by = axisY - bh;

    p.push(`<rect x="${num(bx)}" y="${num(by)}" width="${colBarW}" height="${bh}" rx="2" fill="${pt.peak ? t.barPeak : t.barBase}"/>`);

    if (pt.peak) {
      // Quiet Precision AnomalyBeacon diamond cleanly below header (by = b3Y + 98 -> label at b3Y + 68 -> 36px below header!)
      p.push(ICONS.anomalyBeacon(cx - 6, by - 20, 12, t.barPeak));
      p.push(text(String(pt.count), "mono", 11.5, cx, by - 25, t.ink, { wght: 600, anchor: "middle" }));
    } else {
      p.push(text(String(pt.count), "mono", 11, cx, by - 7, t.muted, { wght: 500, anchor: "middle" }));
    }

    p.push(text(pt.yr, "mono", 11.5, cx, axisY + 20, pt.peak ? t.ink : t.muted, { wght: pt.peak ? 600 : 500, anchor: "middle" }));
    p.push(text(pt.cap, "cjk", 11, cx, axisY + 39, pt.peak ? t.ink : t.faint, { wght: pt.peak ? 500 : 400, anchor: "middle" }));
  });

  // =========================================================================
  // BAND 4 (y = 830..928): 4-Column Core Stack Strip (Width-asserted!)
  // =========================================================================
  const b4Y = band1H + band2H + band3H;
  STACK.forEach(([k, v], i) => {
    const cx = i * colW + 28;
    p.push(text(k, "mono", 11, cx, b4Y + 34, t.faint, { wght: 500, tracking: 1.6 }));
    assertFits(v, "cjk", 12.2, colW - 52, 500, 0.05);
    p.push(text(v, "cjk", 12.2, cx, b4Y + 66, t.ink, { wght: 500, tracking: 0.05 }));
  });

  return wrapSvg(
    W,
    H,
    "Lowkii 工程台账 — 公开项目 airdrop-win、beanbridge、salesup 与企业 AI 工作台、跨端工具及 2021–2026 演进",
    p.join("")
  );
}

// ---------------------------------------------------------------------------
// Generate all 4 SVGs
// ---------------------------------------------------------------------------

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const [name, theme] of Object.entries(THEMES)) {
  const heroSvg = buildHero(theme);
  const wbSvg = buildWorkbench(theme);
  fs.writeFileSync(path.join(OUT_DIR, `hero-${name}.svg`), heroSvg, "utf8");
  fs.writeFileSync(path.join(OUT_DIR, `workbench-${name}.svg`), wbSvg, "utf8");
  console.log(
    `[ok] ${name}: hero=${(heroSvg.length / 1024).toFixed(1)}KB, workbench=${(wbSvg.length / 1024).toFixed(1)}KB`
  );
}
