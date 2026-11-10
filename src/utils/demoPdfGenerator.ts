import { jsPDF } from 'jspdf';
import {
  ComposedBookDocument,
  ComposedBookPage,
  DemoBasicProfile,
  DemoInMemoryPhoto,
  DemoInteriorStyleSpec,
  DemoThematicIllustrationId,
  buildSafeDemoPdfFilename,
} from '../logic/demoStoryRules.ts';
import { drawForeverYouHorizontalLockupOnCanvas } from './foreverYouLogoDraw.ts';

// Cache of decoded HTMLImageElement instances keyed by photo id or src so high-DPI canvas rendering is synchronous
const decodedImageCache = new Map<string, HTMLImageElement>();

function getPhotoSrc(photo: DemoInMemoryPhoto | null | undefined): string {
  if (!photo) return '';
  return (photo.dataUrl && photo.dataUrl.startsWith('data:image/'))
    ? photo.dataUrl
    : photo.objectUrl || photo.dataUrl || '';
}

function decodeSingleImage(src: string): Promise<HTMLImageElement | null> {
  if (!src || typeof Image === 'undefined') return Promise.resolve(null);
  const cached = decodedImageCache.get(src);
  if (cached && cached.complete && cached.naturalWidth > 0) {
    return Promise.resolve(cached);
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      decodedImageCache.set(src, img);
      resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Ensures all Google Fonts and any cover/chapter photographs in `composed` are decoded in memory
 * before rendering the 1:1 high-definition pages into the PDF document.
 */
export async function preloadBookResourcesForPdf(
  composed: ComposedBookDocument
): Promise<void> {
  if (typeof document === 'undefined') return;
  try {
    if ((document as any).fonts && (document as any).fonts.ready) {
      await Promise.race([
        (document as any).fonts.ready,
        new Promise((r) => setTimeout(r, 1500)),
      ]);
    }
  } catch (_e) {
    // Ignore font readiness errors
  }

  const srcs = new Set<string>();
  const coverSrc = getPhotoSrc(composed.coverPhoto);
  if (coverSrc) srcs.add(coverSrc);

  for (const page of composed.pages) {
    for (const sec of page.sections || []) {
      const s = getPhotoSrc(sec.photo);
      if (s) srcs.add(s);
    }
  }

  await Promise.all(Array.from(srcs).map((s) => decodeSingleImage(s)));
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = (hex || '').replace('#', '').trim();
  if (clean.length !== 6) return [30, 30, 30];
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  return [r, g, b];
}

function hexWithAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function stripInlineFormatting(text: string): string {
  return (text || '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .trim();
}

interface InlineStyledSegment {
  text: string;
  style: 'normal' | 'bold' | 'italic';
}

function parseInlineSegments(raw: string): InlineStyledSegment[] {
  const parts = (raw || '').split(/(\*\*.*?\*\*|\*.*?\*)/g);
  const out: InlineStyledSegment[] = [];
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      out.push({ text: part.slice(2, -2), style: 'bold' });
    } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      out.push({ text: part.slice(1, -1), style: 'italic' });
    } else {
      out.push({ text: part, style: 'normal' });
    }
  }
  return out;
}

// ============================================================================
// 1:1 HIGH-DEFINITION VIEWER-IDENTICAL CANVAS PAGE RENDERER (300+ DPI)
// Mirrors `DemoComposedPageView` (`src/components/DemoBookPageRenderer.tsx`)
// using the exact CSS font families, ornament dividers, SVG paths, drop caps,
// frames, colors, and proportional sizes shown in the interactive viewer.
// ============================================================================

interface CanvasWordToken {
  word: string;
  style: 'normal' | 'bold' | 'italic';
  widthPx: number;
  spaceWidthPx: number;
}

