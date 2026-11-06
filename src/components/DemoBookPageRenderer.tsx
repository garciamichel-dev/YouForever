import React from 'react';
import {
  ComposedBookDocument,
  ComposedBookPage,
  DemoCoverDesignSpec,
  DemoCoverPaletteVariant,
  DemoInMemoryPhoto,
  DemoInteriorStyleSpec,
  DemoThematicIllustrationId,
} from '../logic/demoStoryRules.ts';

export const ThematicIllustrationSvg: React.FC<{
  id: DemoThematicIllustrationId;
  colorHex: string;
  className?: string;
}> = ({ id, colorHex, className = 'w-20 h-20' }) => {
  return (
    <svg
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <circle cx="60" cy="60" r="52" stroke={colorHex} strokeWidth="1.4" opacity="0.85" />
      <circle cx="60" cy="60" r="47" stroke={colorHex} strokeWidth="0.7" opacity="0.55" />

      {id === 'arbol_raices' && (
        <g stroke={colorHex} strokeLinecap="round" strokeLinejoin="round">
          <path d="M60 88V42" strokeWidth="2.2" />
          <path d="M60 58C50 50 42 42 38 33" strokeWidth="1.6" />
          <path d="M60 54C70 46 78 39 82 31" strokeWidth="1.6" />
          <path d="M60 45C53 38 48 31 46 25" strokeWidth="1.3" />
          <path d="M60 45C67 38 72 31 74 25" strokeWidth="1.3" />
          <path d="M60 88C52 93 45 97 40 101" strokeWidth="1.3" />
          <path d="M60 88C68 93 75 97 80 101" strokeWidth="1.3" />
          <path d="M60 88V103" strokeWidth="1.3" />
          <circle cx="38" cy="32" r="2.5" fill={colorHex} />
          <circle cx="82" cy="30" r="2.5" fill={colorHex} />
          <circle cx="60" cy="23" r="2.5" fill={colorHex} />
        </g>
      )}

      {id === 'pluma_tinta' && (
        <g stroke={colorHex} strokeLinecap="round" strokeLinejoin="round">
          <path d="M38 80L78 32L86 40L46 84L34 86L38 80Z" strokeWidth="1.6" />
          <circle cx="58" cy="60" r="2.2" fill={colorHex} />
          <path d="M34 93H86" strokeWidth="1.2" />
          <path d="M42 99H78" strokeWidth="0.9" opacity="0.75" />
        </g>
      )}

      {id === 'brujula_camino' && (
        <g stroke={colorHex} strokeLinecap="round" strokeLinejoin="round">
          <path d="M60 20L66 54L100 60L66 66L60 100L54 66L20 60L54 54L60 20Z" strokeWidth="1.5" />
          <circle cx="60" cy="60" r="8" strokeWidth="1.2" />
          <circle cx="60" cy="60" r="2" fill={colorHex} />
        </g>
      )}

      {id === 'hogar_calido' && (
        <g stroke={colorHex} strokeLinecap="round" strokeLinejoin="round">
          <path
            d="M38 88V52C38 39.8497 47.8497 30 60 30C72.1503 30 82 39.8497 82 52V88H38Z"
            strokeWidth="1.6"
          />
          <path d="M60 30V88" strokeWidth="1.1" />
          <path d="M38 59H82" strokeWidth="1.1" />
          <path d="M32 88H88" strokeWidth="1.8" />
        </g>
      )}

      {id === 'constelacion_familiar' && (
        <g stroke={colorHex} strokeLinecap="round" strokeLinejoin="round">
          <path d="M36 74L48 44L68 52L84 34" strokeWidth="1.3" strokeDasharray="2 2" />
          <path d="M48 44L64 82L84 66" strokeWidth="1.3" />
          <circle cx="36" cy="74" r="3" fill={colorHex} />
          <circle cx="48" cy="44" r="3.5" fill={colorHex} />
          <circle cx="68" cy="52" r="3" fill={colorHex} />
          <circle cx="84" cy="34" r="3.5" fill={colorHex} />
          <circle cx="64" cy="82" r="3" fill={colorHex} />
          <circle cx="84" cy="66" r="2.5" fill={colorHex} />
        </g>
      )}
    </svg>
  );
};

