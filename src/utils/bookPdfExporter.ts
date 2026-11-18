/**
 * V5.6.0 — PDF IDENTICAL TO THE VIEWER (browser).
 *
 * The downloaded PDF is drawn from the very pages the viewer shows: each page is laid out off-screen
 * in the reference layout (same component, same fonts, same measured pagination) and then copied
 * into the PDF element by element:
 *  - text stays REAL text (selectable, searchable, sharp in print): every word is placed exactly
 *    where the browser placed it, with the same self-hosted font embedded in the PDF;
 *  - backgrounds, frames, rules, rounded boxes and rotated ornaments are vector shapes;
 *  - photos are embedded at 300 dpi, cropped like on screen; illustrations (SVG) at 600 dpi.
 * One reference CSS px = getBookMmPerReferencePx(format) mm, so the PDF has the viewer's proportions.
 *
 * If anything fails (e.g. the fonts cannot be downloaded) the previous jsPDF generator is used, so
 * the participant always gets a PDF.
 */
import { jsPDF } from 'jspdf';
import {
  buildSafeDemoPdfFilename,
  type ComposedBookDocument,
  type DemoBasicProfile,
} from '../logic/demoStoryRules.ts';
import { BOOK_FONT_FACES, BOOK_FONTS_BASE_PATH, bookCssFamilyFor, type BookFontFace } from '../logic/bookFonts.ts';
import { getBookMmPerReferencePx } from '../logic/bookReferenceLayout.ts';
import {
  createBookPageStage,
  ensureBookFontsReady,
  paginateComposedBookByMeasurement,
  primaryFontFamily,
} from '../components/book/measuredBookPagination.tsx';
import { generateRealDemoBookPdf, preloadBookResourcesForPdf } from './demoPdfGenerator.ts';

export interface BookPdfExportResult {
  blob: Blob;
  blobUrl: string;
  filename: string;
  pageCount: number;
  pdfBytes: Uint8Array;
  /** 'viewer' = identical to the viewer; 'legacy' = previous generator (fallback). */
  engine: 'viewer' | 'legacy';
  integrityReport?: { passed: boolean; errors: string[] };
}

const PHOTO_DPI = 300;
const VECTOR_ART_DPI = 600;
/** Characters the embedded (Latin-subset) fonts contain; anything else is drawn as an image. */
const EMBEDDABLE_TEXT = /^[ -ſ‐-‧‰-›€™№]*$/;

// ---------------------------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------------------------

const fontBase64Cache = new Map<string, Promise<string>>();

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function loadFontBase64(file: string): Promise<string> {
  let job = fontBase64Cache.get(file);
  if (!job) {
    job = fetch(`${BOOK_FONTS_BASE_PATH}${file}`).then(async (res) => {
      if (!res.ok) throw new Error(`No se pudo cargar la tipografía ${file} (${res.status}).`);
      return arrayBufferToBase64(await res.arrayBuffer());
    });
    fontBase64Cache.set(file, job);
    job.catch(() => fontBase64Cache.delete(file));
  }
  return job;
}

/** CSS font matching (weights) among the self-hosted faces of a family. */
export function matchBookFontFace(cssFamily: string, weight: number, italic: boolean): BookFontFace | undefined {
  const family = BOOK_FONT_FACES.filter((f) => f.cssFamily === cssFamily);
  if (family.length === 0) return undefined;
  const styled = family.filter((f) => (f.style === 'italic') === italic);
  const pool = styled.length ? styled : family.filter((f) => f.style === 'normal');
  const ws = pool.map((f) => f.weight);
  const pick = (w: number) => pool.find((f) => f.weight === w);
  if (ws.includes(weight)) return pick(weight);
  const below = ws.filter((w) => w < weight).sort((a, b) => b - a);
  const above = ws.filter((w) => w > weight).sort((a, b) => a - b);
  let order: number[];
  if (weight >= 400 && weight <= 500) {
    const upTo500 = above.filter((w) => w <= 500);
    order = [...upTo500, ...below, ...above.filter((w) => w > 500)];
  } else if (weight < 400) order = [...below, ...above];
  else order = [...above, ...below];
  return pick(order[0]);
}

