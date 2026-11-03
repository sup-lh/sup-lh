"""Generate the profile SVGs (hero + bento) for light and dark themes.

All text is converted to outlines so the result looks identical everywhere.
Fonts (all SIL OFL): Instrument Serif, Geist, Geist Mono, Noto Sans SC.

    uv run --with fonttools python scripts/build.py <font-dir> <out-dir>
"""
import re
import sys
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

FONT_DIR, OUT = Path(sys.argv[1]), Path(sys.argv[2])
CHARS = set(Path(__file__).read_text()) | set("0123456789")

FILES = {
    "serif": "InstrumentSerif-Regular.ttf",
    "serif-i": "InstrumentSerif-Italic.ttf",
    "sans": "Geist.ttf",
    "mono": "GeistMono.ttf",
    "cjk": "NotoSansSC.ttf",
}


class Font:
    _cache = {}

    def __init__(self, key, wght=400):
        f = TTFont(FONT_DIR / FILES[key])
        s = Subsetter(Options())
        s.populate(text="".join(CHARS))
        s.subset(f)
        if "fvar" in f:
            f = instantiateVariableFont(f, {"wght": wght})
        self.upm = f["head"].unitsPerEm
        self.cmap = f.getBestCmap()
        self.gs = f.getGlyphSet()
        self.hmtx = f["hmtx"]

    @classmethod
    def get(cls, key, wght=400):
        if (key, wght) not in cls._cache:
            cls._cache[key, wght] = Font(key, wght)
        return cls._cache[key, wght]


def num(v):
    return f"{v:.1f}".rstrip("0").rstrip(".")


def _runs(s, key, wght):
    """Pick a font per character, falling back to Noto Sans SC."""
    main = Font.get(key, wght)
    cjk = Font.get("cjk", min(max(wght, 400), 700))
    return [(c, main if ord(c) in main.cmap else cjk) for c in s]


def measure(s, key, size, wght=400, tracking=0.0):
    w = 0.0
    for c, f in _runs(s, key, wght):
        w += f.hmtx[f.cmap[ord(c)]][0] * size / f.upm + tracking
    return w - tracking if s else 0.0


def text(s, key, size, x, y, fill, wght=400, tracking=0.0, anchor="start", attrs=""):
    w = measure(s, key, size, wght, tracking)
    if anchor == "end":
        x -= w
    elif anchor == "middle":
        x -= w / 2
    parts, cx = [], x
    for c, f in _runs(s, key, wght):
        g = f.cmap[ord(c)]
        sc = size / f.upm
        pen = SVGPathPen(f.gs, ntos=num)
        f.gs[g].draw(TransformPen(pen, (sc, 0, 0, -sc, cx, y)))
        if d := pen.getCommands():
            parts.append(d)
        cx += f.hmtx[g][0] * sc + tracking
    return f'<path fill="{fill}" {attrs} d="{" ".join(parts)}"/>'


def wrap(s, key, size, maxw, wght=400):
    """Character wrap that keeps closing punctuation off the start of a line."""
    lines, cur = [], ""
    for tok in re.findall(r"[A-Za-z0-9\-./]+|\s+|.", s):
        if cur and measure(cur + tok, key, size, wght) > maxw and tok not in "，。、；：）·":
            lines.append(cur.rstrip())
            cur = tok.lstrip()
        else:
            cur += tok
    return lines + [cur] if cur else lines


THEMES = {
    "light": dict(bg="#f7f6f3", card="#ffffff", line="#e6e3dd", ink="#141416", muted="#67676d",
                  faint="#a3a19b", dot="#d9d5cc", accent="#ff4f0f", accent_soft="#ff4f0f1a"),
    "dark": dict(bg="#0b0c0f", card="#111317", line="#24262c", ink="#f1f0ec", muted="#9b9ba3",
                 faint="#5c5d64", dot="#1e2026", accent="#ff6a2b", accent_soft="#ff6a2b24"),
}

W = 1200


def svg(w, h, body, title, style=""):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" '
            f'role="img" aria-label="{title}"><title>{title}</title><style>{style}</style>{body}</svg>\n')