function buildCanvasFontString(
  style: 'normal' | 'bold' | 'italic' | 'bold_italic',
  sizePx: number,
  fontFamily: string
): string {
  const italicPart = style === 'italic' || style === 'bold_italic' ? 'italic ' : '';
  const weightPart = style === 'bold' || style === 'bold_italic' ? '700 ' : '400 ';
  return `${italicPart}${weightPart}${sizePx}px ${fontFamily}`;
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Draws the exact ornament divider from `renderOrnamentDivider` in `DemoBookPageRenderer.tsx`:
 * - `classic_line`: flanking lines + rotated 45° diamond (`◆`)
 * - `diamond_flourish`: flanking lines + 2 small dots + central rotated 45° diamond (`• ◆ •`)
 * - `journal_script`: flanking lines + 2 small dots (`• •`)
 * - `minimal_bar`: rounded horizontal bar (`━━━`)
 * - `botanical_leaf`: flanking lines + floral leaf (`❦`) + lower horizontal line
 */
function drawViewerOrnamentOnCanvas(
  ctx: CanvasRenderingContext2D,
  ornamentStyle: DemoInteriorStyleSpec['ornamentStyle'],
  cx: number,
  cy: number,
  accentHex: string
): void {
  ctx.save();
  ctx.fillStyle = accentHex;
  ctx.strokeStyle = accentHex;

  if (ornamentStyle === 'minimal_bar') {
    drawRoundedRectPath(ctx, cx - 16, cy - 1, 32, 2, 1);
    ctx.fill();
    ctx.restore();
    return;
  }

  if (ornamentStyle === 'journal_script') {
    ctx.globalAlpha = 0.75;
    ctx.fillRect(cx - 32, cy - 0.5, 20, 1);
    ctx.fillRect(cx + 12, cy - 0.5, 20, 1);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(cx - 4, cy, 2, 0, Math.PI * 2);
    ctx.arc(cx + 4, cy, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  if (ornamentStyle === 'botanical_leaf') {
    ctx.fillRect(cx - 34, cy - 3.5, 22, 1.4);
    ctx.fillRect(cx + 12, cy - 3.5, 22, 1.4);
    ctx.font = `400 11px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('❦', cx, cy - 2.5);
    ctx.globalAlpha = 0.7;
    ctx.fillRect(cx - 16, cy + 4.5, 32, 1);
    ctx.restore();
    return;
  }

  if (ornamentStyle === 'diamond_flourish') {
    ctx.globalAlpha = 0.75;
    ctx.fillRect(cx - 42, cy - 0.5, 24, 1);
    ctx.fillRect(cx + 18, cy - 0.5, 24, 1);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(cx - 10, cy, 2, 0, Math.PI * 2);
    ctx.arc(cx + 10, cy, 2, 0, Math.PI * 2);
    ctx.fill();
    // Central rotated 45° diamond
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-3, -3, 6, 6);
    ctx.restore();
    ctx.restore();
    return;
  }

  // `classic_line` default: two 28px lines + central rotated 45° diamond
  ctx.fillRect(cx - 39, cy - 0.5, 28, 1);
  ctx.fillRect(cx + 11, cy - 0.5, 28, 1);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-3, -3, 6, 6);
  ctx.restore();
  ctx.restore();
}

/**
 * Draws the exact SVG paths from `ThematicIllustrationSvg` (`DemoBookPageRenderer.tsx` lines 18-85)
 * scaled into a `sizePx × sizePx` box centered at `(cx, cy)`.
 */
function drawViewerThematicIllustrationOnCanvas(
  ctx: CanvasRenderingContext2D,
  id: DemoThematicIllustrationId,
  cx: number,
  cy: number,
  sizePx: number,
  colorHex: string
): void {
  ctx.save();
  const scale = sizePx / 120;
  ctx.translate(cx - sizePx / 2, cy - sizePx / 2);
  ctx.scale(scale, scale);
  ctx.strokeStyle = colorHex;
  ctx.fillStyle = colorHex;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Outer circles: r=52 (opacity 0.85), r=47 (opacity 0.55)
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(60, 60, 52, 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.arc(60, 60, 47, 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalAlpha = 1;

  if (id === 'arbol_raices' && typeof Path2D !== 'undefined') {
    ctx.lineWidth = 2.2;
    ctx.stroke(new Path2D('M60 88V42'));
    ctx.lineWidth = 1.6;
    ctx.stroke(new Path2D('M60 58C50 50 42 42 38 33'));
    ctx.stroke(new Path2D('M60 54C70 46 78 39 82 31'));
    ctx.lineWidth = 1.3;
    ctx.stroke(new Path2D('M60 45C53 38 48 31 46 25'));
    ctx.stroke(new Path2D('M60 45C67 38 72 31 74 25'));
    ctx.stroke(new Path2D('M60 88C52 93 45 97 40 101'));
    ctx.stroke(new Path2D('M60 88C68 93 75 97 80 101'));
    ctx.stroke(new Path2D('M60 88V103'));
    for (const [px, py] of [
      [38, 32],
      [82, 30],
      [60, 23],
    ]) {
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (id === 'pluma_tinta' && typeof Path2D !== 'undefined') {
    ctx.lineWidth = 1.6;
    ctx.stroke(new Path2D('M38 80L78 32L86 40L46 84L34 86L38 80Z'));
    ctx.beginPath();
    ctx.arc(58, 60, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.stroke(new Path2D('M34 93H86'));
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 0.9;
    ctx.stroke(new Path2D('M42 99H78'));
  } else if (id === 'brujula_camino' && typeof Path2D !== 'undefined') {
    ctx.lineWidth = 1.5;
    ctx.stroke(new Path2D('M60 20L66 54L100 60L66 66L60 100L54 66L20 60L54 54L60 20Z'));
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(60, 60, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(60, 60, 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (id === 'hogar_calido' && typeof Path2D !== 'undefined') {
    ctx.lineWidth = 1.6;
    ctx.stroke(
      new Path2D('M38 88V52C38 39.8497 47.8497 30 60 30C72.1503 30 82 39.8497 82 52V88H38Z')
    );
    ctx.lineWidth = 1.1;
    ctx.stroke(new Path2D('M60 30V88'));
    ctx.stroke(new Path2D('M38 59H82'));
    ctx.lineWidth = 1.8;
    ctx.stroke(new Path2D('M32 88H88'));
  } else if (typeof Path2D !== 'undefined') {
    ctx.lineWidth = 1.3;
    ctx.setLineDash([2, 2]);
    ctx.stroke(new Path2D('M36 74L48 44L68 52L84 34'));
    ctx.setLineDash([]);
    ctx.stroke(new Path2D('M48 44L64 82L84 66'));
    for (const [px, py, r] of [
      [36, 74, 3],
      [48, 44, 3.5],
      [68, 52, 3],
      [84, 34, 3.5],
      [64, 82, 3],
      [84, 66, 2.5],
    ]) {
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

function drawViewerPhotoBoxOnCanvas(params: {
  ctx: CanvasRenderingContext2D;
  photo: DemoInMemoryPhoto;
  cx: number;
  topY: number;
  containerW: number;
  boxHeightPx: number;
  borderColorHex: string;
  captionFontFamily: string;
  captionColorHex: string;
}): number {
  const {
    ctx,
    photo,
    cx,
    topY,
    containerW,
    boxHeightPx,
    borderColorHex,
    captionFontFamily,
    captionColorHex,
  } = params;

  const boxW = containerW * 0.8;
  const boxX = cx - boxW / 2;
  const captionSpace = photo.caption ? 16 : 0;
  const frameH = Math.max(40, boxHeightPx - captionSpace);

  ctx.save();
  drawRoundedRectPath(ctx, boxX, topY, boxW, frameH, 8);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.04)';
  ctx.fill();
  ctx.clip();

  const src = getPhotoSrc(photo);
  const img = src ? decodedImageCache.get(src) : null;
  if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
    const imgRatio = img.naturalWidth / img.naturalHeight;
    const boxRatio = boxW / frameH;
    let drawW = boxW;
    let drawH = frameH;
    if (imgRatio > boxRatio) {
      drawW = boxW;
      drawH = boxW / imgRatio;
    } else {
      drawH = frameH;
      drawW = frameH * imgRatio;
    }
    const zoom = photo.zoom || 1;
    drawW *= zoom;
    drawH *= zoom;
    const drawX = boxX + (boxW - drawW) / 2;
    const drawY =
      photo.focusY === 'top'
        ? topY
        : photo.focusY === 'bottom'
        ? topY + frameH - drawH
        : topY + (frameH - drawH) / 2;
    ctx.drawImage(img, drawX, drawY, drawW, drawH);
  }
  ctx.restore();

  // Rounded border around photo frame
  ctx.save();
  drawRoundedRectPath(ctx, boxX, topY, boxW, frameH, 8);
  ctx.strokeStyle = borderColorHex;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  let nextY = topY + frameH + 4;
  if (photo.caption && photo.caption.trim()) {
    ctx.save();
    ctx.font = buildCanvasFontString('italic', 10, captionFontFamily);
    ctx.fillStyle = captionColorHex;
    ctx.globalAlpha = 0.85;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(stripInlineFormatting(photo.caption), cx, nextY, boxW);
    ctx.restore();
    nextY += 14;
  }

  return nextY + 4;
}

function wrapPlainTextCanvas(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidthPx: number,
  maxLines?: number
): string[] {
  const words = (text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = words[0];

  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidthPx) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  if (current) lines.push(current);

  if (maxLines && lines.length > maxLines) {
    return lines.slice(0, maxLines);
  }
  return lines;
}

function renderRichParagraphOnCanvas(params: {
  ctx: CanvasRenderingContext2D;
  rawText: string;
  bodyFontFamily: string;
  titleFontFamily: string;
  fontSizePx: number;
  lineHeightPx: number;
  textHex: string;
  accentHex: string;
  leftX: number;
  startY: number;
  maxWidthPx: number;
  maxBottomY: number;
  textAlign: 'justify' | 'left';
  useDropCap: boolean;
  measureOnly?: boolean;
}): number {
  const {
    ctx,
    rawText,
    bodyFontFamily,
    titleFontFamily,
    fontSizePx,
    lineHeightPx,
    textHex,
    accentHex,
    leftX,
    startY,
    maxWidthPx,
    maxBottomY,
    textAlign,
    useDropCap,
    measureOnly = false,
  } = params;

  const trimmed = (rawText || '').trim();
  if (!trimmed) return startY;

  let workingText = trimmed;
  let dropCapChar = '';
  let dropCapIndentPx = 0;
  const dropCapLinesCount = 2;
  const dropFontSizePx = Math.round(fontSizePx * 2.25);

  if (useDropCap) {
    const cleanDropCheck = workingText.replace(/^(\*\*|\*)+/, '');
    if (cleanDropCheck.length > 1) {
      dropCapChar = cleanDropCheck.charAt(0);
      const firstCharIdx = workingText.indexOf(dropCapChar);
      if (firstCharIdx !== -1) {
        workingText =
          workingText.slice(0, firstCharIdx) + workingText.slice(firstCharIdx + 1);
      }
      ctx.font = buildCanvasFontString('bold', dropFontSizePx, titleFontFamily);
      dropCapIndentPx = ctx.measureText(dropCapChar).width + 8;
    }
  }

  if (dropCapChar && !measureOnly) {
    ctx.save();
    ctx.font = buildCanvasFontString('bold', dropFontSizePx, titleFontFamily);
    ctx.fillStyle = accentHex;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(dropCapChar, leftX, startY + 1);
    ctx.restore();
  }

  const segments = parseInlineSegments(workingText);
  const tokens: CanvasWordToken[] = [];

  for (const seg of segments) {
    ctx.font = buildCanvasFontString(seg.style, fontSizePx, bodyFontFamily);
    const spaceW = ctx.measureText(' ').width;
    const matches = seg.text.match(/(\S+)(\s*)/g) || [];
    for (const m of matches) {
      const wm = m.match(/^(\S+)(\s*)$/);
      if (!wm) continue;
      const word = wm[1];
      const hasSpace = Boolean(wm[2] && wm[2].length > 0);
      tokens.push({
        word,
        style: seg.style,
        widthPx: ctx.measureText(word).width,
        spaceWidthPx: hasSpace ? spaceW : 0,
      });
    }
  }

  const lines: Array<{
    tokens: CanvasWordToken[];
    lineLeftX: number;
    availWidthPx: number;
  }> = [];

  let currentLine: CanvasWordToken[] = [];
  let currentW = 0;
  let lineIdx = 0;

  const getLineGeom = (idx: number) => {
    const indent = dropCapChar && idx < dropCapLinesCount ? dropCapIndentPx : 0;
    return {
      lineLeftX: leftX + indent,
      availWidthPx: Math.max(40, maxWidthPx - indent),
    };
  };

  for (const tok of tokens) {
    const geom = getLineGeom(lineIdx);
    const prevSpace =
      currentLine.length > 0 ? currentLine[currentLine.length - 1].spaceWidthPx : 0;
    if (currentLine.length > 0 && currentW + prevSpace + tok.widthPx > geom.availWidthPx) {
      lines.push({
        tokens: currentLine,
        lineLeftX: geom.lineLeftX,
        availWidthPx: geom.availWidthPx,
      });
      lineIdx++;
      currentLine = [tok];
      currentW = tok.widthPx;
    } else {
      currentLine.push(tok);
      currentW += prevSpace + tok.widthPx;
    }
  }
  if (currentLine.length > 0) {
    const geom = getLineGeom(lineIdx);
    lines.push({
      tokens: currentLine,
      lineLeftX: geom.lineLeftX,
      availWidthPx: geom.availWidthPx,
    });
  }

  let cursorY = startY;
  ctx.fillStyle = textHex;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  for (let i = 0; i < lines.length; i++) {
    if (cursorY + fontSizePx > maxBottomY) break;
    const ln = lines[i];
    const isLastLine = i === lines.length - 1;
    const gaps = ln.tokens.filter(
      (t, idx) => idx < ln.tokens.length - 1 && t.spaceWidthPx > 0
    ).length;
    const wordsW = ln.tokens.reduce((acc, t) => acc + t.widthPx, 0);
    const spacesW = ln.tokens.reduce(
      (acc, t, idx) => acc + (idx < ln.tokens.length - 1 ? t.spaceWidthPx : 0),
      0
    );
    const totalW = wordsW + spacesW;
    const shouldJustify =
      textAlign === 'justify' &&
      !isLastLine &&
      gaps > 0 &&
      totalW >= ln.availWidthPx * 0.72;
    const extraGap = shouldJustify
      ? Math.min(7, Math.max(0, (ln.availWidthPx - totalW) / gaps))
      : 0;

    if (!measureOnly) {
      let x = ln.lineLeftX;
      for (let tIdx = 0; tIdx < ln.tokens.length; tIdx++) {
        const tok = ln.tokens[tIdx];
        ctx.font = buildCanvasFontString(tok.style, fontSizePx, bodyFontFamily);
        ctx.fillText(tok.word, x, cursorY);
        x += tok.widthPx;
        if (tIdx < ln.tokens.length - 1 && tok.spaceWidthPx > 0) {
          x += tok.spaceWidthPx + extraGap;
        }
      }
    }
    cursorY += lineHeightPx;
  }

  if (dropCapChar && lines.length < dropCapLinesCount) {
    cursorY = Math.max(cursorY, startY + dropCapLinesCount * lineHeightPx);
  }

  return cursorY;
}

/**
 * Renders a single `ComposedBookPage` onto an offscreen high-DPI `<canvas>` (3.2x resolution)
 * matching `DemoComposedPageView` (`src/components/DemoBookPageRenderer.tsx`) 1:1.
 */
function renderPageToViewerIdenticalDataUrl(
  composed: ComposedBookDocument,
  page: ComposedBookPage
): string | null {
  if (typeof document === 'undefined') return null;

  const { format, coverDesign, coverPalette, interiorStyle, editorialConfig, coverPhoto } =
    composed;

  // Virtual CSS viewport width matching the interactive viewer's proportions per physical format
  const vw = format.id === 'carta' ? 440 : format.id === 'a5' ? 320 : 380;
  const vh = Math.round(vw * (format.heightMm / format.widthMm));
  const dpiScale = 3.2;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vw * dpiScale);
  canvas.height = Math.round(vh * dpiScale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.scale(dpiScale, dpiScale);

  // Format-dependent padding and typography scale identical to DemoComposedPageView
  const padPx = format.id === 'carta' ? 38 : format.id === 'a5' ? 24 : 28;
  const bodyFontPx = format.id === 'carta' ? 13.5 : format.id === 'a5' ? 11.5 : 12.5;
  const bodyLineHeightPx = Math.round(bodyFontPx * 1.62 * 10) / 10;
  const chapterTitleFontPx = format.id === 'carta' ? 18 : format.id === 'a5' ? 14 : 16;

  // ==========================================================================
  // PAGE 1: COVER (`page.kind === 'cover'`)
  // ==========================================================================
  if (page.kind === 'cover') {
    ctx.fillStyle = coverPalette.bgHex;
    ctx.fillRect(0, 0, vw, vh);

    const hasLeftSpine = coverDesign.id === 'clasica_eterna';
    const leftPad = hasLeftSpine ? 44 : 34;
    const rightPad = hasLeftSpine ? 30 : 34;
    const topPad = 34;
    const bottomPad = 34;
    const usableW = vw - leftPad - rightPad;
    const cx = leftPad + usableW / 2;

    // Cover Architectural Framing (exact match with DemoBookPageRenderer.tsx lines 460-510)
    if (coverDesign.id === 'clasica_eterna') {
      ctx.fillStyle = coverPalette.secondaryBgHex;
      ctx.fillRect(0, 0, 16, vh);

      ctx.strokeStyle = coverPalette.accentHex;
      ctx.lineWidth = 2;
      ctx.strokeRect(28, 16, vw - 44, vh - 32);

      ctx.strokeStyle = coverPalette.borderHex;
      ctx.lineWidth = 1;
      ctx.strokeRect(32, 20, vw - 52, vh - 40);
    } else if (coverDesign.id === 'recuerdos_marfil') {
      ctx.strokeStyle = coverPalette.borderHex;
      ctx.lineWidth = 1;
      ctx.strokeRect(20, 20, vw - 40, vh - 40);
    } else if (coverDesign.id === 'album_nuestra_vida') {
      ctx.save();
      drawRoundedRectPath(ctx, 16, 16, vw - 32, vh - 32, 12);
      ctx.fillStyle = coverPalette.secondaryBgHex;
      ctx.fill();
      ctx.strokeStyle = coverPalette.accentHex;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    } else if (coverDesign.id === 'raices_recuerdos') {
      ctx.strokeStyle = coverPalette.borderHex;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(18, 18, vw - 36, vh - 36);
    } else if (coverDesign.id === 'historia_contemporanea') {
      const topH = Math.round(vh * 0.36);
      ctx.fillStyle = coverPalette.secondaryBgHex;
      ctx.fillRect(0, 0, vw, topH);
      ctx.fillStyle = coverPalette.accentHex;
      ctx.fillRect(0, topH - 1.5, vw, 3);
    }

    // Header: Authors, Title, Subtitle
    let cursorY = topPad + 6;
    const authorsStr = stripInlineFormatting(page.authors || '').toUpperCase();
    if (authorsStr) {
      ctx.save();
      ctx.font = buildCanvasFontString('bold', 10, coverDesign.bodyFontFamily);
      ctx.fillStyle = coverPalette.accentHex;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      // Wide letter spacing simulation
      const spacedAuthors = authorsStr.split('').join('\u200A');
      const authLines = wrapPlainTextCanvas(ctx, spacedAuthors, usableW - 12, 1);
      for (const ln of authLines) {
        ctx.fillText(ln, cx, cursorY);
        cursorY += 14;
      }
      ctx.restore();
      cursorY += 6;
    }

    const coverTitleFontPx =
      format.id === 'carta' ? 21 : format.id === 'a5' ? 17.5 : 19.5;
    ctx.save();
    ctx.font = buildCanvasFontString('bold', coverTitleFontPx, coverDesign.titleFontFamily);
    ctx.fillStyle = coverPalette.textHex;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const titleLines = wrapPlainTextCanvas(
      ctx,
      stripInlineFormatting(page.title || 'Mi Historia'),
      usableW - 8,
      3
    );
    for (const ln of titleLines) {
      ctx.fillText(ln, cx, cursorY);
      cursorY += Math.round(coverTitleFontPx * 1.28);
    }
    ctx.restore();

    if (page.subtitle && page.subtitle.trim()) {
      cursorY += 5;
      ctx.save();
      ctx.font = buildCanvasFontString(
        'italic',
        12,
        coverDesign.accentFontFamily || coverDesign.bodyFontFamily
      );
      ctx.fillStyle = coverPalette.subtextHex;
      ctx.globalAlpha = 0.9;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const subLines = wrapPlainTextCanvas(
        ctx,
        stripInlineFormatting(page.subtitle),
        usableW * 0.92,
        2
      );
      for (const ln of subLines) {
        ctx.fillText(ln, cx, cursorY);
        cursorY += 16;
      }
      ctx.restore();
    }

    // Footer: YouForever • Edición Conmemorativa strictly inside border
    const footerY = vh - bottomPad - 10;
    if (composed.useOfficialForeverYouLogo) {
      drawForeverYouHorizontalLockupOnCanvas({
        ctx,
        x: cx,
        y: footerY + 5,
        align: 'center',
        symbolWidthPx: 18,
        gapPx: 6,
        labelText: 'YOUFOREVER • EDICIÓN CONMEMORATIVA',
        fontCss: buildCanvasFontString('normal', 9.2, coverDesign.bodyFontFamily),
        colorHex: coverPalette.subtextHex,
        symbolColorHex: coverPalette.accentHex,
        letterSpacingPx: 1.1,
      });
    } else {
      ctx.save();
      ctx.font = buildCanvasFontString('normal', 9.5, coverDesign.bodyFontFamily);
      ctx.fillStyle = coverPalette.subtextHex;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const imprintText = 'YOUFOREVER • EDICIÓN CONMEMORATIVA'.split('').join('\u200A');
      ctx.fillText(imprintText, cx, footerY, usableW);
      ctx.restore();
    }

    // Centerpiece: Photo, Thematic Illustration, or Typographic Ornament (`─── ❖ ───`)
    const centerTop = cursorY + 10;
    const centerBottom = footerY - 10;
    const availCenterH = Math.max(40, centerBottom - centerTop);
    const centerY = centerTop + availCenterH / 2;

    if (editorialConfig.coverVisualType === 'photo' && coverPhoto) {
      const targetPhotoH = Math.min(
        availCenterH - 6,
        format.id === 'a5' ? 112 : format.id === 'carta' ? 144 : 128
      );
      drawViewerPhotoBoxOnCanvas({
        ctx,
        photo: coverPhoto,
        cx,
        topY: centerY - targetPhotoH / 2,
        containerW: usableW,
        boxHeightPx: targetPhotoH,
        borderColorHex: coverPalette.accentHex,
        captionFontFamily: coverDesign.bodyFontFamily,
        captionColorHex: coverPalette.subtextHex,
      });
    } else if (editorialConfig.coverVisualType === 'illustration') {
      const illSize = Math.min(
        availCenterH - 8,
        format.id === 'carta' ? 112 : format.id === 'a5' ? 80 : 96
      );
      drawViewerThematicIllustrationOnCanvas(
        ctx,
        editorialConfig.coverIllustrationId,
        cx,
        centerY,
        illSize,
        coverPalette.accentHex
      );
    } else {
      // Exact match with viewer: two 40px lines flanking `❖`
      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = coverPalette.accentHex;
      ctx.fillRect(cx - 56, centerY - 0.5, 40, 1);
      ctx.fillRect(cx + 16, centerY - 0.5, 40, 1);
      ctx.font = `400 14px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('❖', cx, centerY);
      ctx.restore();
    }

    return canvas.toDataURL('image/jpeg', 0.96);
  }

  // Common background and optional interior frame for Page 2, Chapter pages, and Closing page
  ctx.fillStyle = interiorStyle.pageBgHex;
  ctx.fillRect(0, 0, vw, vh);

  if (interiorStyle.id === 'legado_familiar' || interiorStyle.id === 'diario_intimo') {
    const inset = page.kind === 'chapter_content' ? 10 : 12;
    ctx.strokeStyle = hexWithAlpha(interiorStyle.accentHex, 0.25);
    ctx.lineWidth = 1;
    ctx.strokeRect(inset, inset, vw - inset * 2, vh - inset * 2);
  }

  const contentLeft = padPx;
  const contentW = vw - padPx * 2;
  const cx = vw / 2;

  // ==========================================================================
  // PAGE 2: PORTADILLA, DEDICATORIA E INTRODUCCIÓN (`page.kind === 'title_dedication'`)
  // ==========================================================================
  if (page.kind === 'title_dedication') {
    let cursorY = padPx + 12;

    // Title
    ctx.save();
    ctx.font = buildCanvasFontString('bold', chapterTitleFontPx, interiorStyle.titleFontFamily);
    ctx.fillStyle = interiorStyle.textHex;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const titleLines = wrapPlainTextCanvas(
      ctx,
      stripInlineFormatting(page.title || 'Mi Historia'),
      contentW - 12,
      3
    );
    for (const ln of titleLines) {
      ctx.fillText(ln, cx, cursorY);
      cursorY += Math.round(chapterTitleFontPx * 1.32);
    }
    ctx.restore();

    // Authors
    if (page.authors) {
      cursorY += 6;
      ctx.save();
      ctx.font = buildCanvasFontString('italic', 13, interiorStyle.bodyFontFamily);
      ctx.fillStyle = interiorStyle.accentHex;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(stripInlineFormatting(page.authors), cx, cursorY, contentW);
      ctx.restore();
      cursorY += 20;
    } else {
      cursorY += 10;
    }

    // Ornament divider
    drawViewerOrnamentOnCanvas(ctx, interiorStyle.ornamentStyle, cx, cursorY, interiorStyle.accentHex);
    cursorY += 16;

    // Dedication
    if (page.dedication && page.dedication.trim()) {
      const dedFont = interiorStyle.accentFontFamily || interiorStyle.bodyFontFamily;
      ctx.save();
      ctx.font = buildCanvasFontString('italic', 13, dedFont);
      ctx.fillStyle = interiorStyle.textHex;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const dedLines = wrapPlainTextCanvas(
        ctx,
        `«${stripInlineFormatting(page.dedication)}»`,
        contentW - 32,
        6
      );
      for (const ln of dedLines) {
        ctx.fillText(ln, cx, cursorY);
        cursorY += 20;
      }
      ctx.restore();
    }

    // Bottom YouForever mark
    const footerY = vh - padPx - 10;
    if (composed.useOfficialForeverYouLogo) {
      drawForeverYouHorizontalLockupOnCanvas({
        ctx,
        x: cx,
        y: footerY + 5,
        align: 'center',
        symbolWidthPx: 20,
        gapPx: 6,
        labelText: 'YouForever',
        fontCss: buildCanvasFontString('bold', 10.5, "'Plus Jakarta Sans', 'Manrope', sans-serif"),
        colorHex: interiorStyle.mutedHex,
        symbolColorHex: interiorStyle.accentHex,
        opacity: 0.85,
      });
    } else {
      ctx.save();
      ctx.font = buildCanvasFontString('normal', 10, interiorStyle.bodyFontFamily);
      ctx.fillStyle = interiorStyle.mutedHex;
      ctx.globalAlpha = 0.7;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('YouForever', cx, footerY);
      ctx.restore();
    }

    // Introduction centered vertically in remaining middle space with top hairline border (exact match with DemoBookPageRenderer.tsx lines 648-663)
    if (page.introduction && page.introduction.trim()) {
      const measuredEnd = renderRichParagraphOnCanvas({
        ctx,
        rawText: page.introduction,
        bodyFontFamily: interiorStyle.bodyFontFamily,
        titleFontFamily: interiorStyle.titleFontFamily,
        fontSizePx: bodyFontPx,
        lineHeightPx: bodyLineHeightPx,
        textHex: interiorStyle.mutedHex,
        accentHex: interiorStyle.accentHex,
        leftX: contentLeft,
        startY: 0,
        maxWidthPx: contentW,
        maxBottomY: 9999,
        textAlign: interiorStyle.textAlign,
        useDropCap: false,
        measureOnly: true,
      });
      const introBlockH = measuredEnd + 14;
      const availMidTop = cursorY + 12;
      const availMidBottom = footerY - 14;
      const introTopY = Math.max(
        availMidTop,
        availMidTop + (availMidBottom - availMidTop - introBlockH) / 2
      );

      // Top hairline border (`border-t` with `${interiorStyle.accentHex}33`)
      ctx.fillStyle = hexWithAlpha(interiorStyle.accentHex, 0.2);
      ctx.fillRect(contentLeft, introTopY, contentW, 1);

      renderRichParagraphOnCanvas({
        ctx,
        rawText: page.introduction,
        bodyFontFamily: interiorStyle.bodyFontFamily,
        titleFontFamily: interiorStyle.titleFontFamily,
        fontSizePx: bodyFontPx,
        lineHeightPx: bodyLineHeightPx,
        textHex: interiorStyle.mutedHex,
        accentHex: interiorStyle.accentHex,
        leftX: contentLeft,
        startY: introTopY + 12,
        maxWidthPx: contentW,
        maxBottomY: availMidBottom,
        textAlign: interiorStyle.textAlign,
        useDropCap: false,
      });
    }

    return canvas.toDataURL('image/jpeg', 0.96);
  }

  // ==========================================================================
  // FINAL PAGE: MANDATORY CLOSING PAGE (`page.kind === 'closing_mandatory'`)
  // ==========================================================================
  if (page.kind === 'closing_mandatory') {
    const rawClosing = stripInlineFormatting(
      page.centralClosingText || 'Esta historia continuará...'
    );
    const closingFontPx = rawClosing.length > 90 ? 16 : 19;
    ctx.font = buildCanvasFontString('italic', closingFontPx, interiorStyle.titleFontFamily);
    const closingLines = wrapPlainTextCanvas(ctx, rawClosing, contentW - 28, 7);
    const textBlockH = closingLines.length * Math.round(closingFontPx * 1.42);
    const totalCenterGroupH = 18 + textBlockH;
    let groupY = (vh - totalCenterGroupH) / 2;

    // 1. Ornament divider ABOVE closing text (exact match with DemoBookPageRenderer.tsx line 698)
    drawViewerOrnamentOnCanvas(
      ctx,
      interiorStyle.ornamentStyle,
      cx,
      groupY,
      interiorStyle.accentHex
    );
    groupY += 16;

    // 2. Central closing text
    ctx.save();
    ctx.font = buildCanvasFontString('italic', closingFontPx, interiorStyle.titleFontFamily);
    ctx.fillStyle = interiorStyle.textHex;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const ln of closingLines) {
      ctx.fillText(ln, cx, groupY);
      groupY += Math.round(closingFontPx * 1.42);
    }
    ctx.restore();

    // 3. Bottom-right brand (`[Isotipo Y∞F] YouForever` for new books, or `<< YouForever >>` for legacy versions)
    if (composed.useOfficialForeverYouLogo) {
      drawForeverYouHorizontalLockupOnCanvas({
        ctx,
        x: vw - padPx,
        y: vh - padPx - 7,
        align: 'right',
        symbolWidthPx: 26,
        gapPx: 6,
        labelText: 'YouForever',
        fontCss: buildCanvasFontString('bold', 12, "'Plus Jakarta Sans', 'Manrope', sans-serif"),
        colorHex: interiorStyle.accentHex,
        symbolColorHex: interiorStyle.accentHex,
      });
    } else {
      ctx.save();
      ctx.font = buildCanvasFontString('normal', 12, interiorStyle.titleFontFamily);
      ctx.fillStyle = interiorStyle.accentHex;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(
        page.bottomRightBrand || '<< YouForever >>',
        vw - padPx,
        vh - padPx
      );
      ctx.restore();
    }

    return canvas.toDataURL('image/jpeg', 0.96);
  }

  // ==========================================================================
  // MIDDLE PAGES: CHAPTER CONTENT (`page.kind === 'chapter_content'`)
  // ==========================================================================
  let cursorY = padPx;

  // Running header with subtle bottom border (exact match with DemoBookPageRenderer.tsx lines 739-747)
  ctx.save();
  ctx.font = buildCanvasFontString('italic', 9, interiorStyle.bodyFontFamily);
  ctx.fillStyle = interiorStyle.mutedHex;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const runningHeader = stripInlineFormatting(
    composed.editorialConfig.customTitle || 'YouForever • Memoria Autobiográfica'
  );
  ctx.fillText(runningHeader, cx, cursorY, contentW);
  ctx.restore();
  cursorY += 14;

  ctx.fillStyle = hexWithAlpha(interiorStyle.accentHex, 0.16);
  ctx.fillRect(contentLeft, cursorY, contentW, 1);
  cursorY += 12;

  const footerTopY = vh - padPx - 14;
  const maxContentBottomY = footerTopY - 4;
  const sections = page.sections || [];

  for (let sIdx = 0; sIdx < sections.length; sIdx++) {
    const sec = sections[sIdx];
    if (cursorY >= maxContentBottomY - 16) break;

    if (sIdx > 0) {
      cursorY += 4;
      drawViewerOrnamentOnCanvas(
        ctx,
        interiorStyle.ornamentStyle,
        cx,
        cursorY,
        interiorStyle.accentHex
      );
      cursorY += 12;
    }

    if (!sec.isContinuation) {
      // CAPÍTULO N
      ctx.save();
      ctx.font = buildCanvasFontString('bold', 9, interiorStyle.bodyFontFamily);
      ctx.fillStyle = interiorStyle.accentHex;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const chapLabel = `CAPÍTULO ${sec.partNumber}`.split('').join('\u200A');
      ctx.fillText(chapLabel, cx, cursorY);
      ctx.restore();
      cursorY += 14;

      // Chapter Title
      ctx.save();
      ctx.font = buildCanvasFontString(
        'bold',
        chapterTitleFontPx,
        interiorStyle.titleFontFamily
      );
      ctx.fillStyle = interiorStyle.textHex;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const chTitleLines = wrapPlainTextCanvas(
        ctx,
        stripInlineFormatting(sec.title),
        contentW - 8,
        2
      );
      for (const ln of chTitleLines) {
        ctx.fillText(ln, cx, cursorY);
        cursorY += Math.round(chapterTitleFontPx * 1.28);
      }
      ctx.restore();
      cursorY += 5;

      // Ornament divider under title
      drawViewerOrnamentOnCanvas(
        ctx,
        interiorStyle.ornamentStyle,
        cx,
        cursorY,
        interiorStyle.accentHex
      );
      cursorY += 12;
    } else {
      ctx.save();
      ctx.font = buildCanvasFontString('italic', 10, interiorStyle.bodyFontFamily);
      ctx.fillStyle = interiorStyle.mutedHex;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`${stripInlineFormatting(sec.title)} (continuación)`, contentLeft, cursorY);
      ctx.restore();
      cursorY += 16;
    }

    // Optional chapter photo (`h-28 sm:h-32` -> ~116px)
    if (sec.photo && !sec.isContinuation && cursorY + 90 < maxContentBottomY) {
      const availForPhoto = Math.min(118, (maxContentBottomY - cursorY) * 0.42);
      if (availForPhoto >= 64) {
        cursorY = drawViewerPhotoBoxOnCanvas({
          ctx,
          photo: sec.photo,
          cx,
          topY: cursorY,
          containerW: contentW,
          boxHeightPx: availForPhoto,
          borderColorHex: interiorStyle.accentHex,
          captionFontFamily: interiorStyle.bodyFontFamily,
          captionColorHex: interiorStyle.mutedHex,
        });
      }
    }

    // Chapter paragraphs
    for (let pIdx = 0; pIdx < sec.paragraphs.length; pIdx++) {
      const para = sec.paragraphs[pIdx];
      if (!para || !para.trim()) continue;
      if (cursorY + bodyFontPx > maxContentBottomY) break;

      const useDrop =
        Boolean(interiorStyle.useDropCap) && !sec.isContinuation && pIdx === 0;

      cursorY = renderRichParagraphOnCanvas({
        ctx,
        rawText: para,
        bodyFontFamily: interiorStyle.bodyFontFamily,
        titleFontFamily: interiorStyle.titleFontFamily,
        fontSizePx: bodyFontPx,
        lineHeightPx: bodyLineHeightPx,
        textHex: interiorStyle.textHex,
        accentHex: interiorStyle.accentHex,
        leftX: contentLeft,
        startY: cursorY,
        maxWidthPx: contentW,
        maxBottomY: maxContentBottomY,
        textAlign: interiorStyle.textAlign,
        useDropCap: useDrop,
      });

      cursorY += 8;
    }

    // Pull quote (`sec.pullQuote`) with 2px left accent bar
    if (sec.pullQuote && sec.pullQuote.trim() && cursorY + 26 < maxContentBottomY) {
      cursorY += 2;
      const quoteFont = interiorStyle.accentFontFamily || interiorStyle.bodyFontFamily;
      const quoteFontPx = 11.5;
      ctx.save();
      ctx.font = buildCanvasFontString('italic', quoteFontPx, quoteFont);
      const quoteLines = wrapPlainTextCanvas(
        ctx,
        `«${stripInlineFormatting(sec.pullQuote)}»`,
        contentW - 18,
        3
      );
      const quoteLineH = 16;
      const blockH = quoteLines.length * quoteLineH + 4;

      if (cursorY + blockH <= maxContentBottomY) {
        ctx.fillStyle = interiorStyle.accentHex;
        ctx.fillRect(contentLeft, cursorY, 2, blockH);

        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        let qY = cursorY + 2;
        for (const ln of quoteLines) {
          ctx.fillText(ln, contentLeft + 12, qY);
          qY += quoteLineH;
        }
        cursorY += blockH + 6;
      }
      ctx.restore();
    }
  }

  // Footer Page Number (`— 3 —`)
  if (page.showPageNumber) {
    ctx.save();
    ctx.font = buildCanvasFontString('normal', 10, interiorStyle.bodyFontFamily);
    ctx.fillStyle = interiorStyle.mutedHex;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`— ${page.pageNumber} —`, cx, footerTopY + 2);
    ctx.restore();
  }

  return canvas.toDataURL('image/jpeg', 0.96);
}

