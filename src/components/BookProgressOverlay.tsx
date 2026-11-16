import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Circle, Loader2, RefreshCw } from 'lucide-react';

/**
 * V5.3.5 — Floating alert for EVERY book creation step (5-page sample, full book, PDF).
 *
 * - It cannot be dismissed while the book is being created: no close button, no click outside,
 *   no Escape. The only way out is «Cancelar», which stops the editorial process.
 * - It shows, step by step, what is being done and the percentage of progress.
 * - When creation finishes it shows the completion message and an enabled «Aceptar» button.
 * - Participant wording only: it never mentions errors, models, providers or internal reviews.
 */

export type BookProgressKind = 'preview' | 'full' | 'pdf';
export type BookProgressStage = 'job' | 'compose' | 'save' | 'pdf';
export type BookProgressStatus = 'running' | 'done' | 'paused';

export interface BookProgressJobSnapshot {
  phase?: string;
  completedBatches?: number;
  totalBatches?: number;
}

export interface BookProgressState {
  kind: BookProgressKind;
  stage: BookProgressStage;
  status: BookProgressStatus;
  /** Whether «Cancelar» can stop the process at this moment. */
  cancellable: boolean;
  doneTitle?: string;
  doneMessage?: string;
  pausedMessage?: string;
}

interface StepDef {
  key: string;
  label: string;
  /** Percentage range [start, end] covered by this step. */
  range: [number, number];
}

export const BOOK_PROGRESS_STEPS: Record<BookProgressKind, StepDef[]> = {
  preview: [
    { key: 'prepare', label: 'Reuniendo tus recuerdos y fotografías', range: [0, 15] },
    { key: 'draft', label: 'Escribiendo con el estilo que elegiste', range: [15, 80] },
    { key: 'review', label: 'Cuidando cada detalle de tu historia', range: [80, 92] },
    { key: 'compose', label: 'Dando forma a tus primeras páginas', range: [92, 100] },
  ],
  full: [
    { key: 'prepare', label: 'Organizando tus recuerdos', range: [0, 8] },
    { key: 'draft', label: 'Escribiendo los capítulos de tu libro', range: [8, 60] },
    { key: 'review', label: 'Verificando que todo sea fiel a tus recuerdos', range: [60, 82] },
    { key: 'save', label: 'Guardando tu libro en tu portal', range: [82, 90] },
    { key: 'pdf', label: 'Creando el PDF de tu libro', range: [90, 100] },
  ],
  pdf: [
    { key: 'photos', label: 'Preparando tus fotografías', range: [0, 35] },
    { key: 'compose', label: 'Componiendo las páginas', range: [35, 70] },
    { key: 'pdf', label: 'Creando tu PDF', range: [70, 100] },
  ],
};

const REVIEW_PHASES = new Set(['auditing_semantics', 'repairing_chapters', 'finalizing', 'paused']);

/**
 * Pure mapping from the process state to the active step and the progress percentage (the
 * percentage at the START of the active step, plus the fraction of chapters already written).
 */
export function computeBookProgress(
  state: Pick<BookProgressState, 'kind' | 'stage' | 'status'>,
  job?: BookProgressJobSnapshot | null
): { stepIdx: number; percent: number; stepEnd: number } {
  const steps = BOOK_PROGRESS_STEPS[state.kind];
  if (state.status === 'done') return { stepIdx: steps.length, percent: 100, stepEnd: 100 };
  const idxOf = (key: string) => Math.max(0, steps.findIndex((s) => s.key === key));
  let stepIdx = 0;
  let fraction = 0;
  if (state.stage === 'job') {
    const phase = job?.phase || 'preparing_sources';
    if (phase === 'drafting_batches') {
      stepIdx = idxOf('draft');
      const total = Number(job?.totalBatches) || 0;
      fraction = total > 0 ? Math.min(1, Math.max(0, (Number(job?.completedBatches) || 0) / total)) : 0;
    } else if (REVIEW_PHASES.has(phase)) {
      stepIdx = idxOf('review');
    } else {
      stepIdx = idxOf(state.kind === 'pdf' ? 'photos' : 'prepare');
    }
  } else if (state.stage === 'compose') {
    stepIdx = idxOf('compose');
  } else if (state.stage === 'save') {
    stepIdx = idxOf('save');
  } else if (state.stage === 'pdf') {
    stepIdx = idxOf('pdf');
  }
  const [start, end] = steps[stepIdx].range;
  return { stepIdx, percent: Math.round(start + (end - start) * fraction), stepEnd: end };
}

