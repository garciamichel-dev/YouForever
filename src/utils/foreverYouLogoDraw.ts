/**
 * Official YouForever Brand Identity Vector & Canvas Renderer
 * Reference asset: /public/assets/aistudio/imagen_c6cf566b.png
 * Concept: Y + ∞ + F = YouForever curved infinity monogram
 */

export const FOREVERYOU_LOGO_BOARD_ASSET_PATH =
  '/assets/aistudio/imagen_c6cf566b.png';

export const FOREVERYOU_NAVY_HEX = '#071A3E';

/**
 * Draws the official YouForever `Y + ∞ + F` intertwined infinity symbol on a 2D Canvas context
 * using the exact 200x108 vector coordinate space from the SVG brand system.
 */
export function drawForeverYouInfinitySymbolOnCanvas(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  widthPx: number,
  colorHex: string,
  opacity: number = 1
): { width: number; height: number } {
  const scale = widthPx / 200;
  const heightPx = 108 * scale;
  const leftX = centerX - widthPx / 2;
  const topY = centerY - heightPx / 2;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.translate(leftX, topY);
  ctx.scale(scale, scale);
  ctx.strokeStyle = colorHex;
  ctx.lineJoin = 'round';

  // 1. Left loop outer arc + upper-left diagonal stopping cleanly before central crossing
  ctx.beginPath();
  ctx.lineWidth = 15;
  ctx.lineCap = 'butt';
  ctx.moveTo(52, 94);
  ctx.bezierCurveTo(25, 92, 12, 74, 12, 54);
  ctx.bezierCurveTo(12, 31, 30, 14, 54, 14);
  ctx.bezierCurveTo(69, 14, 81, 21, 92, 34);
  ctx.stroke();

  // 2. Lower-right diagonal resuming after central crossing + right loop outer arc + continuous crossing ribbon
  ctx.beginPath();
  ctx.lineWidth = 15;
  ctx.lineCap = 'round';
  ctx.moveTo(108, 69);
  ctx.bezierCurveTo(119, 82, 132, 94, 148, 94);
  ctx.bezierCurveTo(172, 94, 188, 77, 188, 54);
  ctx.bezierCurveTo(188, 31, 172, 14, 148, 14);
  ctx.bezierCurveTo(131, 14, 118, 25, 100, 47);
  ctx.bezierCurveTo(83, 68, 70, 92, 52, 94);
  ctx.stroke();

  // 3. Letter Y integrated inside left loop
  ctx.beginPath();
  ctx.lineWidth = 13.5;
  ctx.lineCap = 'round';
  ctx.moveTo(52, 91);
  ctx.lineTo(52, 58);
  ctx.stroke();

  ctx.beginPath();
  ctx.lineWidth = 13;
  ctx.lineCap = 'round';
  ctx.moveTo(52, 59);
  ctx.lineTo(35, 37);
  ctx.stroke();

  ctx.beginPath();
  ctx.lineWidth = 13;
  ctx.lineCap = 'round';
  ctx.moveTo(52, 59);
  ctx.lineTo(69, 37);
  ctx.stroke();

  // 4. Letter F integrated inside right loop
  ctx.beginPath();
  ctx.lineWidth = 13.5;
  ctx.lineCap = 'round';
  ctx.moveTo(130, 86);
  ctx.lineTo(130, 53);
  ctx.bezierCurveTo(130, 41, 138, 35, 161, 35);
  ctx.stroke();

  ctx.beginPath();
  ctx.lineWidth = 12.5;
  ctx.lineCap = 'round';
  ctx.moveTo(130, 61);
  ctx.lineTo(154, 61);
  ctx.stroke();

  ctx.restore();
  return { width: widthPx, height: heightPx };
}

/**
 * Draws a horizontal lockup `[Isotipo Y∞F] + labelText` on a 2D Canvas context,
 * supporting either centered alignment (`align: 'center'`) or right alignment (`align: 'right'`).
 */
export function drawForeverYouHorizontalLockupOnCanvas(params: {
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  align: 'center' | 'right' | 'left';
  symbolWidthPx: number;
  gapPx: number;
  labelText: string;
  fontCss: string;
  colorHex: string;
  symbolColorHex?: string;
  opacity?: number;
  letterSpacingPx?: number;
}): void {
  const {
    ctx,
    x,
    y,
    align,
    symbolWidthPx,
    gapPx,
    labelText,
    fontCss,
    colorHex,
    symbolColorHex,
    opacity = 1,
    letterSpacingPx = 0,
  } = params;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.font = fontCss;
  ctx.textBaseline = 'middle';

  // Measure text width (accounting for optional letter spacing)
  let textWidth = ctx.measureText(labelText).width;
  if (letterSpacingPx > 0 && labelText.length > 1) {
    textWidth += (labelText.length - 1) * letterSpacingPx;
  }

  const totalWidth = symbolWidthPx + gapPx + textWidth;
  let startX = x;
  if (align === 'center') {
    startX = x - totalWidth / 2;
  } else if (align === 'right') {
    startX = x - totalWidth;
  }

  const symbolCenterX = startX + symbolWidthPx / 2;
  drawForeverYouInfinitySymbolOnCanvas(
    ctx,
    symbolCenterX,
    y,
    symbolWidthPx,
    symbolColorHex || colorHex,
    opacity
  );

  const textStartX = startX + symbolWidthPx + gapPx;
  ctx.fillStyle = colorHex;
  ctx.textAlign = 'left';

  if (letterSpacingPx > 0) {
    let cursorX = textStartX;
    for (let i = 0; i < labelText.length; i++) {
      const ch = labelText[i];
      ctx.fillText(ch, cursorX, y);
      cursorX += ctx.measureText(ch).width + letterSpacingPx;
    }
  } else {
    ctx.fillText(labelText, textStartX, y);
  }

  ctx.restore();
}