// ============================================================================
// SYNCHRONIZED VECTOR FALLBACK FOR NON-DOM ENVIRONMENTS (NODE.JS UNIT TESTS)
// ============================================================================

interface StyledWordToken {
  word: string;
  trailingSpace: string;
  style: 'normal' | 'bold' | 'italic';
  widthMm: number;
  spaceWidthMm: number;
}

function renderRichParagraphPdf(params: {
  doc: jsPDF;
  rawText: string;
  fontFamily: 'times' | 'helvetica';
  fontSizePt: number;
  lineHeightMm: number;
  textRgb: [number, number, number];
  accentRgb: [number, number, number];
  leftX: number;
  startY: number;
  maxWidthMm: number;
  maxBottomY: number;
  textAlign: 'justify' | 'left';
  useDropCap: boolean;
}): number {
  const {
    doc,
    rawText,
    fontFamily,
    fontSizePt,
    lineHeightMm,
    textRgb,
    accentRgb,
    leftX,
    startY,
    maxWidthMm,
    maxBottomY,
    textAlign,
    useDropCap,
  } = params;

  const trimmed = (rawText || '').trim();
  if (!trimmed) return startY;

  let workingText = trimmed;
  let dropCapChar = '';
  let dropCapIndentMm = 0;
  const dropCapLinesCount = 2;

  if (useDropCap) {
    const cleanFirst = stripInlineFormatting(workingText);
    if (cleanFirst.length > 1) {
      dropCapChar = cleanFirst.charAt(0);
      const firstCharIdx = workingText.indexOf(dropCapChar);
      if (firstCharIdx !== -1) {
        workingText =
          workingText.slice(0, firstCharIdx) + workingText.slice(firstCharIdx + 1);
      }
      const dropFontPt = fontSizePt + 12;
      doc.setFont(fontFamily, 'bold');
      doc.setFontSize(dropFontPt);
      dropCapIndentMm = Math.max(8.5, doc.getTextWidth(dropCapChar) + 2.8);
    }
  }

  if (dropCapChar) {
    const dropFontPt = fontSizePt + 12;
    doc.setFont(fontFamily, 'bold');
    doc.setFontSize(dropFontPt);
    doc.setTextColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.text(dropCapChar, leftX, startY + lineHeightMm * 1.05);
  }

  const segments = parseInlineSegments(workingText);
  const tokens: StyledWordToken[] = [];

  doc.setFontSize(fontSizePt);
  for (const seg of segments) {
    doc.setFont(fontFamily, seg.style);
    const spaceW = doc.getTextWidth(' ');
    const matches = seg.text.match(/(\S+)(\s*)/g) || [];
    for (const m of matches) {
      const wordMatch = m.match(/^(\S+)(\s*)$/);
      if (!wordMatch) continue;
      const word = wordMatch[1];
      const trailingSpace = wordMatch[2] || '';
      const widthMm = doc.getTextWidth(word);
      tokens.push({
        word,
        trailingSpace: trailingSpace.length > 0 ? ' ' : '',
        style: seg.style,
        widthMm,
        spaceWidthMm: trailingSpace.length > 0 ? spaceW : 0,
      });
    }
  }

  const lines: Array<{
    tokens: StyledWordToken[];
    lineIndex: number;
    lineLeftX: number;
    availWidthMm: number;
  }> = [];

  let currentLine: StyledWordToken[] = [];
  let currentWidth = 0;
  let lineIdx = 0;

  const getLineGeometry = (idx: number) => {
    const indent = dropCapChar && idx < dropCapLinesCount ? dropCapIndentMm : 0;
    return {
      lineLeftX: leftX + indent,
      availWidthMm: Math.max(20, maxWidthMm - indent),
    };
  };

  for (const tok of tokens) {
    const geom = getLineGeometry(lineIdx);
    const prevSpace =
      currentLine.length > 0 ? currentLine[currentLine.length - 1].spaceWidthMm : 0;
    if (currentLine.length > 0 && currentWidth + prevSpace + tok.widthMm > geom.availWidthMm) {
      lines.push({
        tokens: currentLine,
        lineIndex: lineIdx,
        lineLeftX: geom.lineLeftX,
        availWidthMm: geom.availWidthMm,
      });
      lineIdx++;
      currentLine = [tok];
      currentWidth = tok.widthMm;
    } else {
      currentLine.push(tok);
      currentWidth += prevSpace + tok.widthMm;
    }
  }

  if (currentLine.length > 0) {
    const geom = getLineGeometry(lineIdx);
    lines.push({
      tokens: currentLine,
      lineIndex: lineIdx,
      lineLeftX: geom.lineLeftX,
      availWidthMm: geom.availWidthMm,
    });
  }

  let cursorY = startY;
  doc.setFontSize(fontSizePt);
  doc.setTextColor(textRgb[0], textRgb[1], textRgb[2]);

  for (let i = 0; i < lines.length; i++) {
    if (cursorY > maxBottomY) break;
    const ln = lines[i];
    const isLastLine = i === lines.length - 1;
    const gapsCount = ln.tokens.filter(
      (t, idx) => idx < ln.tokens.length - 1 && t.spaceWidthMm > 0
    ).length;
    const wordsTotalWidth = ln.tokens.reduce((acc, t) => acc + t.widthMm, 0);
    const naturalSpacesWidth = ln.tokens.reduce(
      (acc, t, idx) => acc + (idx < ln.tokens.length - 1 ? t.spaceWidthMm : 0),
      0
    );
    const totalLineWidth = wordsTotalWidth + naturalSpacesWidth;

    const shouldJustify =
      textAlign === 'justify' &&
      !isLastLine &&
      gapsCount > 0 &&
      totalLineWidth >= ln.availWidthMm * 0.72;

    const extraSpacePerGap = shouldJustify
      ? Math.min(2.2, Math.max(0, (ln.availWidthMm - totalLineWidth) / gapsCount))
      : 0;

    let x = ln.lineLeftX;
    for (let tIdx = 0; tIdx < ln.tokens.length; tIdx++) {
      const tok = ln.tokens[tIdx];
      doc.setFont(fontFamily, tok.style);
      doc.text(tok.word, x, cursorY);
      x += tok.widthMm;
      if (tIdx < ln.tokens.length - 1 && tok.spaceWidthMm > 0) {
        x += tok.spaceWidthMm + extraSpacePerGap;
      }
    }

    cursorY += lineHeightMm;
  }

  if (dropCapChar && lines.length < dropCapLinesCount) {
    cursorY = Math.max(cursorY, startY + dropCapLinesCount * lineHeightMm);
  }

  return cursorY;
}

