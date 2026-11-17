import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';

/**
 * V5.3.6 — Automatic saving of the participant's answers.
 *
 * Every edit is saved by itself shortly after the participant stops typing (and right away when
 * the field loses focus or the question changes), without pressing «Guardar y Continuar».
 */

export type AutosaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'retrying';

/** Pure decision used by the hook (exported for tests). */
export function shouldAutosave(params: { value: string; lastSavedValue: string; enabled: boolean }): boolean {
  const value = params.value.trim();
  return params.enabled && value.length > 0 && value !== params.lastSavedValue.trim();
}

export interface DebouncedAutosave {
  state: AutosaveState;
  savedAt: Date | null;
  /** Saves now whatever is pending (blur, question change). */
  flush: () => void;
  /** Drops the pending save (an explicit save is about to send the same text). */
  cancel: () => void;
  /** Resolves when no autosave is in flight. */
  waitIdle: () => Promise<void>;
}

/**
 * Debounced autosave of `value`. `key` identifies what is being edited (question/answer id): when it
 * changes, the pending text of the previous key is saved immediately with the previous `save`.
 * `save` returns true when the server stored the text.
 */
export function useDebouncedAutosave(params: {
  key: string;
  value: string;
  lastSavedValue: string;
  enabled: boolean;
  save: (value: string) => Promise<boolean>;
  delayMs?: number;
}): DebouncedAutosave {
  const { key, value, lastSavedValue, enabled, save, delayMs = 1500 } = params;
  const [state, setState] = useState<AutosaveState>('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<{ key: string; value: string; save: (v: string) => Promise<boolean> } | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const lastSentRef = useRef<{ key: string; value: string } | null>(null);
  const retryRef = useRef<number>(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runSave = useCallback((job: { key: string; value: string; save: (v: string) => Promise<boolean> }) => {
    const previous = inFlightRef.current || Promise.resolve();
    const run = previous.then(async () => {
      if (lastSentRef.current && lastSentRef.current.key === job.key && lastSentRef.current.value === job.value) {
        return;
      }
      if (mountedRef.current) setState('saving');
      let ok = false;
      try {
        ok = await job.save(job.value);
      } catch (_err) {
        ok = false;
      }
      if (ok) {
        lastSentRef.current = { key: job.key, value: job.value };
        retryRef.current = 0;
        if (mountedRef.current) {
          setState('saved');
          setSavedAt(new Date());
        }
      } else if (mountedRef.current) {
        // Network or temporary problem: try again a few seconds later (up to 3 times).
        setState('retrying');
        if (retryRef.current < 3) {
          retryRef.current += 1;
          if (timerRef.current) clearTimeout(timerRef.current);
          pendingRef.current = job;
          timerRef.current = setTimeout(() => {
            const pending = pendingRef.current;
            pendingRef.current = null;
            if (pending) runSave(pending);
          }, 4000 * retryRef.current);
        }
      }
    });
    inFlightRef.current = run.finally(() => {
      if (inFlightRef.current === run) inFlightRef.current = null;
    });
    return run;
  }, []);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) void runSave(pending);
  }, [runSave]);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
  }, []);

  const waitIdle = useCallback(async () => {
    while (inFlightRef.current) {
      await inFlightRef.current.catch(() => undefined);
    }
  }, []);

  // Question/answer changed: save what was pending for the previous one right away.
  const keyRef = useRef(key);
  useEffect(() => {
    if (keyRef.current !== key) {
      keyRef.current = key;
      flush();
      retryRef.current = 0;
      setState('idle');
    }
  }, [key, flush]);

  // Schedule a save after the participant stops typing.
  useEffect(() => {
    if (!shouldAutosave({ value, lastSavedValue, enabled })) {
      if (pendingRef.current && pendingRef.current.key === key) cancel();
      return;
    }
    pendingRef.current = { key, value, save };
    setState('pending');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) void runSave(pending);
    }, delayMs);
  }, [key, value, lastSavedValue, enabled]);

  // Leaving the screen: send what is pending.
  useEffect(() => () => flush(), [flush]);

  return { state, savedAt, flush, cancel, waitIdle };
}

export function AutosaveStatusLabel({ state, savedAt }: { state: AutosaveState; savedAt: Date | null }) {
  if (state === 'idle' && !savedAt) return null;
  const time = savedAt
    ? savedAt.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
    : '';
  const text =
    state === 'saving' || state === 'pending'
      ? 'Guardando...'
      : state === 'retrying'
        ? 'Se guardará en cuanto haya conexión...'
        : `Guardado automáticamente${time ? ` · ${time}` : ''}`;
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] text-stone-500"
      data-testid="autosave-status"
      aria-live="polite"
    >
      {state === 'saving' || state === 'pending' || state === 'retrying' ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : (
        <Check className="w-3 h-3 text-emerald-600" />
      )}
      {text}
    </span>
  );
}

/**
 * Inline editor of an already saved answer (main answer, follow-up or additional information):
 * the text is always editable and every edit is saved automatically.
 */
export function AutoSaveAnswerEditor({
  answerId,
  initialText,
  placeholder,
  disabled,
  onSave,
  className,
}: {
  answerId: string;
  initialText: string;
  placeholder?: string;
  disabled?: boolean;
  onSave: (text: string) => Promise<boolean>;
  className?: string;
}) {
  const [text, setText] = useState(initialText);
  const [lastSaved, setLastSaved] = useState(initialText);
  useEffect(() => {
    setText(initialText);
    setLastSaved(initialText);
  }, [answerId]);

  const autosave = useDebouncedAutosave({
    key: answerId,
    value: text,
    lastSavedValue: lastSaved,
    enabled: !disabled,
    save: async (value) => {
      const ok = await onSave(value);
      if (ok) setLastSaved(value);
      return ok;
    },
  });

  return (
    <div className="space-y-1">
      <textarea
        rows={Math.min(10, Math.max(3, Math.ceil(text.length / 90)))}
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => autosave.flush()}
        data-testid={`autosave-editor-${answerId}`}
        className={
          className ||
          'w-full p-2.5 border border-stone-200 hover:border-amber-300 focus:border-amber-600 rounded-lg text-xs sm:text-sm text-stone-800 leading-relaxed focus:outline-none focus:ring-2 focus:ring-amber-200 disabled:bg-stone-50'
        }
      />
      <div className="flex justify-end">
        <AutosaveStatusLabel state={autosave.state} savedAt={autosave.savedAt} />
      </div>
    </div>
  );
}
