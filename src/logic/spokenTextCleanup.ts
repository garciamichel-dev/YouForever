/**
 * V5.3.5 — Light, deterministic cleanup of spoken disfluencies for the sample's faithful redaction
 * (used only when the model could not draft the sample in time, or when a chapter contained
 * excluded content). It never adds words: it removes truncated fragments ("ju-", "gus-"),
 * immediate repetitions ("Y y", "que que"), and oral fillers ("bueno,", "pues", "vaya,", "o sea"),
 * then fixes spacing and capitalisation.
 */
export function cleanSpokenDisfluencies(paragraphs: string[]): string[] {
  return paragraphs.map((raw) => {
    let t = ` ${String(raw || '')} `;
    // Truncated fragments: "ju-, precisamente" / "le gus- le gustaba" / "se- mi".
    t = t.replace(/(\s)[\p{L}]{1,6}-,?(?=\s)/gu, '$1');
    // Immediate repetitions: "Y y", "de de", "que que" (twice or more in a row).
    t = t.replace(/(?<![\p{L}])(\p{L}+)(?:[\s,]+\1)+(?![\p{L}])/giu, '$1');
    // Oral fillers.
    t = t.replace(/(^|[.!?]\s+|\s)[Yy] bueno,?\s+/gu, '$1');
    t = t.replace(/([,;]\s*|\s)bueno,\s+/giu, '$1');
    t = t.replace(/(^|[.!?]\s+)Bueno,?\s+/gu, '$1');
    t = t.replace(/\s(?:pues|vaya|o sea),?(?=\s)/giu, '');
    // Spacing and punctuation.
    t = t.replace(/\s+([,.;:!?])/g, '$1').replace(/,\s*,/g, ',').replace(/([.!?])\s*,\s*/g, '$1 ');
    t = t.replace(/\s{2,}/g, ' ').trim();
    t = t.replace(/^,\s*/, '');
    t = t.replace(/(^|[.!?]\s+)(\p{Ll})/gu, (_m, pre: string, ch: string) => pre + ch.toUpperCase());
    return t;
  });
}