function drawRotatedDiamondPdf(doc: jsPDF, cx: number, cy: number, halfDiagMm: number): void {
  doc.lines(
    [
      [halfDiagMm, halfDiagMm],
      [-halfDiagMm, halfDiagMm],
      [-halfDiagMm, -halfDiagMm],
    ],
    cx,
    cy - halfDiagMm,
    [1, 1],
    'F',
    true
  );
}

function drawInteriorOrnamentPdf(
  doc: jsPDF,
  ornamentStyle: DemoInteriorStyleSpec['ornamentStyle'],
  cx: number,
  y: number,
  accentRgb: [number, number, number]
): void {
  doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
  doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);

  if (ornamentStyle === 'classic_line') {
    doc.setLineWidth(0.3);
    doc.line(cx - 12, y, cx - 2.8, y);
    doc.line(cx + 2.8, y, cx + 12, y);
    drawRotatedDiamondPdf(doc, cx, y, 1.15);
  } else if (ornamentStyle === 'diamond_flourish') {
    doc.setLineWidth(0.28);
    doc.line(cx - 15, y, cx - 5.2, y);
    doc.line(cx + 5.2, y, cx + 15, y);
    doc.circle(cx - 2.8, y, 0.55, 'F');
    drawRotatedDiamondPdf(doc, cx, y, 1.15);
    doc.circle(cx + 2.8, y, 0.55, 'F');
  } else if (ornamentStyle === 'journal_script') {
    doc.setLineWidth(0.22);
    doc.line(cx - 11, y, cx - 3.2, y);
    doc.line(cx + 3.2, y, cx + 11, y);
    doc.circle(cx - 1.2, y, 0.45, 'F');
    doc.circle(cx + 1.2, y, 0.45, 'F');
  } else if (ornamentStyle === 'minimal_bar') {
    doc.setLineWidth(0.55);
    doc.line(cx - 8, y, cx + 8, y);
  } else if (ornamentStyle === 'botanical_leaf') {
    doc.setLineWidth(0.35);
    doc.line(cx - 13, y - 0.6, cx - 2.6, y - 0.6);
    doc.line(cx + 2.6, y - 0.6, cx + 13, y - 0.6);
    drawRotatedDiamondPdf(doc, cx, y - 0.6, 1.1);
    doc.setLineWidth(0.2);
    doc.line(cx - 8, y + 1.4, cx + 8, y + 1.4);
  }
}