/** Self-hosted family for a computed CSS font-family (also maps the original names). */
function resolveCssFamily(fontFamily: string): string | undefined {
  for (const raw of String(fontFamily || '').split(',')) {
    const name = raw.trim().replace(/^['"]|['"]$/g, '');
    if (BOOK_FONT_FACES.some((f) => f.cssFamily === name)) return name;
    const mapped = bookCssFamilyFor(name);
    if (mapped) return mapped;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------------------------

type Rgba = { r: number; g: number; b: number; a: number };

const colorProbeCache = new Map<string, Rgba | null>();
let colorProbe: CanvasRenderingContext2D | null = null;

/**
 * Any CSS colour → sRGB. Tailwind v4 computes palette colours as `oklab(...)` / `color(...)`, so
 * those are resolved by letting the browser paint one pixel with them.
 */
function probeColor(value: string): Rgba | null {
  if (colorProbeCache.has(value)) return colorProbeCache.get(value)!;
  let out: Rgba | null = null;
  try {
    if (!colorProbe) {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      colorProbe = c.getContext('2d', { willReadFrequently: true });
    }
    if (colorProbe) {
      colorProbe.clearRect(0, 0, 1, 1);
      colorProbe.fillStyle = '#000';
      colorProbe.fillStyle = value;
      colorProbe.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = colorProbe.getImageData(0, 0, 1, 1).data;
      // Canvas pixels are un-premultiplied on read; very low alphas lose colour precision, so the
      // channel values are kept as read and the alpha drives the blending.
      out = a === 0 ? { r: 0, g: 0, b: 0, a: 0 } : { r, g, b, a: a / 255 };
    }
  } catch {
    out = null;
  }
  colorProbeCache.set(value, out);
  return out;
}

function parseColor(value: string): Rgba | null {
  const raw = String(value || '').trim();
  if (!raw || raw === 'transparent') return null;
  const m = raw.match(/^rgba?\(([^)]+)\)$/);
  if (!m) return probeColor(raw);
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  const [r, g, b] = parts;
  const a = parts.length > 3 ? parts[3] : 1;
  if ([r, g, b].some((n) => Number.isNaN(n))) return null;
  return { r, g, b, a: Number.isNaN(a) ? 1 : a };
}

function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a + bottom.a * (1 - top.a);
  if (a <= 0) return { r: 255, g: 255, b: 255, a: 0 };
  const mix = (t: number, b: number) => (t * top.a + b * bottom.a * (1 - top.a)) / a;
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
}

/** Colour actually seen behind an element (its background composited over its ancestors'). */
function effectiveBackground(el: Element, pageRoot: Element): Rgba {
  const chain: Element[] = [];
  for (let n: Element | null = el; n; n = n.parentElement) {
    chain.unshift(n);
    if (n === pageRoot) break;
  }
  let c: Rgba = { r: 255, g: 255, b: 255, a: 1 };
  for (const n of chain) {
    const bg = parseColor(getComputedStyle(n).backgroundColor);
    if (bg && bg.a > 0) c = over(bg, c);
  }
  return c;
}

const toCss = (c: Rgba) => `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;

// ---------------------------------------------------------------------------------------------
// Page drawing
// ---------------------------------------------------------------------------------------------

interface PageContext {
  doc: jsPDF;
  root: HTMLElement;
  originX: number;
  originY: number;
  /** mm per CSS px. */
  k: number;
  registeredFonts: Set<string>;
  gstates: Map<number, unknown>;
  measureCtx: CanvasRenderingContext2D;
  ascentCache: Map<string, number>;
  clipCache: Map<Element, DOMRect | null>;
  ellipsisDone: Set<Element>;
  lastWordInClamp: Map<Element, { right: number; baseline: number; draw: (text: string, x: number) => void }>;
}

const mmX = (ctx: PageContext, px: number) => (px - ctx.originX) * ctx.k;
const mmY = (ctx: PageContext, px: number) => (px - ctx.originY) * ctx.k;

function setOpacity(ctx: PageContext, alpha: number) {
  const a = Math.max(0, Math.min(1, Math.round(alpha * 100) / 100));
  let gs = ctx.gstates.get(a);
  if (!gs) {
    const GState = (ctx.doc as any).GState;
    gs = new GState({ opacity: a, 'stroke-opacity': a });
    ctx.gstates.set(a, gs);
  }
  (ctx.doc as any).setGState(gs);
}

/** Visible area for an element: intersection of the padding boxes of ancestors that clip. */
function clipRectFor(ctx: PageContext, el: Element): DOMRect | null {
  if (ctx.clipCache.has(el)) return ctx.clipCache.get(el)!;
  let rect: DOMRect | null = null;
  const parent = el === ctx.root ? null : el.parentElement;
  const inherited = parent ? clipRectFor(ctx, parent) : null;
  const cs = getComputedStyle(el);
  if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
    const r = el.getBoundingClientRect();
    const bl = parseFloat(cs.borderLeftWidth) || 0;
    const bt = parseFloat(cs.borderTopWidth) || 0;
    const br = parseFloat(cs.borderRightWidth) || 0;
    const bb = parseFloat(cs.borderBottomWidth) || 0;
    rect = new DOMRect(r.left + bl, r.top + bt, r.width - bl - br, r.height - bt - bb);
  }
  if (inherited && rect) {
    const left = Math.max(inherited.left, rect.left);
    const top = Math.max(inherited.top, rect.top);
    const right = Math.min(inherited.right, rect.right);
    const bottom = Math.min(inherited.bottom, rect.bottom);
    rect = new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
  } else if (inherited) {
    rect = inherited;
  }
  ctx.clipCache.set(el, rect);
  return rect;
}

function isInside(r: DOMRect, clip: DOMRect | null): boolean {
  if (!clip) return true;
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  return cx >= clip.left - 0.5 && cx <= clip.right + 0.5 && cy >= clip.top - 0.5 && cy <= clip.bottom + 0.5;
}

/** Element whose overflowing text the browser ends with «…» (line-clamp or text-overflow). */
function clampContainerOf(ctx: PageContext, el: Element): Element | null {
  for (let n: Element | null = el; n && n !== ctx.root; n = n.parentElement) {
    const cs = getComputedStyle(n) as CSSStyleDeclaration & { webkitLineClamp?: string };
    const clamped = (cs.webkitLineClamp && cs.webkitLineClamp !== 'none') || cs.textOverflow === 'ellipsis';
    if (clamped) return n;
  }
  return null;
}

function fontAscentPx(ctx: PageContext, cs: CSSStyleDeclaration): number {
  const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  let asc = ctx.ascentCache.get(font);
  if (asc === undefined) {
    ctx.measureCtx.font = font;
    const m = ctx.measureCtx.measureText('Hg');
    asc = m.fontBoundingBoxAscent || parseFloat(cs.fontSize) * 0.8;
    ctx.ascentCache.set(font, asc);
  }
  return asc;
}

async function ensureFontRegistered(ctx: PageContext, face: BookFontFace): Promise<void> {
  if (ctx.registeredFonts.has(face.file)) return;
  const b64 = await loadFontBase64(face.file);
  ctx.doc.addFileToVFS(face.file, b64);
  ctx.doc.addFont(face.file, face.file, 'normal');
  ctx.registeredFonts.add(face.file);
}

function rasterScale(ctx: PageContext, dpi: number): number {
  // device pixels per CSS px for the requested print resolution
  return (ctx.k / 25.4) * dpi;
}

function drawWordAsImage(ctx: PageContext, word: string, r: DOMRect, cs: CSSStyleDeclaration, alpha: number) {
  const scale = rasterScale(ctx, VECTOR_ART_DPI);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(r.width * scale));
  canvas.height = Math.max(1, Math.ceil(r.height * scale));
  const g = canvas.getContext('2d')!;
  g.scale(scale, scale);
  g.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  g.fillStyle = cs.color;
  g.textBaseline = 'alphabetic';
  g.fillText(word, 0, fontAscentPx(ctx, cs));
  setOpacity(ctx, alpha);
  ctx.doc.addImage(canvas.toDataURL('image/png'), 'PNG', mmX(ctx, r.left), mmY(ctx, r.top), r.width * ctx.k, r.height * ctx.k);
  setOpacity(ctx, 1);
}

async function drawTextNode(ctx: PageContext, node: Text, inheritedAlpha: number) {
  const parent = node.parentElement;
  if (!parent || !node.data.trim()) return;
  const cs = getComputedStyle(parent);
  if (cs.visibility !== 'visible') return;
  const color = parseColor(cs.color);
  if (!color) return;
  const alpha = inheritedAlpha * color.a;
  if (alpha <= 0.01) return;

  const cssFamily = resolveCssFamily(cs.fontFamily);
  const weight = parseInt(cs.fontWeight, 10) || 400;
  const italic = cs.fontStyle === 'italic' || cs.fontStyle.startsWith('oblique');
  const face = cssFamily ? matchBookFontFace(cssFamily, weight, italic) : undefined;
  if (face) await ensureFontRegistered(ctx, face);
  const fontSizePt = parseFloat(cs.fontSize) * ctx.k * (72 / 25.4);
  const letterSpacingMm = cs.letterSpacing === 'normal' ? 0 : (parseFloat(cs.letterSpacing) || 0) * ctx.k;
  const ascent = fontAscentPx(ctx, cs);
  const clip = clipRectFor(ctx, parent);
  const clamp = clampContainerOf(ctx, parent);
  const transform = cs.textTransform;

  const setTextStyle = () => {
    if (face) ctx.doc.setFont(face.file, 'normal');
    else ctx.doc.setFont(/sans/i.test(cs.fontFamily) ? 'helvetica' : 'times', weight >= 600 ? (italic ? 'bolditalic' : 'bold') : italic ? 'italic' : 'normal');
    ctx.doc.setFontSize(fontSizePt);
    ctx.doc.setTextColor(Math.round(color.r), Math.round(color.g), Math.round(color.b));
  };
  const drawAt = (text: string, xPx: number, baselinePx: number) => {
    setTextStyle();
    setOpacity(ctx, alpha);
    ctx.doc.text(text, mmX(ctx, xPx), mmY(ctx, baselinePx), {
      baseline: 'alphabetic',
      ...(letterSpacingMm ? { charSpace: letterSpacingMm } : {}),
    });
    setOpacity(ctx, 1);
  };

  const range = document.createRange();
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(node.data))) {
    range.setStart(node, m.index);
    range.setEnd(node, m.index + m[0].length);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    if (rects.length === 0) continue;
    // A word broken across lines (rare) is drawn character by character.
    const pieces: Array<{ text: string; rect: DOMRect }> =
      rects.length === 1
        ? [{ text: m[0], rect: rects[0] }]
        : Array.from(m[0]).flatMap((ch, i) => {
            range.setStart(node, m!.index + i);
            range.setEnd(node, m!.index + i + ch.length);
            const r = range.getClientRects()[0];
            return r ? [{ text: ch, rect: r }] : [];
          });
    for (const piece of pieces) {
      const word =
        transform === 'uppercase'
          ? piece.text.toLocaleUpperCase('es')
          : transform === 'lowercase'
          ? piece.text.toLocaleLowerCase('es')
          : transform === 'capitalize'
          ? piece.text.charAt(0).toLocaleUpperCase('es') + piece.text.slice(1)
          : piece.text;
      const r = piece.rect;
      if (!isInside(r, clip)) {
        // Hidden by line-clamp / truncate: end the visible text with «…» as the browser does.
        if (clamp && !ctx.ellipsisDone.has(clamp)) {
          const last = ctx.lastWordInClamp.get(clamp);
          if (last) last.draw('…', last.right);
          ctx.ellipsisDone.add(clamp);
        }
        continue;
      }
      const baseline = r.top + ascent;
      // Symbols the embedded fonts lack (e.g. ❦ ❖) are drawn exactly as the browser shows them.
      if (!EMBEDDABLE_TEXT.test(word)) {
        drawWordAsImage(ctx, word, r, cs, alpha);
        continue;
      }
      drawAt(word, r.left, baseline);
      if (clamp) {
        ctx.lastWordInClamp.set(clamp, { right: r.right, baseline, draw: (t, x) => drawAt(t, x, baseline) });
      }
    }
  }
  range.detach?.();
}

function paintBox(
  ctx: PageContext,
  el: HTMLElement,
  cs: CSSStyleDeclaration,
  alpha: number,
  options: { borderOnly?: boolean } = {}
) {
  const { doc } = ctx;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return;
  const bg = options.borderOnly ? null : parseColor(cs.backgroundColor);

  // Rotated shapes (e.g. the diamond of the ornaments): drawn as a polygon. Tailwind v4 rotates
  // with the individual `rotate` property; `transform` may hold a matrix as well.
  let [a, b, c, d] = [1, 0, 0, 1];
  const tm = cs.transform && cs.transform !== 'none' ? cs.transform.match(/matrix\(([^)]+)\)/) : null;
  if (tm) [a, b, c, d] = tm[1].split(',').map(Number);
  const rot = (cs as CSSStyleDeclaration & { rotate?: string }).rotate;
  if (rot && rot !== 'none') {
    const m = rot.match(/(-?[\d.]+)(deg|rad|turn)/);
    if (m) {
      const v = parseFloat(m[1]);
      const ang = m[2] === 'rad' ? v : m[2] === 'turn' ? v * 2 * Math.PI : (v * Math.PI) / 180;
      const [ca, sa] = [Math.cos(ang), Math.sin(ang)];
      [a, b, c, d] = [ca * a - sa * b, sa * a + ca * b, ca * c - sa * d, sa * c + ca * d];
    }
  }
  if (Math.abs(b) > 1e-6 || Math.abs(c) > 1e-6) {
    if (bg && bg.a > 0) {
      const w = el.offsetWidth / 2;
      const h = el.offsetHeight / 2;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const pts = [
        [-w, -h],
        [w, -h],
        [w, h],
        [-w, h],
      ].map(([x, y]) => [mmX(ctx, cx + a * x + c * y), mmY(ctx, cy + b * x + d * y)]);
      doc.setFillColor(Math.round(bg.r), Math.round(bg.g), Math.round(bg.b));
      setOpacity(ctx, alpha * bg.a);
      doc.triangle(pts[0][0], pts[0][1], pts[1][0], pts[1][1], pts[2][0], pts[2][1], 'F');
      doc.triangle(pts[0][0], pts[0][1], pts[2][0], pts[2][1], pts[3][0], pts[3][1], 'F');
      setOpacity(ctx, 1);
      return;
    }
  }

  const x = mmX(ctx, r.left);
  const y = mmY(ctx, r.top);
  const w = r.width * ctx.k;
  const h = r.height * ctx.k;
  const radiusPx = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, r.width / 2, r.height / 2);
  const radius = radiusPx * ctx.k;

  if (bg && bg.a > 0) {
    doc.setFillColor(Math.round(bg.r), Math.round(bg.g), Math.round(bg.b));
    setOpacity(ctx, alpha * bg.a);
    if (radius > 0.01) doc.roundedRect(x, y, w, h, radius, radius, 'F');
    else doc.rect(x, y, w, h, 'F');
    setOpacity(ctx, 1);
  }

  const sides = (['Top', 'Right', 'Bottom', 'Left'] as const).map((s) => ({
    w: cs[`border${s}Style` as 'borderTopStyle'] === 'none' ? 0 : parseFloat(cs[`border${s}Width` as 'borderTopWidth']) || 0,
    c: parseColor(cs[`border${s}Color` as 'borderTopColor']),
  }));
  const visible = sides.filter((s) => s.w > 0 && s.c && s.c.a > 0);
  if (visible.length === 0) return;
  const uniform =
    visible.length === 4 &&
    sides.every((s) => Math.abs(s.w - sides[0].w) < 0.01 && s.c && sides[0].c && toCss(s.c) === toCss(sides[0].c!) && s.c.a === sides[0].c!.a);
  if (uniform) {
    const bw = sides[0].w * ctx.k;
    const c = sides[0].c!;
    doc.setDrawColor(Math.round(c.r), Math.round(c.g), Math.round(c.b));
    doc.setLineWidth(bw);
    setOpacity(ctx, alpha * c.a);
    const inset = bw / 2;
    if (radius > 0.01) doc.roundedRect(x + inset, y + inset, w - bw, h - bw, Math.max(0, radius - inset), Math.max(0, radius - inset), 'S');
    else doc.rect(x + inset, y + inset, w - bw, h - bw, 'S');
    setOpacity(ctx, 1);
    return;
  }
  const [top, right, bottom, left] = sides;
  const fillSide = (s: { w: number; c: Rgba | null }, rx: number, ry: number, rw: number, rh: number) => {
    if (!(s.w > 0 && s.c && s.c.a > 0)) return;
    doc.setFillColor(Math.round(s.c.r), Math.round(s.c.g), Math.round(s.c.b));
    setOpacity(ctx, alpha * s.c.a);
    doc.rect(rx, ry, rw, rh, 'F');
    setOpacity(ctx, 1);
  };
  fillSide(top, x, y, w, top.w * ctx.k);
  fillSide(bottom, x, y + h - bottom.w * ctx.k, w, bottom.w * ctx.k);
  fillSide(left, x, y, left.w * ctx.k, h);
  fillSide(right, x + w - right.w * ctx.k, y, right.w * ctx.k, h);
}

function roundedClipPath(g: CanvasRenderingContext2D, w: number, h: number, r: number) {
  g.beginPath();
  if (r <= 0) {
    g.rect(0, 0, w, h);
    return;
  }
  g.moveTo(r, 0);
  g.arcTo(w, 0, w, h, r);
  g.arcTo(w, h, 0, h, r);
  g.arcTo(0, h, 0, 0, r);
  g.arcTo(0, 0, w, 0, r);
  g.closePath();
}

async function drawImage(ctx: PageContext, img: HTMLImageElement, alpha: number) {
  if (!img.complete || img.naturalWidth === 0) {
    try {
      await img.decode();
    } catch {
      return;
    }
  }
  if (img.naturalWidth === 0) return;
  const box = img.getBoundingClientRect();
  // The clipping ancestor (photo frame) gives the rounded corners and the colour behind them.
  // V5.7.0: the area is the FRAME (not the <img>: Chrome gives replaced elements `overflow: clip`, so
  // the image's own box used to be taken as the frame and a photo narrower than its frame came out
  // with rounded corners and without the side bands the viewer shows).
  let frame: HTMLElement | null = img.parentElement;
  while (frame && frame !== ctx.root && getComputedStyle(frame).overflowX === 'visible') frame = frame.parentElement;
  const clip = (frame ? clipRectFor(ctx, frame) : null) || box;
  const left = Math.max(clip.left, box.left);
  const top = Math.max(clip.top, box.top);
  const right = Math.min(clip.right, box.right);
  const bottom = Math.min(clip.bottom, box.bottom);
  if (right - left < 0.5 || bottom - top < 0.5) return;

  const frameCs = frame ? getComputedStyle(frame) : null;
  const innerRadius = frameCs
    ? Math.max(0, (parseFloat(frameCs.borderTopLeftRadius) || 0) - (parseFloat(frameCs.borderTopWidth) || 0))
    : 0;
  const clipW = clip.width;
  const clipH = clip.height;

  const scale = Math.min(rasterScale(ctx, PHOTO_DPI), 3000 / Math.max(clipW, clipH));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(clipW * scale));
  canvas.height = Math.max(1, Math.round(clipH * scale));
  const g = canvas.getContext('2d')!;
  g.scale(scale, scale);
  g.fillStyle = toCss(frame ? effectiveBackground(frame, ctx.root) : { r: 255, g: 255, b: 255, a: 1 });
  g.fillRect(0, 0, clipW, clipH);
  roundedClipPath(g, clipW, clipH, Math.min(innerRadius, clipW / 2, clipH / 2));
  g.clip();
  // …and the picture itself never paints outside its own box (the <img> clips its content).
  g.beginPath();
  g.rect(left - clip.left, top - clip.top, right - left, bottom - top);
  g.clip();

  // object-fit / object-position of the <img> inside its (possibly zoomed) box.
  const cs = getComputedStyle(img);
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  let dw = box.width;
  let dh = box.height;
  if (cs.objectFit === 'contain' || cs.objectFit === 'cover') {
    const s = cs.objectFit === 'contain' ? Math.min(box.width / nw, box.height / nh) : Math.max(box.width / nw, box.height / nh);
    dw = nw * s;
    dh = nh * s;
  }
  const [px, py] = (cs.objectPosition || '50% 50%').split(/\s+/).map((v) => (v.endsWith('%') ? parseFloat(v) / 100 : 0.5));
  const dx = box.left + (box.width - dw) * (Number.isFinite(px) ? px : 0.5) - clip.left;
  const dy = box.top + (box.height - dh) * (Number.isFinite(py) ? py : 0.5) - clip.top;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, dx, dy, dw, dh);

  setOpacity(ctx, alpha);
  ctx.doc.addImage(
    canvas.toDataURL('image/jpeg', 0.92),
    'JPEG',
    mmX(ctx, clip.left),
    mmY(ctx, clip.top),
    clipW * ctx.k,
    clipH * ctx.k,
    undefined,
    'MEDIUM'
  );
  setOpacity(ctx, 1);
}

async function drawSvg(ctx: PageContext, svg: SVGSVGElement, alpha: number) {
  const r = svg.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('width', String(r.width));
  clone.setAttribute('height', String(r.height));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const cs = getComputedStyle(svg);
  clone.style.color = cs.color;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    return;
  }
  const scale = rasterScale(ctx, VECTOR_ART_DPI);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(r.width * scale));
  canvas.height = Math.max(1, Math.round(r.height * scale));
  const g = canvas.getContext('2d')!;
  g.drawImage(image, 0, 0, canvas.width, canvas.height);
  setOpacity(ctx, alpha);
  ctx.doc.addImage(canvas.toDataURL('image/png'), 'PNG', mmX(ctx, r.left), mmY(ctx, r.top), r.width * ctx.k, r.height * ctx.k);
  setOpacity(ctx, 1);
}

async function drawElement(ctx: PageContext, el: Element, parentAlpha: number): Promise<void> {
  const cs = getComputedStyle(el);
  if (cs.display === 'none') return;
  const alpha = parentAlpha * (parseFloat(cs.opacity) || 0);
  if (alpha <= 0.01) return;
  if (el instanceof SVGSVGElement) {
    if (cs.visibility === 'visible') await drawSvg(ctx, el, alpha);
    return;
  }
  if (el instanceof HTMLImageElement) {
    if (cs.visibility === 'visible') await drawImage(ctx, el, alpha);
    return;
  }
  if (el instanceof HTMLElement && cs.visibility === 'visible') paintBox(ctx, el, cs, alpha);
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) await drawTextNode(ctx, child as Text, alpha);
    else if (child.nodeType === Node.ELEMENT_NODE) await drawElement(ctx, child as Element, alpha);
  }
  // V5.7.0: in the browser the content of a clipping box (photo frame) never covers its border; the
  // PDF paints in document order, so the border of such a box is drawn again on top of its content.
  if (
    el instanceof HTMLElement &&
    cs.visibility === 'visible' &&
    (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') &&
    el.querySelector('img')
  ) {
    paintBox(ctx, el, cs, alpha, { borderOnly: true });
  }
}

async function waitForImages(root: HTMLElement): Promise<void> {
  await Promise.all(
    Array.from(root.querySelectorAll('img')).map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => undefined)))
  );
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

/** PDF drawn from the viewer's pages (no fallback). */
export async function exportBookPdfFromViewer(params: {
  composed: ComposedBookDocument;
  profile: DemoBasicProfile;
  onProgress?: (pageDone: number, pageTotal: number) => void;
}): Promise<BookPdfExportResult> {
  const measured = await paginateComposedBookByMeasurement(params.composed);
  await ensureBookFontsReady(measured);
  const { format } = measured;
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [format.widthMm, format.heightMm],
    compress: true,
    putOnlyUsedFonts: true,
  });
  doc.setProperties({
    title: measured.editorialConfig.customTitle || 'Mi Historia — YouForever',
    author: measured.editorialConfig.customAuthors || params.profile.displayName || 'YouForever',
    subject: 'Libro autobiográfico — YouForever',
    creator: 'YouForever',
    keywords: 'autobiografía, memoria familiar, legado, YouForever',
  });

  const stage = createBookPageStage(measured);
  const measureCanvas = document.createElement('canvas');
  const registeredFonts = new Set<string>();
  const gstates = new Map<number, unknown>();
  const ascentCache = new Map<string, number>();
  try {
    for (let i = 0; i < measured.pages.length; i++) {
      if (i > 0) doc.addPage([format.widthMm, format.heightMm], 'portrait');
      const root = stage.render(measured.pages[i]);
      await waitForImages(root);
      const rr = root.getBoundingClientRect();
      const ctx: PageContext = {
        doc,
        root,
        originX: rr.left,
        originY: rr.top,
        k: format.widthMm / rr.width,
        registeredFonts,
        gstates,
        measureCtx: measureCanvas.getContext('2d')!,
        ascentCache,
        clipCache: new Map(),
        ellipsisDone: new Set(),
        lastWordInClamp: new Map(),
      };
      await drawElement(ctx, root, 1);
      params.onProgress?.(i + 1, measured.pages.length);
    }
  } finally {
    stage.dispose();
  }

  const pdfBytes = new Uint8Array(doc.output('arraybuffer') as ArrayBuffer);
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  return {
    blob,
    blobUrl: URL.createObjectURL(blob),
    filename: buildSafeDemoPdfFilename(params.profile, format.id),
    pageCount: doc.getNumberOfPages(),
    pdfBytes,
    engine: 'viewer',
  };
}

/**
 * The book's PDF as the viewer shows it. If the viewer-identical export fails, the previous
 * generator produces the PDF so the download never fails.
 */
export async function generateBookPdfMatchingViewer(params: {
  composed: ComposedBookDocument;
  profile: DemoBasicProfile;
  onProgress?: (pageDone: number, pageTotal: number) => void;
}): Promise<BookPdfExportResult> {
  try {
    return await exportBookPdfFromViewer(params);
  } catch (err) {
    console.warn('[BookPdf] PDF idéntico al visualizador no disponible; se usa el generador anterior:', err);
    await preloadBookResourcesForPdf(params.composed);
    const legacy = generateRealDemoBookPdf({ composed: params.composed, profile: params.profile });
    return { ...legacy, engine: 'legacy' } as BookPdfExportResult;
  }
}

/** Exposed for tests: mm of paper per reference CSS px. */
export const __bookPdfScale = getBookMmPerReferencePx;
export const __primaryFontFamily = primaryFontFamily;
