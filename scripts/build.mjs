/**
 * Generate the GitHub profile SVGs (hero + workbench) for light and dark themes.
 *
 * Radical Subtraction edition:
 *   - Hero (1200x440):      Strict 0px Swiss Modernist architecture, monumental Geist Regular 400
 *                           typography, Sapphire atmosphere (dark) / subtle quartz mist (light),
 *                           minimal 4-stage execution loop with inset 2px filament.
 *   - Workbench (1200x560): Quiet Precision V4 — 80% pure open Swiss hairline canvas + 20% single
 *                           stationary focal vessel (cold quartz beam + stationary 2px metallic
 *                           highlight ridge), zero pill soup, zero redundant metadata.
 *
 * Fonts (SIL OFL): InstrumentSerif-Regular.ttf, InstrumentSerif-Italic.ttf,
 *                  Geist.ttf, GeistMono.ttf, NotoSansSC.ttf.
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
  serif: "InstrumentSerif-Regular.ttf",
  "serif-i": "InstrumentSerif-Italic.ttf",
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
  const inst = base.variationAxes?.wght ? base.getVariation({ wght: clamped }) : base;
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

const PROPORTIONAL_PUNCT = new Set(["·", "–", "↔", "→"]);

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
        throw new Error(`Notdef glyph in "${str}" at "${run.text[i]}"`);
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

// ---------------------------------------------------------------------------
// 1.45px Geometric AI Symbols (Quiet Precision V4 exact vector recipes)
// ---------------------------------------------------------------------------

function iconGroup(x, y, size, color, inner) {
  const s = size / 16;
  return (
    `<g transform="translate(${num(x)} ${num(y)}) scale(${num(s)})" ` +
    `fill="none" stroke="${color}" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round">` +
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
  anomalyBeacon: (x, y, size, color) =>
    iconGroup(
      x,
      y,
      size,
      color,
      `<path d="M8 2 14 8l-6 6-6-6 6-6Z"/>` +
        `<circle cx="8" cy="8" r="1.5" fill="${color}" stroke="none"/>`
    ),
};

function hline(x1, x2, y, color) {
  return `<line x1="${num(x1)}" y1="${num(y + 0.5)}" x2="${num(x2)}" y2="${num(y + 0.5)}" stroke="${color}" stroke-width="1" shape-rendering="crispEdges"/>`;
}

function vline(x, y1, y2, color) {
  return `<line x1="${num(x + 0.5)}" y1="${num(y1)}" x2="${num(x + 0.5)}" y2="${num(y2)}" stroke="${color}" stroke-width="1" shape-rendering="crispEdges"/>`;
}

function checkMark(x, y, color, cls = "") {
  return `<path${cls ? ` class="${cls}"` : ""} d="M${num(x)} ${num(y)} l3.6 3.6 l7.2 -7.8" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"/>`;
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
// Independent Light & Dark Theme Calibration
// ---------------------------------------------------------------------------

const THEMES = {
  light: {
    mode: "light",
    heroBg: "#ffffff",
    canvas: "#ffffff",
    subtle: "#f8fafc",
    rowActive: "#f6f8fb",
    rule: "#e4e9f0",
    ruleSoft: "#edf1f6",
    borderStrong: "#cbd5e1",
    checkIdle: "#d4dce6",
    ink: "#090e18",
    body: "#1e293b",
    muted: "#64748b",
    faint: "#94a3b8",
    accent: "#2563eb",
    accentSoft: "#2563eb0c",
    liveDot: "#0d9488",
    infoDot: "#2563eb",
    gridLine: "rgba(9,14,24,0.028)",
    atmoA: "#dce7fa",
    atmoB: "#eff6ff",
    ridgeStops: ["#090e18", "#1e40af", "#2563eb", "#1e40af", "#090e18"],
    vesselFill: "#ffffff",
    vesselShadow: "rgba(9,14,24,0.075)",
    vesselShadowSm: "rgba(9,14,24,0.025)",
    filament: "#090e18",
  },
  dark: {
    mode: "dark",
    heroBg: "#020801",
    canvas: "#080b0e",
    subtle: "#10161e",
    rowActive: "#0e151d",
    rule: "#232c36",
    ruleSoft: "#171f28",
    borderStrong: "#2f3d4d",
    checkIdle: "#344254",
    ink: "#f8fafc",
    body: "#cbd5e1",
    muted: "#8494a7",
    faint: "#58687c",
    accent: "#a2fa8e",
    accentSoft: "rgba(162,250,142,0.07)",
    liveDot: "#a2fa8e",
    infoDot: "#38bdf8",
    gridLine: "rgba(255,255,255,0.036)",
    atmoA: "#0042ac",
    atmoB: "#001a6a",
    atmoC: "#168ae2",
    ridgeStops: ["#10161e", "#0042ac", "#168ae2", "#a2fa8e", "#168ae2", "#10161e"],
    vesselFill: "#0c1117",
    vesselShadow: "rgba(0,0,0,0.46)",
    vesselShadowSm: "rgba(0,0,0,0.20)",
    filament: "#a2fa8e",
  },
};

const W = 1200;

// ---------------------------------------------------------------------------
// Minimal High-Signal Content (Zero Repetition, Day-30 Pruned)
// ---------------------------------------------------------------------------

const PIPELINE = [
  ["01", "感知", "BLE · 飞书 · 电商"],
  ["02", "归因", "因子拆解 · LLM · Whisper"],
  ["03", "执行", "Agent · Skills · Win32"],
  ["04", "交付", "经营工作台 · 原生工具"],
];

const SHIPPED = [
  {
    name: "airdrop-win",
    note: "Windows ↔ Apple 局域网隔空传",
    spec: "Go · ~9 MB",
    status: "live",
    active: true,
  },
  {
    name: "beanbridge",
    note: "D3200 蓝牙纯内存语音路由",
    spec: "Swift · BLE",
    status: "live",
    active: false,
  },
  {
    name: "salesup",
    note: "销售新人培养与复盘系统",
    spec: "React · Nest",
    status: "info",
    active: false,
  },
];

const PILLARS = [
  {
    idx: "02",
    tag: "经营工作台",
    title: "可溯源归因与闭环",
    desc: "异常检测、因子拆解与人机拍板。",
    spec: "GO · REACT · PGVECTOR",
  },
  {
    idx: "03",
    tag: "原生工具",
    title: "零依赖跨端器物",
    desc: "macOS 蓝牙转写与 Win32 局域网互传。",
    spec: "SWIFT · WIN32 · WHISPER.CPP",
  },
  {
    idx: "04",
    tag: "Agent 工程",
    title: "让模型操作真实软件",
    desc: "桌面智能体、Skills 与视频流水线。",
    spec: "MCP · PLAYWRIGHT · FFMPEG",
  },
];

const TIMELINE = [
  ["2021", "Java 起步"],
  ["2022", "校园小程序"],
  ["2024", "政企系统"],
  ["2025", "AI 创作平台"],
  ["2026", "AI 工作台 · 原生工具"],
];

// ---------------------------------------------------------------------------
// SVG 1: Hero (1200 x 436 — Airy 0px Swiss Modernist Architecture)
// ---------------------------------------------------------------------------

function buildHero(t) {
  const H = 436;
  const topH = 46;
  const splitX = 788;
  const p = [];

  const atmoDefs =
    t.mode === "dark"
      ? `<radialGradient id="atmo1" cx="76%" cy="22%" r="58%">` +
        `<stop offset="0%" stop-color="${t.atmoA}" stop-opacity="0.46"/>` +
        `<stop offset="54%" stop-color="${t.atmoB}" stop-opacity="0.22"/>` +
        `<stop offset="100%" stop-color="${t.heroBg}" stop-opacity="0"/>` +
        `</radialGradient>` +
        `<radialGradient id="atmo2" cx="95%" cy="8%" r="36%">` +
        `<stop offset="0%" stop-color="${t.atmoC}" stop-opacity="0.22"/>` +
        `<stop offset="100%" stop-color="${t.heroBg}" stop-opacity="0"/>` +
        `</radialGradient>`
      : `<radialGradient id="atmo1" cx="84%" cy="16%" r="52%">` +
        `<stop offset="0%" stop-color="${t.atmoA}" stop-opacity="0.44"/>` +
        `<stop offset="56%" stop-color="${t.atmoB}" stop-opacity="0.20"/>` +
        `<stop offset="100%" stop-color="${t.heroBg}" stop-opacity="0"/>` +
        `</radialGradient>`;

  p.push(
    `<defs>` +
      `<pattern id="tech-grid" width="48" height="48" patternUnits="userSpaceOnUse">` +
      `<path d="M48 0H0V48" fill="none" stroke="${t.gridLine}" stroke-width="1"/>` +
      `</pattern>` +
      atmoDefs +
      `<clipPath id="stage-clip"><rect x="1" y="${topH + 1}" width="${W - 2}" height="${H - topH - 2}"/></clipPath>` +
      `</defs>`
  );

  // Outer 0px crisp architectural frame
  p.push(`<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="${t.heroBg}" stroke="${t.rule}" stroke-width="1" shape-rendering="crispEdges"/>`);
  p.push(`<g clip-path="url(#stage-clip)">`);
  p.push(`<rect x="1" y="${topH + 1}" width="${W - 2}" height="${H - topH - 2}" fill="url(#atmo1)"/>`);
  if (t.mode === "dark") {
    p.push(`<rect x="1" y="${topH + 1}" width="${W - 2}" height="${H - topH - 2}" fill="url(#atmo2)"/>`);
  }
  p.push(`<rect x="1" y="${topH + 1}" width="${W - 2}" height="${H - topH - 2}" fill="url(#tech-grid)"/>`);
  p.push(`</g>`);

  // Shared 1px structural rails
  p.push(hline(1, W - 1, topH, t.rule));
  p.push(vline(splitX, topH + 1, H - 1, t.rule));

  // ---- Top Architectural Rail (Ultra-quiet)
  p.push(ICONS.orderPrism(36, 15, 16, t.ink));
  p.push(text("LOWKII", "mono", 12.5, 62, 27.5, t.ink, { wght: 600, tracking: 2.2 }));

  const est = "EST. 2021";
  const estW = measure(est, "mono", 11.5, 500, 1.8);
  p.push(`<circle cx="${num(W - 36 - estW - 12)}" cy="23" r="3" fill="${t.liveDot}" class="pulse"/>`);
  p.push(text(est, "mono", 11.5, W - 36, 27.5, t.muted, { wght: 500, tracking: 1.8, anchor: "end" }));

  // ---- Left Stage (x = 0..788): Monumental Instrument Serif (Roman + Italic) + Generous Whitespace
  const wmSize = 186;
  const wmX = 34;
  const wmY = 238;
  const wLow = measure("Low", "serif", wmSize, 400, -3.2);
  const kiiX = wmX + wLow - 2;
  const wKii = measure("kii", "serif-i", wmSize, 400, -1.6);
  p.push(text("Low", "serif", wmSize, wmX, wmY, t.ink, { wght: 400, tracking: -3.2 }));
  p.push(text("kii", "serif-i", wmSize, kiiX, wmY, t.ink, { wght: 400, tracking: -1.6 }));
  // Strict 0px surgical accent square
  p.push(`<rect x="${num(kiiX + wKii + 12)}" y="${num(wmY - 20)}" width="20" height="20" fill="${t.accent}"/>`);

  p.push(text("把 AI 落进真实业务与原生工具。", "cjk", 26, 40, 314, t.ink, { wght: 500, tracking: 0.4 }));
  p.push(text("Go · TypeScript · Swift · Python · 飞书 · MCP", "mono", 12, 40, 368, t.muted, { wght: 400, tracking: 1.2 }));

  // ---- Right Stage (x = 788..1200): Minimal 4-Step Execution Loop
  const rx = splitX;
  const rw = W - rx - 1;
  const subH = 42;
  const stageTop = topH + subH;
  const rowH = (H - stageTop - 1) / 4; // 347 / 4 = 86.75

  p.push(hline(rx + 1, W - 1, stageTop, t.rule));
  p.push(ICONS.causalSplit(rx + 26, topH + 13.5, 15, t.muted));
  p.push(text("LOOP", "mono", 11.5, rx + 50, topH + 25.5, t.muted, { wght: 500, tracking: 2 }));
  p.push(`<circle cx="${W - 36}" cy="${num(topH + 21)}" r="3" fill="${t.liveDot}" class="pulse"/>`);

  // Animated 0px row wash + Quiet Precision inset 2px vertical filament
  p.push(
    `<g class="hl">` +
      `<rect x="${rx + 1}" y="${num(stageTop + 1)}" width="${rw - 1}" height="${num(rowH - 1)}" fill="${t.accentSoft}"/>` +
      `<rect x="${rx + 12}" y="${num(stageTop + 22)}" width="2" height="${num(rowH - 44)}" rx="1" fill="${t.filament}"/>` +
      `</g>`
  );

  PIPELINE.forEach(([idx, title, detail], i) => {
    const ry = stageTop + i * rowH;
    if (i > 0) p.push(hline(rx + 1, W - 1, ry, t.ruleSoft));
    p.push(text(idx, "mono", 12, rx + 26, ry + 38, t.faint, { wght: 500, tracking: 1 }));
    p.push(text(idx, "mono", 12, rx + 26, ry + 38, t.accent, { wght: 600, tracking: 1, attrs: `class="n${i}"` }));
    p.push(text(title, "cjk", 17.5, rx + 62, ry + 39, t.ink, { wght: 500, tracking: 0.4 }));
    p.push(text(detail, "cjk", 13, rx + 62, ry + 64, t.muted, { wght: 400, tracking: 0.15 }));
    p.push(checkMark(W - 48, ry + 42, t.checkIdle));
    p.push(checkMark(W - 48, ry + 42, t.mode === "dark" ? t.accent : t.liveDot, `n${i}`));
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
    "Lowkii — 把 AI 落进真实业务与原生工具。",
    p.join(""),
    cssParts.join("")
  );
}

// ---------------------------------------------------------------------------
// SVG 2: Quiet Precision Workbench (1200 x 564)
//   80% Open Swiss Hairline Canvas + 20% Single Stationary Focal Vessel
// ---------------------------------------------------------------------------

function buildWorkbench(t) {
  const H = 564;
  const row1H = 264;
  const row2H = 182; // y = 264 .. 446
  // row3: y = 446 .. 564 (118px)
  const split1X = 720;
  const p = [];

  const ridgeStops = t.ridgeStops
    .map((c, idx) => `<stop offset="${num((idx / (t.ridgeStops.length - 1)) * 100)}%" stop-color="${c}"/>`)
    .join("");

  p.push(
    `<defs>` +
      `<linearGradient id="metallic-ridge" x1="0%" y1="0%" x2="100%" y2="0%">${ridgeStops}</linearGradient>` +
      `<filter id="vessel-shadow" x="-6%" y="-8%" width="112%" height="122%">` +
      `<feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="${t.vesselShadowSm}"/>` +
      `<feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="${t.vesselShadow}"/>` +
      `</filter>` +
      `</defs>`
  );

  // Continuous 0px Swiss Open-Canvas Sheet
  p.push(`<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="${t.canvas}" stroke="${t.rule}" stroke-width="1" shape-rendering="crispEdges"/>`);

  // Master shared 1px rails
  p.push(hline(1, W - 1, row1H, t.rule));
  p.push(hline(1, W - 1, row1H + row2H, t.rule));
  p.push(vline(split1X, 1, row1H, t.rule));
  p.push(vline(400, row1H + 1, row1H + row2H, t.rule));
  p.push(vline(800, row1H + 1, row1H + row2H, t.rule));

  // =========================================================================
  // ROW 1 LEFT (x = 0..720): Monumental 50+ Enterprise AI Delivery Anchor
  // =========================================================================
  const nw01 = measure("01", "mono", 12, 600, 1.2);
  p.push(text("01", "mono", 12, 36, 40, t.accent, { wght: 600, tracking: 1.2 }));
  p.push(text("企业 AI 落地", "cjk", 13, 36 + nw01 + 10, 40, t.muted, { wght: 500, tracking: 0.8 }));

  // Monumental Instrument Serif "50+"
  const bigX = 32;
  const bigY = 174;
  p.push(text("50", "serif", 132, bigX, bigY, t.ink, { wght: 400, tracking: -2 }));
  const w50 = measure("50", "serif", 132, 400, -2);
  p.push(text("+", "serif", 118, bigX + w50 + 2, bigY - 4, t.accent, { wght: 400 }));

  const tx = 238;
  p.push(text("从需求拆解到上线交付", "cjk", 23, tx, 126, t.ink, { wght: 500, tracking: 0.3 }));
  p.push(text("覆盖跨境电商、制造、销售与财务团队的经营闭环。", "cjk", 14.5, tx, 162, t.muted, { wght: 400, tracking: 0.2 }));

  // Single quiet bottom strip inside Left cell (ZERO pill chips!)
  p.push(hline(1, split1X, row1H - 50, t.ruleSoft));
  const casesLine = "经营驾驶舱  ·  飞书多维表格与审批  ·  可溯源 RAG  ·  AI 视频产线";
  assertFits(casesLine, "cjk", 13, split1X - 72, 400, 0.2);
  p.push(text(casesLine, "cjk", 13, 36, row1H - 20, t.muted, { wght: 400, tracking: 0.2 }));

  // =========================================================================
  // ROW 1 RIGHT (x = 720..1200): THE SINGLE STATIONARY FOCAL VESSEL (20%)
  //   Real shipped public repositories — 3 clean single-line ledger rows!
  // =========================================================================
  const vx = split1X + 24;
  const vy = 22;
  const vw = W - split1X - 48; // 432
  const vh = row1H - 44; // 220
  const beamH = 40;

  p.push(`<g>`);
  p.push(
    `<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" rx="10" ` +
      `fill="${t.vesselFill}" stroke="${t.borderStrong}" stroke-width="1" filter="url(#vessel-shadow)"/>`
  );
  // Cold Quartz Top Beam
  p.push(
    `<path d="M${vx + 10} ${vy + 0.5} H${vx + vw - 10} Q${vx + vw - 0.5} ${vy + 0.5} ${vx + vw - 0.5} ${vy + 10} ` +
      `V${vy + beamH} H${vx + 0.5} V${vy + 10} Q${vx + 0.5} ${vy + 0.5} ${vx + 10} ${vy + 0.5} Z" fill="${t.subtle}"/>`
  );
  // Stationary 2px Metallic Highlight Ridge on beam bottom edge
  p.push(`<rect x="${vx + 1}" y="${vy + beamH}" width="${vw - 2}" height="2" fill="url(#metallic-ridge)"/>`);

  p.push(ICONS.orderPrism(vx + 18, vy + 12.5, 15, t.ink));
  p.push(text("SHIPPED PUBLIC", "mono", 11, vx + 40, vy + 24, t.ink, { wght: 600, tracking: 1.5 }));
  p.push(text("03", "mono", 11, vx + vw - 18, vy + 24, t.muted, { wght: 500, tracking: 1.2, anchor: "end" }));

  const bodyTop = vy + beamH + 2;
  const sRowH = (vh - beamH - 2) / SHIPPED.length; // 178 / 3 = 59.33

  SHIPPED.forEach((s, i) => {
    const ry = bodyTop + i * sRowH;
    if (i > 0) p.push(hline(vx + 1, vx + vw - 1, ry, t.ruleSoft));
    if (s.active) {
      p.push(`<rect x="${vx + 1}" y="${num(ry + 1)}" width="${vw - 2}" height="${num(sRowH - 1)}" fill="${t.rowActive}"/>`);
      p.push(`<rect x="${vx + 10}" y="${num(ry + 14)}" width="2" height="${num(sRowH - 28)}" rx="1" fill="${t.filament}"/>`);
    }

    const dotFill = s.status === "live" ? t.liveDot : t.infoDot;
    p.push(`<circle cx="${vx + 24}" cy="${num(ry + 22)}" r="3" fill="${dotFill}"/>`);
    p.push(text(s.name, "sans", 14.5, vx + 36, ry + 26.5, t.ink, { wght: 600, tracking: -0.2 }));
    p.push(text(s.note, "cjk", 12, vx + 36, ry + 46, t.muted, { wght: 400, tracking: 0.1 }));
    p.push(text(s.spec, "mono", 11.5, vx + vw - 18, ry + 26, s.active ? t.ink : t.muted, { wght: 500, anchor: "end" }));
  });
  p.push(`</g>`);

  // =========================================================================
  // ROW 2 (y = 264..446): 3 Spacious Capability Columns (3 x 400px)
  // =========================================================================
  const r2Y = row1H;
  PILLARS.forEach((item, i) => {
    const cx = i * 400 + 36;
    const nw = measure(item.idx, "mono", 12, 600, 1.2);
    p.push(text(item.idx, "mono", 12, cx, r2Y + 38, t.accent, { wght: 600, tracking: 1.2 }));
    p.push(text(item.tag, "cjk", 13, cx + nw + 10, r2Y + 38, t.muted, { wght: 500, tracking: 0.8 }));

    p.push(text(item.title, "cjk", 21, cx, r2Y + 86, t.ink, { wght: 500, tracking: 0.3 }));
    assertFits(item.desc, "cjk", 14, 328, 400, 0.2);
    p.push(text(item.desc, "cjk", 14, cx, r2Y + 116, t.muted, { wght: 400, tracking: 0.2 }));
    p.push(text(item.spec, "mono", 11, cx, r2Y + row2H - 26, t.faint, { wght: 500, tracking: 1.4 }));
  });

  // =========================================================================
  // ROW 3 (y = 446..564): Minimal Airy Timeline Track (2021 — 2026)
  // =========================================================================
  const r3Y = row1H + row2H;
  const lx0 = 40;
  const lx1 = W - 40;
  const axisY = r3Y + 60;
  const step = (lx1 - lx0) / (TIMELINE.length - 1);

  p.push(hline(lx0, lx1, axisY, t.rule));
  // Subtle highlighted final segment (2025 -> 2026)
  p.push(`<line x1="${num(lx1 - step)}" y1="${num(axisY + 0.5)}" x2="${num(lx1)}" y2="${num(axisY + 0.5)}" stroke="${t.accent}" stroke-width="1.5" shape-rendering="crispEdges"/>`);

  TIMELINE.forEach(([yr, cap], i) => {
    const cx = lx0 + i * step;
    const last = i === TIMELINE.length - 1;
    const anchor = i === 0 ? "start" : last ? "end" : "middle";
    const ax = i === 0 ? 36 : last ? W - 36 : cx;

    if (last) {
      p.push(ICONS.anomalyBeacon(cx - 7, axisY - 6.5, 14, t.accent));
    } else {
      p.push(`<circle cx="${num(cx)}" cy="${num(axisY + 0.5)}" r="4" fill="${t.canvas}" stroke="${t.faint}" stroke-width="1.5"/>`);
    }

    p.push(text(yr, "mono", 12.5, ax, axisY - 18, last ? t.ink : t.muted, { wght: last ? 600 : 500, tracking: 1, anchor }));
    p.push(text(cap, "cjk", 13.5, ax, axisY + 32, last ? t.ink : t.muted, { wght: last ? 500 : 400, tracking: 0.2, anchor }));
  });

  return wrapSvg(
    W,
    H,
    "Lowkii — 50+ 企业 AI 落地场景；公开项目 airdrop-win、beanbridge、salesup；经营工作台、原生工具与 Agent 工程。",
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