function drawInteriorPageFrameIfApplicable(
  doc: jsPDF,
  composed: ComposedBookDocument
): void {
  const { format, interiorStyle } = composed;
  const W = format.widthMm;
  const H = format.heightMm;
  const accentRgb = hexToRgb(interiorStyle.accentHex);

  if (interiorStyle.id === 'legado_familiar' || interiorStyle.id === 'diario_intimo') {
    doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.setLineWidth(0.2);
    doc.rect(10, 10, W - 20, H - 20, 'S');
  }
}

function drawVectorThematicIllustration(
  doc: jsPDF,
  illustrationId: DemoThematicIllustrationId,
  cx: number,
  cy: number,
  radius: number,
  accentRgb: [number, number, number]
): void {
  doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
  doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
  doc.setLineWidth(0.35);

  doc.circle(cx, cy, radius, 'S');
  doc.setLineWidth(0.18);
  doc.circle(cx, cy, radius - 1.8, 'S');

  if (illustrationId === 'arbol_raices') {
    doc.setLineWidth(0.45);
    doc.line(cx, cy + radius * 0.55, cx, cy - radius * 0.25);
    doc.line(cx, cy - radius * 0.05, cx - radius * 0.35, cy - radius * 0.42);
    doc.line(cx, cy - radius * 0.12, cx + radius * 0.35, cy - radius * 0.42);
    doc.line(cx, cy - radius * 0.22, cx - radius * 0.2, cy - radius * 0.55);
    doc.line(cx, cy - radius * 0.22, cx + radius * 0.2, cy - radius * 0.55);
    doc.setLineWidth(0.3);
    doc.line(cx, cy + radius * 0.55, cx - radius * 0.28, cy + radius * 0.72);
    doc.line(cx, cy + radius * 0.55, cx + radius * 0.28, cy + radius * 0.72);
    doc.line(cx, cy + radius * 0.55, cx, cy + radius * 0.76);
  } else if (illustrationId === 'pluma_tinta') {
    doc.line(cx - radius * 0.35, cy + radius * 0.35, cx + radius * 0.35, cy - radius * 0.35);
    doc.circle(cx + radius * 0.08, cy - radius * 0.08, 1.1, 'S');
    doc.line(cx - radius * 0.45, cy + radius * 0.52, cx + radius * 0.45, cy + radius * 0.52);
    doc.line(cx - radius * 0.3, cy + radius * 0.65, cx + radius * 0.3, cy + radius * 0.65);
  } else if (illustrationId === 'brujula_camino') {
    doc.line(cx, cy - radius * 0.68, cx, cy + radius * 0.68);
    doc.line(cx - radius * 0.68, cy, cx + radius * 0.68, cy);
    doc.line(cx - radius * 0.42, cy - radius * 0.42, cx + radius * 0.42, cy + radius * 0.42);
    doc.line(cx + radius * 0.42, cy - radius * 0.42, cx - radius * 0.42, cy + radius * 0.42);
    doc.circle(cx, cy, radius * 0.22, 'S');
  } else if (illustrationId === 'hogar_calido') {
    const w = radius * 0.85;
    const h = radius * 0.95;
    doc.rect(cx - w / 2, cy - h / 2, w, h, 'S');
    doc.line(cx, cy - h / 2, cx, cy + h / 2);
    doc.line(cx - w / 2, cy, cx + w / 2, cy);
  } else {
    const pts: Array<[number, number]> = [
      [cx - radius * 0.4, cy + radius * 0.25],
      [cx - radius * 0.15, cy - radius * 0.3],
      [cx + radius * 0.22, cy - radius * 0.15],
      [cx + radius * 0.42, cy - radius * 0.42],
      [cx + radius * 0.1, cy + radius * 0.38],
    ];
    for (let i = 0; i < pts.length - 1; i++) {
      doc.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    }
    for (const [px, py] of pts) {
      doc.circle(px, py, 0.9, 'FD');
    }
  }
}

