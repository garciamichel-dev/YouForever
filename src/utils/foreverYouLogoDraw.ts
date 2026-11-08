/**
 * Official ForeverYou Brand Identity Vector & Canvas Renderer
 * Reference asset: /public/assets/aistudio/Tablero_de_logotipo_ForeverYou_curvado_085f981b.png
 * Concept: F + ∞ + Y = ForeverYou curved infinity monogram
 */

export const FOREVERYOU_LOGO_BOARD_ASSET_PATH =
  '/assets/aistudio/Tablero_de_logotipo_ForeverYou_curvado_085f981b.png';

export const FOREVERYOU_NAVY_HEX = '#0A182E';

/**
 * Draws the official ForeverYou `F + ∞ + Y` intertwined infinity symbol on a 2D Canvas context
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
  ctx.moveTo(48, 93);
  ctx.bezierCurveTo(23, 89, 12, 72, 12, 54);
  ctx.bezierCurveTo(12, 31, 30, 14, 54, 14);
  ctx.bezierCurveTo(68, 14, 79, 21, 90, 33);
  ctx.stroke();

  // 2. Lower-right diagonal resuming after central crossing + right loop outer arc + continuous crossing ribbon
  ctx.beginPath();
  ctx.lineWidth = 15;
  ctx.lineCap = 'round';
  ctx.moveTo(110, 68);
  ctx.bezierCurveTo(121, 82, 133, 94, 148, 94);
  ctx.bezierCurveTo(172, 94, 188, 77, 188, 54);
  ctx.bezierCurveTo(188, 31, 172, 14, 148, 14);
  ctx.bezierCurveTo(131, 14, 118, 25, 100, 47);
  ctx.bezierCurveTo(83, 68, 72, 91, 58, 94);
  ctx.stroke();

  // 3. Letter F integrated inside left loop
  ctx.beginPath();
  ctx.lineWidth = 13.5;
  ctx.lineCap = 'round';
  ctx.moveTo(48, 93);
  ctx.lineTo(48, 54);
  ctx.bezierCurveTo(48, 41, 56, 35, 76, 35);
  ctx.stroke();

  ctx.beginPath();
  ctx.lineWidth = 12.5;
  ctx.lineCap = 'round';
  ctx.moveTo(48, 61);
  ctx.lineTo(69, 61);
  ctx.stroke();

  // 4. Letter Y integrated inside right loop
  ctx.beginPath();
  ctx.lineWidth = 13.5;
  ctx.lineCap = 'round';
  ctx.moveTo(140, 91);
  ctx.lineTo(140, 59);
  ctx.stroke();

  ctx.beginPath();
  ctx.lineWidth = 12.5;
  ctx.lineCap = 'round';
  ctx.moveTo(140, 60);
  ctx.bezierCurveTo(136, 50, 128, 42, 120, 38);
  ctx.stroke();

  ctx.beginPath();
  ctx.lineWidth = 12.5;
  ctx.lineCap = 'round';
  ctx.moveTo(140, 60);
  ctx.bezierCurveTo(144, 50, 152, 42, 160, 38);
  ctx.stroke();

  ctx.restore();
  return { width: widthPx, height: heightPx };
}

/**
 * Draws a horizontal lockup `[Isotipo F∞Y] + labelText` on a 2D Canvas context,
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