def check(x, y, color, attrs=""):
    return (f'<path {attrs} d="M{num(x)} {num(y)} l4.5 4.5 l9 -10" fill="none" stroke="{color}" '
            f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>')


# ---------------------------------------------------------------- hero

PIPELINE = [
    ("01", "采集", "飞书 · ERP · 电商后台 · 网页"),
    ("02", "理解", "LLM · RAG · 视觉模型"),
    ("03", "执行", "智能体 · 浏览器 · 桌面自动化"),
    ("04", "交付", "多维表格 · 看板 · 视频成片"),
]
CYCLE = 8.0  # seconds for one pipeline run


def hero(t):
    H = 500
    p = [f'<defs><pattern id="g" width="24" height="24" patternUnits="userSpaceOnUse">'
         f'<circle cx="1" cy="1" r="1" fill="{t["dot"]}"/></pattern>'
         f'<linearGradient id="fade" x1="0" x2="1"><stop offset="0" stop-color="{t["bg"]}" stop-opacity="1"/>'
         f'<stop offset=".55" stop-color="{t["bg"]}" stop-opacity=".6"/>'
         f'<stop offset="1" stop-color="{t["bg"]}" stop-opacity="0"/></linearGradient></defs>',
         f'<rect x=".5" y=".5" width="{W-1}" height="{H-1}" rx="24" fill="{t["bg"]}" stroke="{t["line"]}"/>',
         f'<rect x="1" y="1" width="{W-2}" height="{H-2}" rx="24" fill="url(#g)"/>',
         f'<rect x="1" y="1" width="{W-2}" height="{H-2}" rx="24" fill="url(#fade)"/>']

    # top bar
    p.append(f'<circle cx="62" cy="56" r="4" fill="{t["accent"]}" class="pulse"/>')
    p.append(text("LOWKII / SUP-LH", "mono", 15, 76, 61, t["muted"], 500, 2.2))
    p.append(text("AI SOLUTIONS ENGINEER — EST. 2021", "mono", 15, W - 56, 61, t["muted"], 500, 2.2, "end"))

    # wordmark
    x = 50
    p.append(text("Low", "serif", 210, x, 286, t["ink"], tracking=-4))
    x += measure("Low", "serif", 210, tracking=-4) - 2
    p.append(text("kii", "serif-i", 210, x, 286, t["ink"], tracking=-2))
    x += measure("kii", "serif-i", 210, tracking=-2) + 4
    p.append(f'<circle cx="{num(x + 13)}" cy="274" r="13" fill="{t["accent"]}"/>')

    p.append(text("把 AI 落进真实业务的全栈工程师。", "cjk", 30, 58, 362, t["ink"], 500, 1))
    p.append(text("Agents, workflows and the systems around them.",
                  "sans", 20, 58, 402, t["muted"], 400, 0))
    p.append(text("Go · TypeScript · Python · 飞书生态 · MCP", "mono", 15, 58, 446, t["faint"], 400, 1))

    # pipeline panel
    px, py, pw, ph = 708, 102, 436, 344
    p.append(f'<rect x="{px}" y="{py}" width="{pw}" height="{ph}" rx="18" fill="{t["card"]}" stroke="{t["line"]}"/>')
    p.append(text("PIPELINE", "mono", 13, px + 24, py + 34, t["muted"], 500, 2))
    rw = measure("RUNNING", "mono", 13, 500, 2)
    p.append(f'<circle cx="{num(px + pw - 24 - rw - 12)}" cy="{py + 30}" r="3.5" fill="{t["accent"]}" class="pulse"/>')
    p.append(text("RUNNING", "mono", 13, px + pw - 24, py + 34, t["accent"], 500, 2, "end"))
    p.append(f'<rect x="{px}" y="{py + 54}" width="{pw}" height="1" fill="{t["line"]}"/>')

    row_h, top = 68, py + 64
    rail_x = px + 40
    # rail and its animated fill
    p.append(f'<rect x="{rail_x - 1}" y="{top + 22}" width="2" height="{row_h * 3}" rx="1" fill="{t["line"]}"/>')
    p.append(f'<rect x="{rail_x - 1}" y="{top + 22}" width="2" height="{row_h * 3}" rx="1" fill="{t["accent"]}" class="rail"/>')
    # moving highlight
    p.append(f'<rect x="{px + 10}" y="{top + 2}" width="{pw - 20}" height="{row_h - 8}" rx="12" '
             f'fill="{t["accent_soft"]}" class="hl"/>')
    for i, (idx, title, detail) in enumerate(PIPELINE):
        cy = top + 22 + i * row_h
        p.append(f'<circle cx="{rail_x}" cy="{cy}" r="7" fill="{t["card"]}" stroke="{t["line"]}" stroke-width="2"/>')
        p.append(f'<circle cx="{rail_x}" cy="{cy}" r="7" fill="{t["accent"]}" class="node n{i}"/>')
        p.append(text(title, "cjk", 20, px + 66, cy + 4, t["ink"], 500, 1))
        p.append(text(detail, "cjk", 15, px + 66, cy + 28, t["muted"], 400, 0.2))
        p.append(text(idx, "mono", 12, px + pw - 58, cy + 5, t["faint"], 500, 1, "end"))
        p.append(check(px + pw - 44, cy, t["accent"], f'class="ok n{i}"'))

    # animation: each stage owns a 1/5 slot, last slot holds the finished state
    slot = 100 / 5
    css = [".pulse{animation:pulse 2s ease-in-out infinite}"
           "@keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}",
           f".rail{{transform-box:fill-box;transform-origin:top;animation:rail {CYCLE}s linear infinite}}"
           f"@keyframes rail{{0%{{transform:scaleY(0)}}{slot*3:.0f}%{{transform:scaleY(1)}}92%{{transform:scaleY(1);opacity:1}}100%{{transform:scaleY(1);opacity:0}}}}",
           f".hl{{animation:hl {CYCLE}s cubic-bezier(.6,0,.2,1) infinite}}"
           "@keyframes hl{" + "".join(
               f"{slot*i:.0f}%,{slot*i+slot*0.75:.0f}%{{transform:translateY({row_h*i}px);opacity:1}}"
               for i in range(4)) + f"92%{{transform:translateY({row_h*3}px);opacity:1}}100%{{transform:translateY({row_h*3}px);opacity:0}}}}"]
    for i in range(4):
        on = slot * i + slot * 0.6
        css.append(f".n{i}{{opacity:0;animation:n{i} {CYCLE}s ease-out infinite}}"
                   f"@keyframes n{i}{{0%,{on - 1:.0f}%{{opacity:0}}{on + 3:.0f}%,92%{{opacity:1}}100%{{opacity:0}}}}")
    css.append("@media (prefers-reduced-motion:reduce){*{animation:none!important}.n0,.n1,.n2,.n3{opacity:1}}")

    title = "Lowkii — 把 AI 落进真实业务的全栈工程师"
    return svg(W, H, "".join(p), title, "".join(css))


# ---------------------------------------------------------------- bento

def card(t, x, y, w, h):
    return f'<rect x="{num(x + .5)}" y="{num(y + .5)}" width="{num(w - 1)}" height="{num(h - 1)}" rx="20" fill="{t["card"]}" stroke="{t["line"]}"/>'


def label(t, s, x, y, n):
    return (text(n, "mono", 14, x, y, t["accent"], 500, 1.5)
            + text(s, "cjk", 15, x + measure(n, "mono", 14, 500, 1.5) + 10, y, t["muted"], 500, 1.5))


def para(t, s, x, y, maxw, size=16, lh=26, color=None):
    out = []
    for i, line in enumerate(wrap(s, "cjk", size, maxw)):
        out.append(text(line, "cjk", size, x, y + i * lh, color or t["muted"], 400, 0.3))
    return "".join(out)


def chips(t, items, x, y, maxw):
    out, cx, cy = [], x, y
    for s in items:
        w = measure(s, "cjk", 15, 400, 0.3) + 28
        if cx + w > x + maxw:
            cx, cy = x, cy + 44
        out.append(f'<rect x="{num(cx + .5)}" y="{num(cy + .5)}" width="{num(w - 1)}" height="34" rx="17" fill="none" stroke="{t["line"]}"/>')
        out.append(text(s, "cjk", 15, cx + 14, cy + 22.5, t["ink"], 400, 0.3))
        cx += w + 8
    return "".join(out)


FOCUS = [
    ("02", "AI 视频", "从选爆款到出片", "脚本、分镜、图像与视频生成、配音、剪辑，串成一条能反复跑的流水线。", "SEEDANCE · KLING · FFMPEG"),
    ("03", "跨境电商", "TikTok / Amazon 自动化", "选品分析、达人 BD、爆款拆解、运营日报，交给浏览器自动化和数据管道。", "CDP · PLAYWRIGHT · GO"),
    ("04", "Agent 工程", "让模型操作真实软件", "桌面 computer-use、浏览器智能体，以及 Claude Code / Codex 的插件与 Skills。", "MCP · SKILLS · EINO"),
    ("05", "知识问答", "可追溯的知识库", "RAG 混合检索与引用溯源；对飞书知识库做结构分析和质量治理。", "PGVECTOR · RERANK · SSE"),
]
CASES = ["销售拜访 AI 质检", "智能 IT 服务台", "招聘智能体", "发票识别与核算", "钉钉 ↔ 飞书审批打通",
         "ERP → 飞书数据同步", "VOC 客户声音", "广告异常告警", "报关资料自动化"]
PATH = [
    ("2021", "自学 Java 起步"),
    ("2022", "校园小程序上线运营"),
    ("2024", "政企监管与检验系统"),
    ("2025", "微服务与 AI 创作平台"),
    ("2026", "企业 AI 落地 · Agent"),
]
STACK = [
    ("LANGUAGES", "Go · TypeScript · Python · Java"),
    ("FRAMEWORKS", "Next.js · Gin · NestJS · Spring"),
    ("DATA", "PostgreSQL · Redis · pgvector"),
    ("PLATFORMS", "飞书 · Dify · Coze · Docker"),
]


FRAME = 0.0


def bento(t):
    global FRAME
    G = 16
    cw = (W - 2 * G) / 3
    p = []
    y = 0

    # row 1: enterprise AI (2 cols) + AI video
    h1 = 320
    x0, w0 = 0, cw * 2 + G
    p.append(card(t, x0, y, w0, h1))
    p.append(label(t, "企业 AI 落地", x0 + 32, y + 44, "01"))
    p.append(text("50", "serif", 132, x0 + 26, y + 160, t["ink"], tracking=-2))
    nx = x0 + 26 + measure("50", "serif", 132, tracking=-2) - 4
    p.append(text("+", "serif", 132, nx, y + 160, t["accent"]))
    tx = x0 + 250
    p.append(text("个企业场景，从需求拆解到上线交付", "cjk", 25, tx, y + 108, t["ink"], 500, 0.5))
    p.append(para(t, "智能体、多维表格系统、审批与数据打通、Skill 固化。服务过跨境电商、制造、销售、招聘与财务团队。",
                  tx, y + 142, w0 - (tx - x0) - 36))
    p.append(chips(t, CASES, x0 + 32, y + 208, w0 - 64))

    x1 = w0 + G
    p.append(card(t, x1, y, cw, h1))
    n, lab, title, desc, tag = FOCUS[0]
    p.append(label(t, lab, x1 + 28, y + 44, n))
    # filmstrip
    fx, fy, fg = x1 + 28, y + 70, 8
    fw, fh = (cw - 56 - fg * 4) / 5, 72
    FRAME = fw + fg
    for i in range(5):
        p.append(f'<rect x="{num(fx + i * (fw + fg))}" y="{fy}" width="{fw}" height="{fh}" rx="8" fill="{t["bg"]}" stroke="{t["line"]}"/>')
    p.append(f'<rect x="{num(fx)}" y="{fy}" width="{fw}" height="{fh}" rx="8" fill="{t["accent"]}" class="frame"/>')
    p.append(text(title, "cjk", 23, x1 + 28, y + 190, t["ink"], 500, 0.5))
    p.append(para(t, desc, x1 + 28, y + 224, cw - 56))
    p.append(text(tag, "mono", 13, x1 + 28, y + h1 - 28, t["faint"], 500, 1.5))
    y += h1 + G

    # row 2: three focus cards
    h2 = 250
    for i, (n, lab, title, desc, tag) in enumerate(FOCUS[1:]):
        cx = i * (cw + G)
        p.append(card(t, cx, y, cw, h2))
        p.append(label(t, lab, cx + 28, y + 44, n))
        p.append(text(title, "cjk", 23, cx + 28, y + 94, t["ink"], 500, 0.5))
        p.append(para(t, desc, cx + 28, y + 130, cw - 56))
        p.append(text(tag, "mono", 13, cx + 28, y + h2 - 28, t["faint"], 500, 1.5))
    y += h2 + G

    # row 3: path
    h3 = 186
    p.append(card(t, 0, y, W, h3))
    p.append(label(t, "路径", 32, y + 44, "06"))
    lx0, lx1, ly = 60, W - 60, y + 100
    step = (lx1 - lx0) / (len(PATH) - 1)
    p.append(f'<rect x="{lx0}" y="{ly - 1}" width="{lx1 - lx0}" height="2" fill="{t["line"]}"/>')
    p.append(f'<rect x="{num(lx1 - step)}" y="{ly - 1}" width="{num(step)}" height="2" fill="{t["accent"]}" class="tail"/>')
    for i, (yr, cap) in enumerate(PATH):
        cx = lx0 + i * step
        last = i == len(PATH) - 1
        if last:
            p.append(f'<circle cx="{num(cx)}" cy="{ly}" r="14" fill="{t["accent_soft"]}" class="pulse"/>')
        p.append(f'<circle cx="{num(cx)}" cy="{ly}" r="6" fill="{t["accent"] if last else t["card"]}" '
                 f'stroke="{t["accent"] if last else t["faint"]}" stroke-width="2"/>')
        anchor = "start" if i == 0 else "end" if last else "middle"
        ax = cx - 6 if i == 0 else cx + 6 if last else cx
        p.append(text(yr, "mono", 16, ax, ly - 22, t["ink"] if last else t["muted"], 500, 1, anchor))
        p.append(text(cap, "cjk", 16, ax, ly + 42, t["ink"] if last else t["muted"], 500 if last else 400, 0.3, anchor))
    y += h3 + G

    # row 4: stack
    h4 = 134
    p.append(card(t, 0, y, W, h4))
    colw = (W - 64) / 4
    for i, (k, v) in enumerate(STACK):
        cx = 32 + i * colw
        if i:
            p.append(f'<rect x="{num(cx - 16)}" y="{y + 28}" width="1" height="{h4 - 56}" fill="{t["line"]}"/>')
        p.append(text(k, "mono", 13, cx, y + 52, t["faint"], 500, 1.8))
        p.append(text(v, "sans", 16.5, cx, y + 88, t["ink"], 400, 0))
    y += h4

    css = (".pulse{animation:pulse 2.4s ease-in-out infinite}"
           "@keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}"
           ".frame{animation:frame 5s steps(1,end) infinite}"
           "@keyframes frame{" + "".join(f"{i*20}%{{transform:translateX({num(i*FRAME)}px)}}" for i in range(5)) + "}"
           ".tail{transform-box:fill-box;transform-origin:left;animation:tail 3s ease-in-out infinite}"
           "@keyframes tail{0%{transform:scaleX(0)}60%,100%{transform:scaleX(1)}}"
           "@media (prefers-reduced-motion:reduce){*{animation:none!important}}")
    title = "Lowkii 在做的事：企业 AI 落地、AI 视频、跨境电商自动化、Agent 工程、知识问答"
    return svg(W, y, "".join(p), title, css)


OUT.mkdir(parents=True, exist_ok=True)
for name, t in THEMES.items():
    (OUT / f"hero-{name}.svg").write_text(hero(t))
    (OUT / f"bento-{name}.svg").write_text(bento(t))
print("ok")