function drawFittedPhoto(
  doc: jsPDF,
  photo: DemoInMemoryPhoto,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
  borderRgb: [number, number, number]
): void {
  try {
    const imgRatio =
      photo.width > 0 && photo.height > 0 ? photo.width / photo.height : 4 / 3;
    const boxRatio = boxW / boxH;

    let drawW = boxW;
    let drawH = boxH;
    if (imgRatio > boxRatio) {
      drawW = boxW;
      drawH = boxW / imgRatio;
    } else {
      drawH = boxH;
      drawW = boxH * imgRatio;
    }

    const drawX = boxX + (boxW - drawW) / 2;
    const drawY = boxY + (boxH - drawH) / 2;

    const format = photo.mimeType.includes('png') ? 'PNG' : 'JPEG';
    doc.addImage(photo.dataUrl, format, drawX, drawY, drawW, drawH, undefined, 'FAST');
    doc.setDrawColor(borderRgb[0], borderRgb[1], borderRgb[2]);
    doc.setLineWidth(0.3);
    doc.rect(drawX - 1, drawY - 1, drawW + 2, drawH + 2, 'S');
  } catch (_err) {
    doc.setDrawColor(borderRgb[0], borderRgb[1], borderRgb[2]);
    doc.rect(boxX, boxY, boxW, boxH, 'S');
  }
}

