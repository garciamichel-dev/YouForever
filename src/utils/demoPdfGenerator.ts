import { jsPDF } from 'jspdf';
import {
  ComposedBookDocument,
  ComposedBookPage,
  DemoBasicProfile,
  DemoInMemoryPhoto,
  DemoThematicIllustrationId,
  buildSafeDemoPdfFilename,
} from '../logic/demoStoryRules.ts';

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  if (clean.length !== 6) return [30, 30, 30];
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  return [r, g, b];
}

function stripInlineFormatting(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .trim();
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
  doc.setLineWidth(0.35);

  // Outer medallion frame
  doc.circle(cx, cy, radius, 'S');
  doc.setLineWidth(0.18);
  doc.circle(cx, cy, radius - 1.8, 'S');

  if (illustrationId === 'arbol_raices') {
    // Trunk & branches
    doc.setLineWidth(0.45);
    doc.line(cx, cy + radius * 0.55, cx, cy - radius * 0.25);
    doc.line(cx, cy - radius * 0.05, cx - radius * 0.35, cy - radius * 0.42);
    doc.line(cx, cy - radius * 0.12, cx + radius * 0.35, cy - radius * 0.42);
    doc.line(cx, cy - radius * 0.22, cx - radius * 0.2, cy - radius * 0.55);
    doc.line(cx, cy - radius * 0.22, cx + radius * 0.2, cy - radius * 0.55);
    // Roots
    doc.setLineWidth(0.3);
    doc.line(cx, cy + radius * 0.55, cx - radius * 0.28, cy + radius * 0.72);
    doc.line(cx, cy + radius * 0.55, cx + radius * 0.28, cy + radius * 0.72);
    doc.line(cx, cy + radius * 0.55, cx, cy + radius * 0.76);
  } else if (illustrationId === 'pluma_tinta') {
    // Classic fountain nib & writing lines
    doc.line(cx - radius * 0.35, cy + radius * 0.35, cx + radius * 0.35, cy - radius * 0.35);
    doc.circle(cx + radius * 0.08, cy - radius * 0.08, 1.1, 'S');
    doc.line(cx - radius * 0.45, cy + radius * 0.52, cx + radius * 0.45, cy + radius * 0.52);
    doc.line(cx - radius * 0.3, cy + radius * 0.65, cx + radius * 0.3, cy + radius * 0.65);
  } else if (illustrationId === 'brujula_camino') {
    // Compass rose
    doc.line(cx, cy - radius * 0.68, cx, cy + radius * 0.68);
    doc.line(cx - radius * 0.68, cy, cx + radius * 0.68, cy);
    doc.line(cx - radius * 0.42, cy - radius * 0.42, cx + radius * 0.42, cy + radius * 0.42);
    doc.line(cx + radius * 0.42, cy - radius * 0.42, cx - radius * 0.42, cy + radius * 0.42);
    doc.circle(cx, cy, radius * 0.22, 'S');
  } else if (illustrationId === 'hogar_calido') {
    // Classic home arch
    const w = radius * 0.85;
    const h = radius * 0.95;
    doc.rect(cx - w / 2, cy - h / 2, w, h, 'S');
    doc.line(cx, cy - h / 2, cx, cy + h / 2);
    doc.line(cx - w / 2, cy, cx + w / 2, cy);
  } else {
    // Constelación familiar
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
    // If image embedding fails on an unusual format, draw a subtle frame instead of failing export
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

  // Full background fill
  doc.setFillColor(bgRgb[0], bgRgb[1], bgRgb[2]);
  doc.rect(0, 0, W, H, 'F');

  // Distinct architectural framing per cover design (1..5)
  if (coverDesign.id === 'clasica_eterna') {
    // Hardcover spine groove & double gold frame
    doc.setFillColor(secRgb[0], secRgb[1], secRgb[2]);
    doc.rect(0, 0, 9, H, 'F');
    doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.setLineWidth(0.5);
    doc.rect(14, 12, W - 24, H - 24, 'S');
    doc.setLineWidth(0.2);
    doc.rect(16, 14, W - 28, H - 28, 'S');
  } else if (coverDesign.id === 'recuerdos_marfil') {
    // Minimalist fine-line editorial frame
    doc.setDrawColor(borderRgb[0], borderRgb[1], borderRgb[2]);
    doc.setLineWidth(0.25);
    doc.rect(16, 16, W - 32, H - 32, 'S');
    doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.line(W * 0.35, 32, W * 0.65, 32);
  } else if (coverDesign.id === 'album_nuestra_vida') {
    // Warm family album border & corner accents
    doc.setFillColor(secRgb[0], secRgb[1], secRgb[2]);
    doc.rect(10, 10, W - 20, H - 20, 'F');
    doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.setLineWidth(0.45);
    doc.rect(13, 13, W - 26, H - 26, 'S');
  } else if (coverDesign.id === 'raices_recuerdos') {
    // Botanical double arch / organic frame
    doc.setDrawColor(borderRgb[0], borderRgb[1], borderRgb[2]);
    doc.setLineWidth(0.4);
    doc.rect(13, 13, W - 26, H - 26, 'S');
    doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.setLineWidth(0.25);
    doc.line(20, 24, W - 20, 24);
    doc.line(20, H - 24, W - 20, H - 24);
  } else {
    // Historia contemporánea: geometric asymmetric bands & copper accent bar
    doc.setFillColor(secRgb[0], secRgb[1], secRgb[2]);
    doc.rect(0, 0, W, H * 0.36, 'F');
    doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.rect(18, H * 0.36 - 1.2, W - 36, 2.4, 'F');
  }

  const fontName = coverDesign.id === 'historia_contemporanea' ? 'helvetica' : 'times';
  const cx = coverDesign.id === 'clasica_eterna' ? (W + 6) / 2 : W / 2;

  // Protagonist / Authors at top or prominent area
  doc.setFont(fontName, 'bold');
  doc.setFontSize(coverDesign.id === 'recuerdos_marfil' ? 14 : 11);
  doc.setTextColor(accentRgb[0], accentRgb[1], accentRgb[2]);
  const authorsText = (page.authors || '').toUpperCase();
  doc.text(authorsText, cx, 30, { align: 'center', maxWidth: W - 40 });

  // Main Book Title
  doc.setFont(fontName, 'bold');
  doc.setFontSize(format.titleFontPt + 4);
  doc.setTextColor(textRgb[0], textRgb[1], textRgb[2]);
  const titleLines = doc.splitTextToSize(page.title || 'Mi Historia', W - 44);
  doc.text(titleLines, cx, 46, { align: 'center' });

  const afterTitleY = 46 + titleLines.length * 8 + 4;

  // Subtitle
  if (page.subtitle) {
    doc.setFont(fontName, 'italic');
    doc.setFontSize(10.5);
    doc.setTextColor(subRgb[0], subRgb[1], subRgb[2]);
    const subLines = doc.splitTextToSize(page.subtitle, W - 48);
    doc.text(subLines, cx, afterTitleY, { align: 'center' });
  }

  // Visual centerpiece (Photo, Thematic Illustration, or Typographic Ornament)
  const visualCenterY = H * 0.58;
  if (editorialConfig.coverVisualType === 'photo' && coverPhoto) {
    const boxW = W * 0.52;
    const boxH = H * 0.32;
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
    drawVectorThematicIllustration(
      doc,
      editorialConfig.coverIllustrationId,
      cx,
      visualCenterY,
      Math.min(W, H) * 0.14,
      accentRgb
    );
  } else {
    // Purely typographic ornament
    doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.setLineWidth(0.35);
    doc.line(cx - 18, visualCenterY, cx + 18, visualCenterY);
    doc.circle(cx, visualCenterY, 1.5, 'S');
  }

  // Discrete ForeverYou imprint at bottom of cover
  doc.setFont(fontName, 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(subRgb[0], subRgb[1], subRgb[2]);
  doc.text('ForeverYou • Edición Conmemorativa', cx, H - 17, { align: 'center' });
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

  const cx = W / 2;
  const font = interiorStyle.pdfFontFamily;

  // Half-title / Portadilla header
  doc.setFont(font, 'bold');
  doc.setFontSize(format.titleFontPt);
  doc.setTextColor(textRgb[0], textRgb[1], textRgb[2]);
  const titleLines = doc.splitTextToSize(page.title || 'Mi Historia', W - 44);
  doc.text(titleLines, cx, format.marginTopMm + 18, { align: 'center' });

  let cursorY = format.marginTopMm + 18 + titleLines.length * 7 + 4;

  if (page.authors) {
    doc.setFont(font, 'italic');
    doc.setFontSize(11);
    doc.setTextColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.text(page.authors, cx, cursorY, { align: 'center' });
    cursorY += 10;
  }

  // Ornamental divider
  doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
  doc.setLineWidth(0.3);
  doc.line(cx - 14, cursorY, cx + 14, cursorY);
  cursorY += 14;

  // Dedication block
  if (page.dedication && page.dedication.trim().length > 0) {
    doc.setFont(font, 'italic');
    doc.setFontSize(format.baseFontPt);
    doc.setTextColor(textRgb[0], textRgb[1], textRgb[2]);
    const dedLines = doc.splitTextToSize(
      `«${stripInlineFormatting(page.dedication)}»`,
      W - (format.marginInnerMm + format.marginOuterMm + 16)
    );
    doc.text(dedLines, cx, cursorY, { align: 'center' });
    cursorY += dedLines.length * 5.5 + 14;
  }

  // Introduction block
  if (page.introduction && page.introduction.trim().length > 0) {
    doc.setFont(font, 'normal');
    doc.setFontSize(format.baseFontPt);
    doc.setTextColor(mutedRgb[0], mutedRgb[1], mutedRgb[2]);
    const contentW = W - format.marginInnerMm - format.marginOuterMm;
    const introLines = doc.splitTextToSize(
      stripInlineFormatting(page.introduction),
      contentW
    );
    doc.text(introLines, format.marginInnerMm, Math.max(cursorY, H * 0.52));
  }
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

  const font = interiorStyle.pdfFontFamily;
  const leftMargin = page.pageNumber % 2 === 1 ? format.marginInnerMm : format.marginOuterMm;
  const rightMargin = page.pageNumber % 2 === 1 ? format.marginOuterMm : format.marginInnerMm;
  const contentW = W - leftMargin - rightMargin;
  const cx = leftMargin + contentW / 2;

  // Subtle running header
  doc.setFont(font, 'italic');
  doc.setFontSize(8);
  doc.setTextColor(mutedRgb[0], mutedRgb[1], mutedRgb[2]);
  doc.text(
    composed.editorialConfig.customTitle || 'ForeverYou • Memoria Autobiográfica',
    cx,
    format.marginTopMm - 5,
    { align: 'center' }
  );

  let cursorY = format.marginTopMm + 4;
  const sections = page.sections || [];

  for (let sIdx = 0; sIdx < sections.length; sIdx++) {
    const sec = sections[sIdx];

    if (sIdx > 0) {
      cursorY += 4;
      doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
      doc.setLineWidth(0.25);
      doc.line(cx - 10, cursorY, cx + 10, cursorY);
      cursorY += 7;
    }

    // Chapter Header (or continuation label)
    if (!sec.isContinuation) {
      doc.setFont(font, 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(accentRgb[0], accentRgb[1], accentRgb[2]);
      doc.text(`CAPÍTULO ${sec.partNumber}`, cx, cursorY, { align: 'center' });
      cursorY += 5.5;

      doc.setFont(font, 'bold');
      doc.setFontSize(format.titleFontPt - 3);
      doc.setTextColor(textRgb[0], textRgb[1], textRgb[2]);
      const chTitleLines = doc.splitTextToSize(sec.title, contentW);
      doc.text(chTitleLines, cx, cursorY, { align: 'center' });
      cursorY += chTitleLines.length * 6 + 2.5;

      // Ornamental divider under chapter title
      doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
      doc.setLineWidth(0.25);
      doc.line(cx - 12, cursorY, cx + 12, cursorY);
      cursorY += 6;
    } else {
      doc.setFont(font, 'italic');
      doc.setFontSize(8.5);
      doc.setTextColor(mutedRgb[0], mutedRgb[1], mutedRgb[2]);
      doc.text(`${sec.title} (continuación)`, leftMargin, cursorY);
      cursorY += 6;
    }

    // Optional chapter photo (preserving aspect ratio)
    if (sec.photo && !sec.isContinuation) {
      const photoBoxH = Math.min(38, (H - cursorY - format.marginBottomMm) * 0.34);
      if (photoBoxH >= 20) {
        drawFittedPhoto(
          doc,
          sec.photo,
          leftMargin + contentW * 0.15,
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
          doc.text(sec.photo.caption, cx, cursorY, {
            align: 'center',
            maxWidth: contentW * 0.8,
          });
          cursorY += 4.5;
        }
      }
    }

    // Paragraphs
    doc.setFont(font, 'normal');
    doc.setFontSize(format.baseFontPt);
    doc.setTextColor(textRgb[0], textRgb[1], textRgb[2]);

    const lineHeightMm = format.baseFontPt * 0.44;
    for (const rawPara of sec.paragraphs) {
      const cleanPara = stripInlineFormatting(rawPara);
      if (!cleanPara) continue;
      const lines = doc.splitTextToSize(cleanPara, contentW);
      // Prevent overflowing bottom margin
      const maxRemainingLines = Math.max(
        1,
        Math.floor((H - format.marginBottomMm - 8 - cursorY) / lineHeightMm)
      );
      const safeLines = lines.slice(0, maxRemainingLines);
      doc.text(safeLines, leftMargin, cursorY);
      cursorY += safeLines.length * lineHeightMm + 3.2;
      if (cursorY > H - format.marginBottomMm - 12) break;
    }

    // Highlighted Pull Quote when space allows
    if (sec.pullQuote && cursorY < H - format.marginBottomMm - 22) {
      cursorY += 1.5;
      doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
      doc.setLineWidth(0.5);
      const quoteLines = doc.splitTextToSize(
        `«${stripInlineFormatting(sec.pullQuote)}»`,
        contentW - 10
      );
      const quoteBlockH = quoteLines.length * 4.5;
      doc.line(leftMargin + 2, cursorY - 3, leftMargin + 2, cursorY + quoteBlockH - 1);
      doc.setFont(font, 'italic');
      doc.setFontSize(format.baseFontPt - 0.5);
      doc.setTextColor(accentRgb[0], accentRgb[1], accentRgb[2]);
      doc.text(quoteLines, leftMargin + 6, cursorY);
      cursorY += quoteBlockH + 3;
    }
  }

  // Page number centered at bottom
  if (page.showPageNumber) {
    doc.setFont(font, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(mutedRgb[0], mutedRgb[1], mutedRgb[2]);
    doc.text(String(page.pageNumber), cx, H - format.marginBottomMm + 7, {
      align: 'center',
    });
  }
}

/**
 * Mandatory Final Page (Section 21 & Acceptance Criterion #15):
 * Contains ONLY:
 * - Centered horizontally & vertically: "Esta historia continuará..."
 * - Bottom-right corner aligned with editorial margin: "<< ForeverYou >>"
 * - No page number, no buttons, no links, no extra text.
 */
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

  const font = interiorStyle.pdfFontFamily;

  // Central text: either "Esta historia continuará..." or the interviewee's closing dedication
  const rawClosingText = stripInlineFormatting(
    page.centralClosingText || 'Esta historia continuará...'
  );
  const maxClosingWidth = W - (format.marginInnerMm + format.marginOuterMm + 16);
  doc.setFont(font, 'italic');
  doc.setFontSize(rawClosingText.length > 80 ? format.baseFontPt + 2 : format.titleFontPt - 1);
  doc.setTextColor(textRgb[0], textRgb[1], textRgb[2]);
  const closingLines = doc.splitTextToSize(rawClosingText, maxClosingWidth);
  const blockHeight = closingLines.length * 6;
  doc.text(closingLines, W / 2, H / 2 - blockHeight / 2 + 3, { align: 'center' });

  // Bottom-right corner aligned with editorial margin: "<< ForeverYou >>"
  doc.setFont(font, 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(accentRgb[0], accentRgb[1], accentRgb[2]);
  doc.text(
    page.bottomRightBrand || '<< ForeverYou >>',
    W - format.marginOuterMm,
    H - format.marginBottomMm,
    { align: 'right' }
  );
}

/**
 * Generates the real downloadable PDF Blob and Object URL from the composed book document.
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
    title: composed.editorialConfig.customTitle || 'Mi Historia — ForeverYou',
    author: composed.editorialConfig.customAuthors || profile.displayName || 'ForeverYou',
    subject: 'Libro autobiográfico — Prueba gratuita ForeverYou',
    creator: 'ForeverYou',
    keywords: 'autobiografía, memoria familiar, legado, ForeverYou',
  });

  pages.forEach((page, idx) => {
    if (idx > 0) {
      doc.addPage([format.widthMm, format.heightMm], 'portrait');
    }
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
