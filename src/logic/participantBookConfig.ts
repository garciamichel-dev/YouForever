/**
 * V5.8.3 — Defaults of the editorial configuration of the books of the PARTICIPANT PORTAL.
 *
 * The «Incluir índice» checkbox of the studio shows the table of contents as ON when the saved
 * configuration has no value (`includeTableOfContents ?? true`), but the composer treats a missing
 * value as OFF. A version saved without the value (and every version later derived from it) was
 * therefore built, saved and downloaded WITHOUT the index while the checkbox looked checked.
 * The portal (viewer, saving, downloads) and the administrator downloads now use the same default
 * as the checkbox; an explicit `false` (index unchecked on purpose) is respected.
 * The demo (/Free) and «Conóceme» do not use this: their defaults are unchanged.
 */
import type { DemoEditorialConfig } from './demoStoryRules.ts';

export const PARTICIPANT_BOOK_INCLUDES_TOC_BY_DEFAULT = true;

export function withParticipantBookDefaults<T extends Partial<DemoEditorialConfig> | null | undefined>(
  config: T
): T extends null | undefined ? T : T & { includeTableOfContents: boolean } {
  if (!config) return config as any;
  return {
    ...config,
    includeTableOfContents: config.includeTableOfContents ?? PARTICIPANT_BOOK_INCLUDES_TOC_BY_DEFAULT,
  } as any;
}
