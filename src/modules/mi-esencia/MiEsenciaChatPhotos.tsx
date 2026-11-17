import React, { useEffect, useState } from 'react';
import { ImageOff, Loader2, X } from 'lucide-react';

/**
 * V5.4.0 — Fotografías reales del testimonio mostradas dentro de un mensaje del avatar.
 * Cada imagen se pide por POST con el código personal (nunca en la URL) y se guarda en memoria
 * durante la visita para no descargarla dos veces.
 */
const photoBlobCache = new Map<string, Promise<string | null>>();

function loadChatPhoto(personalCode: string, photoId: string): Promise<string | null> {
  const key = `${personalCode}::${photoId}`;
  const cached = photoBlobCache.get(key);
  if (cached) return cached;
  const request = (async () => {
    try {
      const res = await fetch('/api/mi-esencia/family/photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personalCode, photoId }),
      });
      if (!res.ok) return null;
      const blob = await res.blob();
      if (!blob.type.startsWith('image/')) return null;
      return URL.createObjectURL(blob);
    } catch (_err) {
      return null;
    }
  })();
  photoBlobCache.set(key, request);
  void request.then((url) => {
    if (!url) photoBlobCache.delete(key); // allow a later retry
  });
  return request;
}

function ChatPhoto({
  personalCode,
  photoId,
  caption,
  onOpen,
}: {
  personalCode: string;
  photoId: string;
  caption: string;
  onOpen: (src: string, caption: string) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    void loadChatPhoto(personalCode, photoId).then((url) => {
      if (!alive) return;
      if (url) setSrc(url);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [personalCode, photoId]);

  return (
    <figure className="rounded-xl overflow-hidden border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 font-sans">
      {src ? (
        <button
          type="button"
          onClick={() => onOpen(src, caption)}
          className="block w-full cursor-zoom-in"
          aria-label={`Ampliar fotografía: ${caption}`}
        >
          <img src={src} alt={caption} className="w-full max-h-80 object-cover" loading="lazy" />
        </button>
      ) : (
        <div className="h-40 flex items-center justify-center text-stone-400 dark:text-stone-500">
          {failed ? (
            <span className="inline-flex items-center gap-1.5 text-xs">
              <ImageOff className="w-4 h-4" />
              Fotografía no disponible en este momento
            </span>
          ) : (
            <Loader2 className="w-5 h-5 animate-spin" />
          )}
        </div>
      )}
      <figcaption className="px-3 py-2 text-xs text-stone-600 dark:text-stone-300 italic">«{caption}»</figcaption>
    </figure>
  );
}

export function MiEsenciaChatPhotos({
  personalCode,
  photos,
}: {
  personalCode: string;
  photos: Array<{ photoId: string; caption: string }>;
}) {
  const [enlarged, setEnlarged] = useState<{ src: string; caption: string } | null>(null);
  useEffect(() => {
    if (!enlarged) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEnlarged(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enlarged]);

  if (!photos || photos.length === 0) return null;
  return (
    <>
      <div
        className={`grid gap-2 pt-1 ${photos.length > 1 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}
        data-testid="mi-esencia-chat-photos"
      >
        {photos.map((p) => (
          <ChatPhoto
            key={p.photoId}
            personalCode={personalCode}
            photoId={p.photoId}
            caption={p.caption}
            onOpen={(src, caption) => setEnlarged({ src, caption })}
          />
        ))}
      </div>
      {enlarged && (
        <div
          className="fixed inset-0 z-[90] bg-stone-950/85 flex flex-col items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setEnlarged(null)}
        >
          <button
            type="button"
            onClick={() => setEnlarged(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
            aria-label="Cerrar fotografía"
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={enlarged.src}
            alt={enlarged.caption}
            className="max-w-full max-h-[80vh] rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <p className="mt-3 text-sm text-stone-100 italic text-center max-w-2xl">«{enlarged.caption}»</p>
        </div>
      )}
    </>
  );
}
