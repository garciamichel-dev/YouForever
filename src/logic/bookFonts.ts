/**
 * V5.6.0 — Book fonts served from /book-fonts (static, Latin-subset instances of SIL OFL fonts).
 * The SAME files are used by the viewer (@font-face) and embedded in the PDF (jsPDF), so text
 * metrics are identical. Generated from the Google Fonts sources; see public/book-fonts/README.md.
 */
export interface BookFontFace {
  /** Original family the design specs name (e.g. 'Playfair Display'). */
  sourceFamily: string;
  /** CSS family of the self-hosted instance (neutral name: modified OFL fonts cannot keep Reserved Font Names). */
  cssFamily: string;
  weight: number;
  style: 'normal' | 'italic';
  file: string;
}

export const BOOK_FONT_FACES: BookFontFace[] = [
  { sourceFamily: 'Playfair Display', cssFamily: 'YFBook PD', weight: 400, style: 'normal', file: 'YFBook-PD-400.ttf' },
  { sourceFamily: 'Playfair Display', cssFamily: 'YFBook PD', weight: 500, style: 'normal', file: 'YFBook-PD-500.ttf' },
  { sourceFamily: 'Playfair Display', cssFamily: 'YFBook PD', weight: 600, style: 'normal', file: 'YFBook-PD-600.ttf' },
  { sourceFamily: 'Playfair Display', cssFamily: 'YFBook PD', weight: 700, style: 'normal', file: 'YFBook-PD-700.ttf' },
  { sourceFamily: 'Playfair Display', cssFamily: 'YFBook PD', weight: 400, style: 'italic', file: 'YFBook-PD-400i.ttf' },
  { sourceFamily: 'Playfair Display', cssFamily: 'YFBook PD', weight: 600, style: 'italic', file: 'YFBook-PD-600i.ttf' },
  { sourceFamily: 'Playfair Display', cssFamily: 'YFBook PD', weight: 700, style: 'italic', file: 'YFBook-PD-700i.ttf' },
  { sourceFamily: 'EB Garamond', cssFamily: 'YFBook EBG', weight: 400, style: 'normal', file: 'YFBook-EBG-400.ttf' },
  { sourceFamily: 'EB Garamond', cssFamily: 'YFBook EBG', weight: 500, style: 'normal', file: 'YFBook-EBG-500.ttf' },
  { sourceFamily: 'EB Garamond', cssFamily: 'YFBook EBG', weight: 600, style: 'normal', file: 'YFBook-EBG-600.ttf' },
  { sourceFamily: 'EB Garamond', cssFamily: 'YFBook EBG', weight: 700, style: 'normal', file: 'YFBook-EBG-700.ttf' },
  { sourceFamily: 'EB Garamond', cssFamily: 'YFBook EBG', weight: 400, style: 'italic', file: 'YFBook-EBG-400i.ttf' },
  { sourceFamily: 'EB Garamond', cssFamily: 'YFBook EBG', weight: 600, style: 'italic', file: 'YFBook-EBG-600i.ttf' },
  { sourceFamily: 'EB Garamond', cssFamily: 'YFBook EBG', weight: 700, style: 'italic', file: 'YFBook-EBG-700i.ttf' },
  { sourceFamily: 'Cormorant Garamond', cssFamily: 'YFBook CG', weight: 400, style: 'normal', file: 'YFBook-CG-400.ttf' },
  { sourceFamily: 'Cormorant Garamond', cssFamily: 'YFBook CG', weight: 500, style: 'normal', file: 'YFBook-CG-500.ttf' },
  { sourceFamily: 'Cormorant Garamond', cssFamily: 'YFBook CG', weight: 600, style: 'normal', file: 'YFBook-CG-600.ttf' },
  { sourceFamily: 'Cormorant Garamond', cssFamily: 'YFBook CG', weight: 700, style: 'normal', file: 'YFBook-CG-700.ttf' },
  { sourceFamily: 'Cormorant Garamond', cssFamily: 'YFBook CG', weight: 400, style: 'italic', file: 'YFBook-CG-400i.ttf' },
  { sourceFamily: 'Cormorant Garamond', cssFamily: 'YFBook CG', weight: 600, style: 'italic', file: 'YFBook-CG-600i.ttf' },
  { sourceFamily: 'Cormorant Garamond', cssFamily: 'YFBook CG', weight: 700, style: 'italic', file: 'YFBook-CG-700i.ttf' },
  { sourceFamily: 'Lora', cssFamily: 'YFBook LO', weight: 400, style: 'normal', file: 'YFBook-LO-400.ttf' },
  { sourceFamily: 'Lora', cssFamily: 'YFBook LO', weight: 500, style: 'normal', file: 'YFBook-LO-500.ttf' },
  { sourceFamily: 'Lora', cssFamily: 'YFBook LO', weight: 600, style: 'normal', file: 'YFBook-LO-600.ttf' },
  { sourceFamily: 'Lora', cssFamily: 'YFBook LO', weight: 700, style: 'normal', file: 'YFBook-LO-700.ttf' },
  { sourceFamily: 'Lora', cssFamily: 'YFBook LO', weight: 400, style: 'italic', file: 'YFBook-LO-400i.ttf' },
  { sourceFamily: 'Lora', cssFamily: 'YFBook LO', weight: 600, style: 'italic', file: 'YFBook-LO-600i.ttf' },
  { sourceFamily: 'Lora', cssFamily: 'YFBook LO', weight: 700, style: 'italic', file: 'YFBook-LO-700i.ttf' },
  { sourceFamily: 'Plus Jakarta Sans', cssFamily: 'YFBook PJS', weight: 400, style: 'normal', file: 'YFBook-PJS-400.ttf' },
  { sourceFamily: 'Plus Jakarta Sans', cssFamily: 'YFBook PJS', weight: 500, style: 'normal', file: 'YFBook-PJS-500.ttf' },
  { sourceFamily: 'Plus Jakarta Sans', cssFamily: 'YFBook PJS', weight: 600, style: 'normal', file: 'YFBook-PJS-600.ttf' },
  { sourceFamily: 'Plus Jakarta Sans', cssFamily: 'YFBook PJS', weight: 700, style: 'normal', file: 'YFBook-PJS-700.ttf' },
  { sourceFamily: 'Plus Jakarta Sans', cssFamily: 'YFBook PJS', weight: 400, style: 'italic', file: 'YFBook-PJS-400i.ttf' },
  { sourceFamily: 'Plus Jakarta Sans', cssFamily: 'YFBook PJS', weight: 600, style: 'italic', file: 'YFBook-PJS-600i.ttf' },
  { sourceFamily: 'Plus Jakarta Sans', cssFamily: 'YFBook PJS', weight: 700, style: 'italic', file: 'YFBook-PJS-700i.ttf' },
  { sourceFamily: 'Manrope', cssFamily: 'YFBook MR', weight: 400, style: 'normal', file: 'YFBook-MR-400.ttf' },
  { sourceFamily: 'Manrope', cssFamily: 'YFBook MR', weight: 500, style: 'normal', file: 'YFBook-MR-500.ttf' },
  { sourceFamily: 'Manrope', cssFamily: 'YFBook MR', weight: 600, style: 'normal', file: 'YFBook-MR-600.ttf' },
  { sourceFamily: 'Manrope', cssFamily: 'YFBook MR', weight: 700, style: 'normal', file: 'YFBook-MR-700.ttf' },
  { sourceFamily: 'Source Serif 4', cssFamily: 'YFBook SS4', weight: 400, style: 'normal', file: 'YFBook-SS4-400.ttf' },
  { sourceFamily: 'Source Serif 4', cssFamily: 'YFBook SS4', weight: 500, style: 'normal', file: 'YFBook-SS4-500.ttf' },
  { sourceFamily: 'Source Serif 4', cssFamily: 'YFBook SS4', weight: 600, style: 'normal', file: 'YFBook-SS4-600.ttf' },
  { sourceFamily: 'Source Serif 4', cssFamily: 'YFBook SS4', weight: 700, style: 'normal', file: 'YFBook-SS4-700.ttf' },
  { sourceFamily: 'Source Serif 4', cssFamily: 'YFBook SS4', weight: 400, style: 'italic', file: 'YFBook-SS4-400i.ttf' },
  { sourceFamily: 'Source Serif 4', cssFamily: 'YFBook SS4', weight: 600, style: 'italic', file: 'YFBook-SS4-600i.ttf' },
  { sourceFamily: 'Source Serif 4', cssFamily: 'YFBook SS4', weight: 700, style: 'italic', file: 'YFBook-SS4-700i.ttf' },
  { sourceFamily: 'Libre Baskerville', cssFamily: 'YFBook LB', weight: 400, style: 'normal', file: 'YFBook-LB-400.ttf' },
  { sourceFamily: 'Libre Baskerville', cssFamily: 'YFBook LB', weight: 500, style: 'normal', file: 'YFBook-LB-500.ttf' },
  { sourceFamily: 'Libre Baskerville', cssFamily: 'YFBook LB', weight: 600, style: 'normal', file: 'YFBook-LB-600.ttf' },
  { sourceFamily: 'Libre Baskerville', cssFamily: 'YFBook LB', weight: 700, style: 'normal', file: 'YFBook-LB-700.ttf' },
  { sourceFamily: 'Libre Baskerville', cssFamily: 'YFBook LB', weight: 400, style: 'italic', file: 'YFBook-LB-400i.ttf' },
  { sourceFamily: 'Libre Baskerville', cssFamily: 'YFBook LB', weight: 600, style: 'italic', file: 'YFBook-LB-600i.ttf' },
  { sourceFamily: 'Libre Baskerville', cssFamily: 'YFBook LB', weight: 700, style: 'italic', file: 'YFBook-LB-700i.ttf' },
  { sourceFamily: 'Caveat', cssFamily: 'YFBook CV', weight: 400, style: 'normal', file: 'YFBook-CV-400.ttf' },
  { sourceFamily: 'Caveat', cssFamily: 'YFBook CV', weight: 500, style: 'normal', file: 'YFBook-CV-500.ttf' },
  { sourceFamily: 'Caveat', cssFamily: 'YFBook CV', weight: 600, style: 'normal', file: 'YFBook-CV-600.ttf' },
  { sourceFamily: 'Caveat', cssFamily: 'YFBook CV', weight: 700, style: 'normal', file: 'YFBook-CV-700.ttf' },
];

export const BOOK_FONTS_BASE_PATH = '/book-fonts/';

/** CSS family of the self-hosted instance for a source family, if there is one. */
export function bookCssFamilyFor(sourceFamily: string): string | undefined {
  return BOOK_FONT_FACES.find((f) => f.sourceFamily === sourceFamily)?.cssFamily;
}