export function BookProgressOverlay({
  state,
  job,
  onCancel,
  onAccept,
  onContinue,
}: {
  state: BookProgressState | null;
  job?: BookProgressJobSnapshot | null;
  onCancel: () => void;
  onAccept: () => void;
  onContinue?: () => void;
}) {
  const computed = state ? computeBookProgress(state, job) : null;
  const [displayPercent, setDisplayPercent] = useState(() => computed?.percent ?? 0);
  const stateKeyRef = useRef<string>('');

  // Restart the counter for each new process.
  const processKey = state ? `${state.kind}` : '';
  useEffect(() => {
    if (processKey !== stateKeyRef.current) {
      stateKeyRef.current = processKey;
      setDisplayPercent(0);
    }
  }, [processKey]);

  // The percentage never goes back, and moves slowly inside the active step while it works.
  useEffect(() => {
    if (!computed) return;
    setDisplayPercent((prev) => Math.max(prev, computed.percent));
    if (state?.status !== 'running') return;
    const cap = Math.max(computed.percent, computed.stepEnd - 1);
    const timer = setInterval(() => {
      setDisplayPercent((prev) => (prev < cap ? Math.min(cap, prev + 0.5) : prev));
    }, 700);
    return () => clearInterval(timer);
  }, [computed?.percent, computed?.stepEnd, state?.status]);

  // Block Escape while the alert is open (it can only be closed with Cancelar or Aceptar).
  useEffect(() => {
    if (!state) return;
    const block = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', block, true);
    return () => window.removeEventListener('keydown', block, true);
  }, [Boolean(state)]);

  if (!state || !computed) return null;
  const steps = BOOK_PROGRESS_STEPS[state.kind];
  const percent = state.status === 'done' ? 100 : Math.floor(displayPercent);
  const heading =
    state.status === 'done'
      ? state.doneTitle || '¡Listo!'
      : state.status === 'paused'
        ? 'Tu libro sigue en preparación'
        : state.kind === 'preview'
          ? 'Creando tu muestra editorial'
          : state.kind === 'full'
            ? 'Creando tu libro'
            : 'Creando tu PDF';

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-stone-950/60 backdrop-blur-sm p-4 print:hidden"
      data-testid="book-progress-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="book-progress-title"
    >
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-stone-900 border border-amber-200 dark:border-stone-700 shadow-2xl p-6 space-y-5 text-stone-900 dark:text-stone-100">
        <div className="flex items-start gap-3">
          {state.status === 'done' ? (
            <CheckCircle2 className="w-7 h-7 text-emerald-600 shrink-0" />
          ) : (
            <Loader2 className={`w-7 h-7 text-amber-700 shrink-0 ${state.status === 'running' ? 'animate-spin' : ''}`} />
          )}
          <div className="space-y-1">
            <h2 id="book-progress-title" className="font-serif text-lg font-bold">
              {heading}
            </h2>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              {state.status === 'done'
                ? state.doneMessage || 'El proceso terminó correctamente.'
                : state.status === 'paused'
                  ? state.pausedMessage ||
                    'Pulsa «Continuar preparando» y seguiremos desde donde avanzamos.'
                  : 'Por favor no cierres esta ventana. Puedes cancelar en cualquier momento.'}
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span>Avance</span>
            <span data-testid="book-progress-percent">{percent}%</span>
          </div>
          <div className="w-full h-2.5 rounded-full bg-amber-100 dark:bg-stone-800 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                state.status === 'done' ? 'bg-emerald-600' : 'bg-amber-700'
              }`}
              style={{ width: `${Math.max(2, percent)}%` }}
            />
          </div>
        </div>

        <ol className="space-y-2" data-testid="book-progress-steps">
          {steps.map((step, idx) => {
            const isDone = state.status === 'done' || idx < computed.stepIdx;
            const isActive = state.status !== 'done' && idx === computed.stepIdx;
            return (
              <li
                key={step.key}
                data-step-state={isDone ? 'done' : isActive ? 'active' : 'pending'}
                className={`flex items-center gap-2.5 text-sm ${
                  isDone
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : isActive
                      ? 'font-semibold text-amber-900 dark:text-amber-300'
                      : 'text-stone-400'
                }`}
              >
                {isDone ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : isActive && state.status === 'running' ? (
                  <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                ) : (
                  <Circle className="w-4 h-4 shrink-0" />
                )}
                <span>
                  Paso {idx + 1} de {steps.length}: {step.label}
                </span>
              </li>
            );
          })}
        </ol>

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          {state.status !== 'done' && (
            <button
              type="button"
              onClick={onCancel}
              disabled={!state.cancellable}
              title={state.cancellable ? undefined : 'Estamos guardando tu libro; espera unos segundos.'}
              className="px-4 py-2 rounded-xl border border-stone-300 dark:border-stone-600 text-sm font-semibold hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              data-testid="book-progress-cancel"
            >
              Cancelar
            </button>
          )}
          {state.status === 'paused' && onContinue && (
            <button
              type="button"
              onClick={onContinue}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-800 hover:bg-amber-900 text-white text-sm font-semibold cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              Continuar preparando
            </button>
          )}
          <button
            type="button"
            onClick={onAccept}
            disabled={state.status !== 'done'}
            className="px-5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold disabled:bg-stone-300 disabled:text-stone-500 dark:disabled:bg-stone-700 disabled:cursor-not-allowed cursor-pointer"
            data-testid="book-progress-accept"
          >
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
}