function renderFormattedInlineText(raw: string): React.ReactNode {
  const parts = raw.split(/(\*\*.*?\*\*|\*.*?\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={idx}>{part.slice(1, -1)}</em>;
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export const DemoCoverThumbnailCard: React.FC<{
  design: DemoCoverDesignSpec;
  palette: DemoCoverPaletteVariant;
  title: string;
  authors: string;
  selected: boolean;
  onSelect: () => void;
}> = ({ design, palette, title, authors, selected, onSelect }) => {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group text-left rounded-2xl p-2.5 border-2 transition-all cursor-pointer flex flex-col justify-between ${
        selected
          ? 'border-amber-700 bg-amber-50/60 shadow-md ring-2 ring-amber-300/60'
          : 'border-stone-200 bg-white hover:border-stone-300 hover:shadow-xs'
      }`}
    >
      {/* Miniature Book Cover Representation */}
      <div
        className="w-full aspect-[2/3] rounded-xl relative overflow-hidden p-3 flex flex-col justify-between shadow-inner"
        style={{
          backgroundColor: palette.bgHex,
          color: palette.textHex,
          fontFamily: design.titleFontFamily,
        }}
      >
        {design.id === 'clasica_eterna' && (
          <>
            <div
              className="absolute inset-y-0 left-0 w-2.5"
              style={{ backgroundColor: palette.secondaryBgHex }}
            />
            <div
              className="absolute inset-2.5 pointer-events-none"
              style={{ border: `1.5px solid ${palette.accentHex}` }}
            />
          </>
        )}

        {design.id === 'recuerdos_marfil' && (
          <div
            className="absolute inset-3 pointer-events-none"
            style={{ border: `1px solid ${palette.borderHex}` }}
          />
        )}

        {design.id === 'album_nuestra_vida' && (
          <div
            className="absolute inset-2 rounded-lg pointer-events-none"
            style={{
              backgroundColor: palette.secondaryBgHex,
              border: `1px dashed ${palette.accentHex}`,
            }}
          />
        )}

        {design.id === 'raices_recuerdos' && (
          <div
            className="absolute inset-2.5 rounded-t-full pointer-events-none"
            style={{ border: `1px solid ${palette.accentHex}` }}
          />
        )}

        {design.id === 'historia_contemporanea' && (
          <div
            className="absolute inset-x-0 top-0 h-2/5 pointer-events-none"
            style={{
              backgroundColor: palette.secondaryBgHex,
              borderBottom: `2px solid ${palette.accentHex}`,
            }}
          />
        )}

        <div className="relative z-10 text-center pt-2 px-1">
          <div
            className="text-[8px] uppercase tracking-widest font-semibold truncate"
            style={{ color: palette.accentHex }}
          >
            {authors || 'Protagonista'}
          </div>
          <div className="text-[11px] font-bold leading-tight mt-1 line-clamp-2">
            {title || 'Mi Historia'}
          </div>
        </div>

        <div className="relative z-10 flex items-center justify-center my-1">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ border: `1px solid ${palette.accentHex}` }}
          >
            <span className="text-[9px]" style={{ color: palette.accentHex }}>
              ✦
            </span>
          </div>
        </div>

        <div
          className="relative z-10 text-[7px] text-center tracking-wider opacity-80"
          style={{ color: palette.subtextHex }}
        >
          ForeverYou
        </div>
      </div>

      <div className="mt-2.5 px-0.5">
        <div className="flex items-center justify-between gap-1">
          <span className="text-xs font-serif font-bold text-stone-900">
            {design.number}. {design.name}
          </span>
          {selected && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-800 text-white">
              Activa
            </span>
          )}
        </div>
        <p className="text-[10px] text-stone-500 mt-0.5 line-clamp-2">{design.sensation}</p>
      </div>
    </button>
  );
};

export const DemoInteriorThumbnailCard: React.FC<{
  styleSpec: DemoInteriorStyleSpec;
  selected: boolean;
  onSelect: () => void;
}> = ({ styleSpec, selected, onSelect }) => {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`text-left rounded-2xl p-2.5 border-2 transition-all cursor-pointer flex flex-col justify-between ${
        selected
          ? 'border-amber-700 bg-amber-50/60 shadow-md ring-2 ring-amber-300/60'
          : 'border-stone-200 bg-white hover:border-stone-300 hover:shadow-xs'
      }`}
    >
      {/* Authentic Miniature Interior Page */}
      <div
        className="w-full aspect-[3/4] rounded-xl p-3 flex flex-col justify-between border border-stone-200/80 shadow-inner overflow-hidden"
        style={{
          backgroundColor: styleSpec.pageBgHex,
          color: styleSpec.textHex,
          fontFamily: styleSpec.bodyFontFamily,
        }}
      >
        <div className="space-y-1.5">
          <div
            className="text-[7px] uppercase tracking-widest text-center"
            style={{ color: styleSpec.accentHex }}
          >
            Capítulo I
          </div>
          <div
            className="text-[10px] font-bold text-center leading-tight"
            style={{ fontFamily: styleSpec.titleFontFamily }}
          >
            Mis Raíces
          </div>
          <div className="flex justify-center py-0.5">
            <span
              className="block h-[1px] w-6"
              style={{ backgroundColor: styleSpec.accentHex }}
            />
          </div>

          <p
            className="text-[7.5px] leading-relaxed"
            style={{ textAlign: styleSpec.textAlign }}
          >
            {styleSpec.useDropCap && (
              <span
                className="float-left text-sm font-bold leading-none mr-1"
                style={{ color: styleSpec.accentHex, fontFamily: styleSpec.titleFontFamily }}
              >
                C
              </span>
            )}
            uando vuelvo a la casa de mi infancia, todavía escucho las voces que dieron origen a nuestra historia.
          </p>

          <div
            className="pl-1.5 py-0.5 text-[7px] italic"
            style={{
              borderLeft: `1.5px solid ${styleSpec.accentHex}`,
              color: styleSpec.accentHex,
              fontFamily: styleSpec.accentFontFamily || styleSpec.bodyFontFamily,
            }}
          >
            «Un recuerdo para siempre»
          </div>
        </div>

        <div
          className="text-[7px] text-center pt-1"
          style={{ color: styleSpec.mutedHex }}
        >
          — 3 —
        </div>
      </div>

      <div className="mt-2.5 px-0.5">
        <div className="flex items-center justify-between gap-1">
          <span className="text-xs font-serif font-bold text-stone-900">
            {styleSpec.number}. {styleSpec.name}
          </span>
          {selected && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-800 text-white">
              Activo
            </span>
          )}
        </div>
        <p className="text-[10px] text-stone-500 mt-0.5 line-clamp-2">{styleSpec.subtitle}</p>
      </div>
    </button>
  );
};

/**
 * Renders any composed page (`cover`, `title_dedication`, `chapter_content`, `closing_mandatory`)
 * faithfully matching the generated PDF document.
 */
export const DemoComposedPageView: React.FC<{
  composed: ComposedBookDocument;
  page: ComposedBookPage;
  className?: string;
}> = ({ composed, page, className = '' }) => {
  const { format, coverDesign, coverPalette, interiorStyle, editorialConfig, coverPhoto } =
    composed;

  const renderPhotoBox = (photo: DemoInMemoryPhoto, heightClass: string) => {
    const objectPos =
      photo.focusY === 'top'
        ? 'center top'
        : photo.focusY === 'bottom'
        ? 'center bottom'
        : 'center center';
    return (
      <div className={`w-full ${heightClass} flex flex-col items-center justify-center my-2`}>
        <div
          className="relative w-4/5 h-full rounded-lg overflow-hidden border shadow-xs flex items-center justify-center bg-black/5"
          style={{ borderColor: coverPalette.accentHex }}
        >
          <img
            src={photo.objectUrl || photo.dataUrl}
            alt={photo.caption || 'Fotografía del recuerdo'}
            className="max-w-full max-h-full object-contain transition-transform"
            style={{
              objectPosition: objectPos,
              transform: `scale(${photo.zoom || 1})`,
            }}
          />
        </div>
        {photo.caption && (
          <span className="text-[10px] italic mt-1 opacity-80 text-center px-2">
            {photo.caption}
          </span>
        )}
      </div>
    );
  };

  // PAGE 1: COVER
  if (page.kind === 'cover') {
    return (
      <div
        className={`relative w-full overflow-hidden shadow-lg select-none flex flex-col justify-between p-6 sm:p-8 ${className}`}
        style={{
          aspectRatio: `${format.widthMm} / ${format.heightMm}`,
          backgroundColor: coverPalette.bgHex,
          color: coverPalette.textHex,
          fontFamily: coverDesign.bodyFontFamily,
        }}
      >
        {/* Cover Architectural Framing */}
        {coverDesign.id === 'clasica_eterna' && (
          <>
            <div
              className="absolute inset-y-0 left-0 w-4 sm:w-5 shadow-inner"
              style={{ backgroundColor: coverPalette.secondaryBgHex }}
            />
            <div
              className="absolute inset-4 sm:inset-5 pointer-events-none"
              style={{ border: `2px solid ${coverPalette.accentHex}` }}
            />
            <div
              className="absolute inset-5 sm:inset-6 pointer-events-none"
              style={{ border: `1px solid ${coverPalette.borderHex}` }}
            />
          </>
        )}

        {coverDesign.id === 'recuerdos_marfil' && (
          <div
            className="absolute inset-5 sm:inset-6 pointer-events-none"
            style={{ border: `1px solid ${coverPalette.borderHex}` }}
          />
        )}

        {coverDesign.id === 'album_nuestra_vida' && (
          <div
            className="absolute inset-3.5 sm:inset-4 rounded-xl pointer-events-none"
            style={{
              backgroundColor: coverPalette.secondaryBgHex,
              border: `1.5px solid ${coverPalette.accentHex}`,
            }}
          />
        )}

        {coverDesign.id === 'raices_recuerdos' && (
          <div
            className="absolute inset-4 sm:inset-5 pointer-events-none"
            style={{ border: `1.5px solid ${coverPalette.borderHex}` }}
          />
        )}

        {coverDesign.id === 'historia_contemporanea' && (
          <div
            className="absolute inset-x-0 top-0 h-[36%] pointer-events-none"
            style={{
              backgroundColor: coverPalette.secondaryBgHex,
              borderBottom: `3px solid ${coverPalette.accentHex}`,
            }}
          />
        )}

        {/* Header: Protagonist & Title */}
        <div className="relative z-10 text-center space-y-2 pt-3 px-3">
          <div
            className="text-[11px] sm:text-xs uppercase tracking-[0.2em] font-semibold"
            style={{ color: coverPalette.accentHex }}
          >
            {page.authors}
          </div>

          <h2
            className="text-xl sm:text-2xl font-bold leading-snug"
            style={{ fontFamily: coverDesign.titleFontFamily }}
          >
            {page.title}
          </h2>

          {page.subtitle && (
            <p
              className="text-xs sm:text-sm italic opacity-90 max-w-xs mx-auto"
              style={{
                color: coverPalette.subtextHex,
                fontFamily: coverDesign.accentFontFamily || coverDesign.bodyFontFamily,
              }}
            >
              {page.subtitle}
            </p>
          )}
        </div>

        {/* Centerpiece: Photo, Thematic Illustration, or Typographic Ornament */}
        <div className="relative z-10 flex-1 flex items-center justify-center my-2">
          {editorialConfig.coverVisualType === 'photo' && coverPhoto ? (
            renderPhotoBox(coverPhoto, 'h-36 sm:h-44')
          ) : editorialConfig.coverVisualType === 'illustration' ? (
            <ThematicIllustrationSvg
              id={editorialConfig.coverIllustrationId}
              colorHex={coverPalette.accentHex}
              className="w-24 h-24 sm:w-28 sm:h-28"
            />
          ) : (
            <div className="flex items-center gap-3 opacity-80">
              <span
                className="block w-10 h-[1px]"
                style={{ backgroundColor: coverPalette.accentHex }}
              />
              <span style={{ color: coverPalette.accentHex }}>❖</span>
              <span
                className="block w-10 h-[1px]"
                style={{ backgroundColor: coverPalette.accentHex }}
              />
            </div>
          )}
        </div>

        {/* Footer: ForeverYou Imprint */}
        <div
          className="relative z-10 text-center text-[10px] tracking-widest uppercase pb-1"
          style={{ color: coverPalette.subtextHex }}
        >
          ForeverYou • Edición Conmemorativa
        </div>
      </div>
    );
  }

  // PAGE 2: PORTADILLA, DEDICATORIA E INTRODUCCIÓN
  if (page.kind === 'title_dedication') {
    return (
      <div
        className={`relative w-full overflow-hidden shadow-lg flex flex-col justify-between p-6 sm:p-9 ${className}`}
        style={{
          aspectRatio: `${format.widthMm} / ${format.heightMm}`,
          backgroundColor: interiorStyle.pageBgHex,
          color: interiorStyle.textHex,
          fontFamily: interiorStyle.bodyFontFamily,
        }}
      >
        <div className="space-y-4 text-center pt-4">
          <h3
            className="text-lg sm:text-xl font-bold leading-snug"
            style={{ fontFamily: interiorStyle.titleFontFamily }}
          >
            {page.title}
          </h3>
          {page.authors && (
            <div
              className="text-xs sm:text-sm italic font-medium"
              style={{ color: interiorStyle.accentHex }}
            >
              {page.authors}
            </div>
          )}

          <div className="flex items-center justify-center gap-2 py-1">
            <span
              className="block w-8 h-[1px]"
              style={{ backgroundColor: interiorStyle.accentHex }}
            />
            <span className="text-xs" style={{ color: interiorStyle.accentHex }}>
              ✦
            </span>
            <span
              className="block w-8 h-[1px]"
              style={{ backgroundColor: interiorStyle.accentHex }}
            />
          </div>

          {page.dedication && (
            <blockquote
              className="text-xs sm:text-sm italic px-4 py-2 max-w-sm mx-auto leading-relaxed"
              style={{
                fontFamily: interiorStyle.accentFontFamily || interiorStyle.bodyFontFamily,
              }}
            >
              «{renderFormattedInlineText(page.dedication)}»
            </blockquote>
          )}
        </div>

        {page.introduction && (
          <div className="my-auto pt-4 border-t border-stone-200/70">
            <p
              className="text-xs sm:text-[13px] leading-relaxed"
              style={{
                color: interiorStyle.mutedHex,
                textAlign: interiorStyle.textAlign,
              }}
            >
              {renderFormattedInlineText(page.introduction)}
            </p>
          </div>
        )}

        <div className="text-[10px] text-center opacity-50">ForeverYou</div>
      </div>
    );
  }

  // MANDATORY FINAL PAGE (Section 21 & Criterion #15)
  if (page.kind === 'closing_mandatory') {
    return (
      <div
        data-testid="demo-mandatory-closing-page"
        className={`relative w-full overflow-hidden shadow-lg flex flex-col justify-between p-7 sm:p-10 ${className}`}
        style={{
          aspectRatio: `${format.widthMm} / ${format.heightMm}`,
          backgroundColor: interiorStyle.pageBgHex,
          color: interiorStyle.textHex,
          fontFamily: interiorStyle.bodyFontFamily,
        }}
      >
        <div />

        <div className="my-auto text-center px-4">
          <p
            className="text-lg sm:text-xl italic font-medium tracking-wide"
            style={{ fontFamily: interiorStyle.titleFontFamily }}
          >
            {page.centralClosingText || 'Esta historia continuará...'}
          </p>
        </div>

        <div className="w-full flex justify-end">
          <span
            className="text-xs font-serif tracking-wider"
            style={{ color: interiorStyle.accentHex }}
          >
            {page.bottomRightBrand || '<< ForeverYou >>'}
          </span>
        </div>
      </div>
    );
  }

  // MIDDLE PAGES: CHAPTER CONTENT
  return (
    <div
      className={`relative w-full overflow-hidden shadow-lg flex flex-col justify-between p-6 sm:p-8 ${className}`}
      style={{
        aspectRatio: `${format.widthMm} / ${format.heightMm}`,
        backgroundColor: interiorStyle.pageBgHex,
        color: interiorStyle.textHex,
        fontFamily: interiorStyle.bodyFontFamily,
      }}
    >
      {/* Running header */}
      <div
        className="text-[9px] italic text-center tracking-wide pb-2 border-b border-stone-200/50 truncate"
        style={{ color: interiorStyle.mutedHex }}
      >
        {composed.editorialConfig.customTitle || 'ForeverYou • Memoria Autobiográfica'}
      </div>

      {/* Chapter Sections */}
      <div className="flex-1 overflow-y-auto py-2 space-y-4 scrollbar-none">
        {(page.sections || []).map((sec, sIdx) => (
          <div key={`${sec.chapterId}_${sIdx}`} className="space-y-2.5">
            {sIdx > 0 && (
              <div className="flex justify-center py-1">
                <span
                  className="block w-8 h-[1px]"
                  style={{ backgroundColor: interiorStyle.accentHex }}
                />
              </div>
            )}

            {!sec.isContinuation ? (
              <div className="text-center space-y-1">
                <div
                  className="text-[9px] uppercase tracking-[0.2em] font-bold"
                  style={{ color: interiorStyle.accentHex }}
                >
                  Capítulo {sec.partNumber}
                </div>
                <h4
                  className="text-sm sm:text-base font-bold leading-snug"
                  style={{ fontFamily: interiorStyle.titleFontFamily }}
                >
                  {sec.title}
                </h4>
                <div className="flex justify-center pt-0.5">
                  <span
                    className="block w-7 h-[1px]"
                    style={{ backgroundColor: interiorStyle.accentHex }}
                  />
                </div>
              </div>
            ) : (
              <div
                className="text-[10px] italic"
                style={{ color: interiorStyle.mutedHex }}
              >
                {sec.title} (continuación)
              </div>
            )}

            {sec.photo && !sec.isContinuation && renderPhotoBox(sec.photo, 'h-28 sm:h-32')}

            <div className="space-y-2">
              {sec.paragraphs.map((para, pIdx) => {
                const useDrop =
                  interiorStyle.useDropCap && !sec.isContinuation && pIdx === 0 && para.length > 1;
                const firstChar = useDrop ? para.charAt(0) : '';
                const restText = useDrop ? para.slice(1) : para;

                return (
                  <p
                    key={pIdx}
                    className="text-xs sm:text-[13px] leading-relaxed"
                    style={{ textAlign: interiorStyle.textAlign }}
                  >
                    {useDrop && (
                      <span
                        className="float-left text-2xl sm:text-3xl font-bold leading-none mr-2 mt-0.5"
                        style={{
                          color: interiorStyle.accentHex,
                          fontFamily: interiorStyle.titleFontFamily,
                        }}
                      >
                        {firstChar}
                      </span>
                    )}
                    {renderFormattedInlineText(restText)}
                  </p>
                );
              })}
            </div>

            {sec.pullQuote && (
              <blockquote
                className="pl-3 py-1 my-2 text-[11px] sm:text-xs italic leading-snug"
                style={{
                  borderLeft: `2px solid ${interiorStyle.accentHex}`,
                  color: interiorStyle.accentHex,
                  fontFamily: interiorStyle.accentFontFamily || interiorStyle.bodyFontFamily,
                }}
              >
                «{renderFormattedInlineText(sec.pullQuote)}»
              </blockquote>
            )}
          </div>
        ))}
      </div>

      {/* Footer Page Number */}
      {page.showPageNumber && (
        <div
          className="text-[10px] text-center pt-1.5"
          style={{ color: interiorStyle.mutedHex }}
        >
          — {page.pageNumber} —
        </div>
      )}
    </div>
  );
};