function renderCoverPagePdf(
  doc: jsPDF,
  composed: ComposedBookDocument,
  page: ComposedBookPage
): void {
  const { format, coverDesign, coverPalette, editorialConfig, coverPhoto } = composed;
  const W = format.widthMm;
  const H = format.heightMm;

  const bgRgb = hexToRgb(coverPalette.bgHex);
  const secRgb = hexToRgb(coverPalette.secondaryBgHex);
  const textRgb = hexToRgb(coverPalette.textHex);
  const subRgb = hexToRgb(coverPalette.subtextHex);
  const accentRgb = hexToRgb(coverPalette.accentHex);
  const borderRgb = hexToRgb(coverPalette.borderHex);

  doc.setFillColor(bgRgb[0], bgRgb[1], bgRgb[2]);
  doc.rect(0, 0, W, H, 'F');

  const spineW = coverDesign.id === 'clasica_eterna' ? 8 : 0;
  const cx = spineW + (W - spineW) / 2;
  const usableW = W - spineW;

  if (coverDesign.id === 'clasica_eterna') {
    doc.setFillColor(secRgb[0], secRgb[1], secRgb[2]);
    doc.rect(0, 0, spineW, H, 'F');
    doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.setLineWidth(0.5);
    doc.rect(spineW + 10, 12, usableW - 20, H - 24, 'S');
    doc.setLineWidth(0.2);
    doc.rect(spineW + 12, 14, usableW - 24, H - 28, 'S');
  } else if (coverDesign.id === 'recuerdos_marfil') {
    doc.setDrawColor(borderRgb[0], borderRgb[1], borderRgb[2]);
    doc.setLineWidth(0.25);
    doc.rect(14, 14, W - 28, H - 28, 'S');
  } else if (coverDesign.id === 'album_nuestra_vida') {
    doc.setFillColor(secRgb[0], secRgb[1], secRgb[2]);
    doc.rect(10, 10, W - 20, H - 20, 'F');
    doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.setLineWidth(0.45);
    doc.rect(13, 13, W - 26, H - 26, 'S');
  } else if (coverDesign.id === 'raices_recuerdos') {
    doc.setDrawColor(borderRgb[0], borderRgb[1], borderRgb[2]);
    doc.setLineWidth(0.4);
    doc.rect(13, 13, W - 26, H - 26, 'S');
  } else {
    doc.setFillColor(secRgb[0], secRgb[1], secRgb[2]);
    doc.rect(0, 0, W, H * 0.36, 'F');
    doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.rect(0, H * 0.36 - 0.8, W, 1.6, 'F');
  }

  const fontName = coverDesign.id === 'historia_contemporanea' ? 'helvetica' : 'times';
  const maxTextW = usableW - 38;

  let cursorY = Math.max(27, H * 0.13);

  const authorsText = stripInlineFormatting(page.authors || '').toUpperCase();
  if (authorsText) {
    const authorFontPt = coverDesign.id === 'recuerdos_marfil' ? format.baseFontPt + 0.5 : format.baseFontPt - 0.5;
    doc.setFont(fontName, 'bold');
    doc.setFontSize(authorFontPt);
    doc.setTextColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    const authorLines = doc.splitTextToSize(authorsText, maxTextW).slice(0, 2);
    doc.text(authorLines, cx, cursorY, { align: 'center' });
    cursorY += authorLines.length * (authorFontPt * 0.4) + 5;
  }

  const cleanCoverTitle = stripInlineFormatting(page.title || 'Mi Historia');
  const coverTitleFontPt =
    cleanCoverTitle.length > 55
      ? format.titleFontPt + 0.5
      : cleanCoverTitle.length > 35
      ? format.titleFontPt + 2
      : format.titleFontPt + 3;
  doc.setFont(fontName, 'bold');
  doc.setFontSize(coverTitleFontPt);
  doc.setTextColor(textRgb[0], textRgb[1], textRgb[2]);
  const titleLines = doc.splitTextToSize(cleanCoverTitle, maxTextW).slice(0, 3);
  doc.text(titleLines, cx, cursorY, { align: 'center' });
  cursorY += titleLines.length * (coverTitleFontPt * 0.42) + 3.5;

  if (page.subtitle && page.subtitle.trim().length > 0) {
    const subFontPt = Math.max(8.5, format.baseFontPt - 0.5);
    doc.setFont(fontName, 'italic');
    doc.setFontSize(subFontPt);
    doc.setTextColor(subRgb[0], subRgb[1], subRgb[2]);
    const subLines = doc
      .splitTextToSize(stripInlineFormatting(page.subtitle), maxTextW - 6)
      .slice(0, 2);
    doc.text(subLines, cx, cursorY, { align: 'center' });
    cursorY += subLines.length * (subFontPt * 0.4) + 3.5;
  }

  const footerY = coverDesign.id === 'raices_recuerdos' ? H - 24 : H - 21;
  doc.setFont(fontName, 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(subRgb[0], subRgb[1], subRgb[2]);
  doc.text('YouForever • Edición Conmemorativa', cx, footerY, {
    align: 'center',
    maxWidth: maxTextW,
  });

  const topBound = Math.max(cursorY + 3, H * 0.38);
  const bottomBound = footerY - 8;
  const availH = Math.max(20, bottomBound - topBound);
  const visualCenterY = topBound + availH / 2;

  if (editorialConfig.coverVisualType === 'photo' && coverPhoto) {
    const boxW = Math.min(usableW * 0.52, maxTextW * 0.82);
    const boxH = Math.min(availH * 0.82, H * 0.28);
    drawFittedPhoto(
      doc,
      coverPhoto,
      cx - boxW / 2,
      visualCenterY - boxH / 2,
      boxW,
      boxH,
      accentRgb
    );
  } else if (editorialConfig.coverVisualType === 'illustration') {
    const radius = Math.min(usableW * 0.135, availH * 0.35, 22);
    drawVectorThematicIllustration(
      doc,
      editorialConfig.coverIllustrationId,
      cx,
      visualCenterY,
      radius,
      accentRgb
    );
  } else {
    doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.setLineWidth(0.3);
    doc.line(cx - 18, visualCenterY, cx - 3.5, visualCenterY);
    doc.line(cx + 3.5, visualCenterY, cx + 18, visualCenterY);
    drawRotatedDiamondPdf(doc, cx, visualCenterY, 1.35);
  }
}

function renderTitleDedicationPagePdf(
  doc: jsPDF,
  composed: ComposedBookDocument,
  page: ComposedBookPage
): void {
  const { format, interiorStyle } = composed;
  const W = format.widthMm;
  const H = format.heightMm;
  const bgRgb = hexToRgb(interiorStyle.pageBgHex);
  const textRgb = hexToRgb(interiorStyle.textHex);
  const mutedRgb = hexToRgb(interiorStyle.mutedHex);
  const accentRgb = hexToRgb(interiorStyle.accentHex);

  doc.setFillColor(bgRgb[0], bgRgb[1], bgRgb[2]);
  doc.rect(0, 0, W, H, 'F');
  drawInteriorPageFrameIfApplicable(doc, composed);

  const cx = W / 2;
  const horizMargin = (format.marginInnerMm + format.marginOuterMm) / 2;
  const contentW = W - horizMargin * 2;
  const font = interiorStyle.pdfFontFamily;

  doc.setFont(font, 'bold');
  doc.setFontSize(format.titleFontPt);
  doc.setTextColor(textRgb[0], textRgb[1], textRgb[2]);
  const titleLines = doc.splitTextToSize(
    stripInlineFormatting(page.title || 'Mi Historia'),
    contentW - 8
  );
  let cursorY = format.marginTopMm + 16;
  doc.text(titleLines, cx, cursorY, { align: 'center' });
  cursorY += titleLines.length * (format.titleFontPt * 0.44) + 4;

  if (page.authors) {
    doc.setFont(font, 'italic');
    doc.setFontSize(format.baseFontPt + 0.5);
    doc.setTextColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.text(stripInlineFormatting(page.authors), cx, cursorY, { align: 'center' });
    cursorY += 9;
  }

  drawInteriorOrnamentPdf(doc, interiorStyle.ornamentStyle, cx, cursorY, accentRgb);
  cursorY += 13;

  if (page.dedication && page.dedication.trim().length > 0) {
    doc.setFont(font, 'italic');
    doc.setFontSize(format.baseFontPt);
    doc.setTextColor(textRgb[0], textRgb[1], textRgb[2]);
    const dedLines = doc.splitTextToSize(
      `«${stripInlineFormatting(page.dedication)}»`,
      contentW - 14
    );
    doc.text(dedLines, cx, cursorY, { align: 'center' });
    cursorY += dedLines.length * (format.baseFontPt * 0.45) + 12;
  }

  if (page.introduction && page.introduction.trim().length > 0) {
    const introStartY = Math.max(cursorY, H * 0.5);
    doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.setLineWidth(0.15);
    doc.line(horizMargin, introStartY - 5, W - horizMargin, introStartY - 5);
    renderRichParagraphPdf({
      doc,
      rawText: page.introduction,
      fontFamily: font,
      fontSizePt: format.baseFontPt,
      lineHeightMm: format.baseFontPt * 0.45,
      textRgb: mutedRgb,
      accentRgb,
      leftX: horizMargin,
      startY: introStartY,
      maxWidthMm: contentW,
      maxBottomY: H - format.marginBottomMm - 10,
      textAlign: interiorStyle.textAlign,
      useDropCap: false,
    });
  }

  doc.setFont(font, 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(mutedRgb[0], mutedRgb[1], mutedRgb[2]);
  doc.text('YouForever', cx, H - format.marginBottomMm + 4, { align: 'center' });
}

function renderChapterContentPagePdf(
  doc: jsPDF,
  composed: ComposedBookDocument,
  page: ComposedBookPage
): void {
  const { format, interiorStyle } = composed;
  const W = format.widthMm;
  const H = format.heightMm;
  const bgRgb = hexToRgb(interiorStyle.pageBgHex);
  const textRgb = hexToRgb(interiorStyle.textHex);
  const mutedRgb = hexToRgb(interiorStyle.mutedHex);
  const accentRgb = hexToRgb(interiorStyle.accentHex);

  doc.setFillColor(bgRgb[0], bgRgb[1], bgRgb[2]);
  doc.rect(0, 0, W, H, 'F');
  drawInteriorPageFrameIfApplicable(doc, composed);

  const font = interiorStyle.pdfFontFamily;
  const horizMargin = (format.marginInnerMm + format.marginOuterMm) / 2;
  const contentW = W - horizMargin * 2;
  const cx = W / 2;

  doc.setFont(font, 'italic');
  doc.setFontSize(8);
  doc.setTextColor(mutedRgb[0], mutedRgb[1], mutedRgb[2]);
  doc.text(
    stripInlineFormatting(
      composed.editorialConfig.customTitle || 'YouForever • Memoria Autobiográfica'
    ),
    cx,
    format.marginTopMm - 5,
    { align: 'center', maxWidth: contentW }
  );

  let cursorY = format.marginTopMm + 4;
  const sections = page.sections || [];
  const maxBottomY = H - format.marginBottomMm - 10;

  for (let sIdx = 0; sIdx < sections.length; sIdx++) {
    const sec = sections[sIdx];

    if (sIdx > 0) {
      cursorY += 3;
      drawInteriorOrnamentPdf(doc, interiorStyle.ornamentStyle, cx, cursorY, accentRgb);
      cursorY += 6.5;
    }

    if (!sec.isContinuation) {
      doc.setFont(font, 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(accentRgb[0], accentRgb[1], accentRgb[2]);
      doc.text(`CAPÍTULO ${sec.partNumber}`, cx, cursorY, { align: 'center' });
      cursorY += 5.5;

      const chTitlePt = format.titleFontPt - 2.5;
      doc.setFont(font, 'bold');
      doc.setFontSize(chTitlePt);
      doc.setTextColor(textRgb[0], textRgb[1], textRgb[2]);
      const chTitleLines = doc.splitTextToSize(stripInlineFormatting(sec.title), contentW);
      doc.text(chTitleLines, cx, cursorY, { align: 'center' });
      cursorY += chTitleLines.length * (chTitlePt * 0.42) + 2;

      drawInteriorOrnamentPdf(doc, interiorStyle.ornamentStyle, cx, cursorY, accentRgb);
      cursorY += 6;
    } else {
      doc.setFont(font, 'italic');
      doc.setFontSize(8.5);
      doc.setTextColor(mutedRgb[0], mutedRgb[1], mutedRgb[2]);
      doc.text(`${stripInlineFormatting(sec.title)} (continuación)`, horizMargin, cursorY);
      cursorY += 6;
    }

    if (sec.photo && !sec.isContinuation) {
      const photoBoxH = Math.min(38, (H - cursorY - format.marginBottomMm) * 0.34);
      if (photoBoxH >= 20) {
        drawFittedPhoto(
          doc,
          sec.photo,
          horizMargin + contentW * 0.15,
          cursorY,
          contentW * 0.7,
          photoBoxH,
          accentRgb
        );
        cursorY += photoBoxH + 3.5;
        if (sec.photo.caption) {
          doc.setFont(font, 'italic');
          doc.setFontSize(8);
          doc.setTextColor(mutedRgb[0], mutedRgb[1], mutedRgb[2]);
          doc.text(stripInlineFormatting(sec.photo.caption), cx, cursorY, {
            align: 'center',
            maxWidth: contentW * 0.8,
          });
          cursorY += 4.5;
        }
      }
    }

    const lineHeightMm = format.baseFontPt * 0.45;
    for (let pIdx = 0; pIdx < sec.paragraphs.length; pIdx++) {
      const rawPara = sec.paragraphs[pIdx];
      if (!rawPara || !rawPara.trim()) continue;
      if (cursorY > maxBottomY) break;

      const useDrop =
        Boolean(interiorStyle.useDropCap) && !sec.isContinuation && pIdx === 0;

      cursorY = renderRichParagraphPdf({
        doc,
        rawText: rawPara,
        fontFamily: font,
        fontSizePt: format.baseFontPt,
        lineHeightMm,
        textRgb,
        accentRgb,
        leftX: horizMargin,
        startY: cursorY,
        maxWidthMm: contentW,
        maxBottomY,
        textAlign: interiorStyle.textAlign,
        useDropCap: useDrop,
      });

      cursorY += 2.8;
    }

    if (sec.pullQuote && cursorY < H - format.marginBottomMm - 20) {
      cursorY += 1.5;
      doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
      doc.setLineWidth(0.5);
      const quotePt = format.baseFontPt - 0.5;
      doc.setFont(font, 'italic');
      doc.setFontSize(quotePt);
      const quoteLines = doc.splitTextToSize(
        `«${stripInlineFormatting(sec.pullQuote)}»`,
        contentW - 10
      );
      const quoteBlockH = quoteLines.length * (quotePt * 0.44);
      doc.line(horizMargin + 2, cursorY - 3, horizMargin + 2, cursorY + quoteBlockH - 1);
      doc.setTextColor(accentRgb[0], accentRgb[1], accentRgb[2]);
      doc.text(quoteLines, horizMargin + 6, cursorY);
      cursorY += quoteBlockH + 3;
    }
  }

  if (page.showPageNumber) {
    doc.setFont(font, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(mutedRgb[0], mutedRgb[1], mutedRgb[2]);
    doc.text(`— ${page.pageNumber} —`, cx, H - format.marginBottomMm + 7, {
      align: 'center',
    });
  }
}

function renderClosingMandatoryPagePdf(
  doc: jsPDF,
  composed: ComposedBookDocument,
  page: ComposedBookPage
): void {
  const { format, interiorStyle } = composed;
  const W = format.widthMm;
  const H = format.heightMm;
  const bgRgb = hexToRgb(interiorStyle.pageBgHex);
  const textRgb = hexToRgb(interiorStyle.textHex);
  const accentRgb = hexToRgb(interiorStyle.accentHex);

  doc.setFillColor(bgRgb[0], bgRgb[1], bgRgb[2]);
  doc.rect(0, 0, W, H, 'F');
  drawInteriorPageFrameIfApplicable(doc, composed);

  const font = interiorStyle.pdfFontFamily;
  const horizMargin = (format.marginInnerMm + format.marginOuterMm) / 2;

  const rawClosingText = stripInlineFormatting(
    page.centralClosingText || 'Esta historia continuará...'
  );
  const maxClosingWidth = W - horizMargin * 2 - 12;
  const closingFontPt =
    rawClosingText.length > 80 ? format.baseFontPt + 2 : format.titleFontPt - 1;
  doc.setFont(font, 'italic');
  doc.setFontSize(closingFontPt);
  doc.setTextColor(textRgb[0], textRgb[1], textRgb[2]);
  const closingLines = doc.splitTextToSize(rawClosingText, maxClosingWidth);
  const blockHeight = closingLines.length * (closingFontPt * 0.45);
  const textStartY = H / 2 - blockHeight / 2 + 5;

  // Ornament divider ABOVE the central closing text (matching viewer)
  drawInteriorOrnamentPdf(
    doc,
    interiorStyle.ornamentStyle,
    W / 2,
    textStartY - 8,
    accentRgb
  );

  doc.text(closingLines, W / 2, textStartY, { align: 'center' });

  doc.setFont(font, 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(accentRgb[0], accentRgb[1], accentRgb[2]);
  doc.text(
    page.bottomRightBrand || '<< YouForever >>',
    W - horizMargin,
    H - format.marginBottomMm,
    { align: 'right' }
  );
}

/**
 * Generates the real downloadable PDF Blob and Object URL from the composed book document.
 * In the browser, each page is rendered in high definition (300+ DPI) using the exact
 * fonts, ornaments, frames, SVG illustrations, and layout proportions of the interactive viewer.
 */
export function generateRealDemoBookPdf(params: {
  composed: ComposedBookDocument;
  profile: DemoBasicProfile;
}): {
  blob: Blob;
  blobUrl: string;
  filename: string;
  pageCount: number;
} {
  const { composed, profile } = params;
  const { format, pages } = composed;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [format.widthMm, format.heightMm],
    compress: true,
  });

  doc.setProperties({
    title: composed.editorialConfig.customTitle || 'Mi Historia — YouForever',
    author: composed.editorialConfig.customAuthors || profile.displayName || 'YouForever',
    subject: 'Libro autobiográfico — YouForever',
    creator: 'YouForever',
    keywords: 'autobiografía, memoria familiar, legado, YouForever',
  });

  pages.forEach((page, idx) => {
    if (idx > 0) {
      doc.addPage([format.widthMm, format.heightMm], 'portrait');
    }

    // Attempt 1:1 High-Definition Viewer Canvas Render first (when running in browser DOM)
    const highResDataUrl = renderPageToViewerIdenticalDataUrl(composed, page);
    if (highResDataUrl) {
      doc.addImage(
        highResDataUrl,
        'JPEG',
        0,
        0,
        format.widthMm,
        format.heightMm,
        undefined,
        'FAST'
      );
      return;
    }

    // Fallback for headless Node.js unit tests without a DOM canvas
    if (page.kind === 'cover') {
      renderCoverPagePdf(doc, composed, page);
    } else if (page.kind === 'title_dedication') {
      renderTitleDedicationPagePdf(doc, composed, page);
    } else if (page.kind === 'chapter_content') {
      renderChapterContentPagePdf(doc, composed, page);
    } else if (page.kind === 'closing_mandatory') {
      renderClosingMandatoryPagePdf(doc, composed, page);
    }
  });

  const blob = doc.output('blob');
  const blobUrl = URL.createObjectURL(blob);
  const filename = buildSafeDemoPdfFilename(profile);

  return {
    blob,
    blobUrl,
    filename,
    pageCount: pages.length,
  };
}
