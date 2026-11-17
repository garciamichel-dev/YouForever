import React from 'react';
import { Loader2, Sparkles, CheckCircle2, FileText, Database } from 'lucide-react';

export interface AdminProgressState {
  open?: boolean;
  isOpen?: boolean;
  mode?: 'generation' | 'loading';
  kind?: 'generacion' | 'carga';
  title: string;
  subtitle?: string;
  stage: string;
  percent: number;
  detail?: string;
}

export const INITIAL_ADMIN_PROGRESS: AdminProgressState = {
  open: false,
  isOpen: false,
  mode: 'loading',
  kind: 'carga',
  title: '',
  subtitle: '',
  stage: '',
  percent: 0,
};

interface AdminProgressModalProps {
  progress?: AdminProgressState;
  state?: AdminProgressState;
}

export const AdminProgressModal: React.FC<AdminProgressModalProps> = ({ progress, state }) => {
  const active = progress || state;
  if (!active || (!active.open && !active.isOpen)) return null;

  const clampedPercent = Math.max(0, Math.min(100, Math.round(active.percent)));
  const isComplete = clampedPercent >= 100;
  const isGeneration = active.mode === 'generation' || active.kind === 'generacion';
  const detailText = active.detail || active.subtitle;

  return (
    <div
      className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-[90] flex items-center justify-center p-4 animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-label={active.title || (isGeneration ? 'Generando documento' : 'Cargando información')}
      data-testid="admin-progress-modal"
    >
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-stone-200">
        <div className="flex items-start gap-4 mb-5">
          <div
            className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
              isComplete
                ? 'bg-emerald-100 text-emerald-700'
                : isGeneration
                ? 'bg-amber-100 text-amber-800'
                : 'bg-stone-100 text-stone-800'
            }`}
          >
            {isComplete ? (
              <CheckCircle2 className="w-6 h-6 text-emerald-600" />
            ) : isGeneration ? (
              <Sparkles className="w-6 h-6 animate-pulse" />
            ) : (
              <Loader2 className="w-6 h-6 animate-spin" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${
                  isGeneration
                    ? 'bg-amber-50 text-amber-800 border border-amber-200'
                    : 'bg-stone-100 text-stone-700 border border-stone-200'
                }`}
              >
                {isGeneration ? 'Generación en curso' : 'Carga en curso'}
              </span>
            </div>
            <h3 className="text-lg font-serif text-stone-900 font-medium leading-snug truncate">
              {active.title}
            </h3>
            <p
              className="text-xs text-stone-600 mt-1 leading-relaxed"
              data-testid="admin-progress-stage"
            >
              {active.stage}
            </p>
            {detailText && (
              <p className="text-[11px] text-stone-400 mt-1 truncate">{detailText}</p>
            )}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-stone-500 font-medium flex items-center gap-1.5">
              {isGeneration ? (
                <FileText className="w-3.5 h-3.5 text-amber-700" />
              ) : (
                <Database className="w-3.5 h-3.5 text-stone-600" />
              )}
              {isComplete ? 'Proceso finalizado' : 'Avance del proceso'}
            </span>
            <span
              className="font-mono tabular-nums font-bold text-stone-900 text-sm"
              data-testid="admin-progress-percent"
            >
              {clampedPercent}%
            </span>
          </div>

          <div className="w-full h-3 bg-stone-100 rounded-full overflow-hidden border border-stone-200/80 p-0.5">
            <div
              className={`h-full rounded-full transition-all duration-300 ease-out ${
                isComplete
                  ? 'bg-emerald-600'
                  : isGeneration
                  ? 'bg-gradient-to-r from-amber-700 via-amber-600 to-amber-500'
                  : 'bg-gradient-to-r from-stone-800 via-stone-700 to-stone-600'
              }`}
              style={{ width: `${clampedPercent}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export type AdminProgressUpdateFn = (percent: number, stage?: string, detail?: string) => void;

export interface ExecuteAdminProgressSingleArg<T> {
  setProgress: React.Dispatch<React.SetStateAction<AdminProgressState>>;
  mode: 'generation' | 'loading';
  title: string;
  stages: Array<{ atPercent: number; label: string }>;
  detail?: string;
  intervalMs?: number;
  task: (updateStage: AdminProgressUpdateFn) => Promise<T>;
}

export interface ExecuteAdminProgressOptions {
  kind: 'generacion' | 'carga';
  title: string;
  subtitle?: string;
  initialStage?: string;
  intervalMs?: number;
}

/**
 * Helper to execute an async task while smoothly updating an AdminProgressState
 * with staged descriptions and percentage progress, then automatically closing on completion.
 * Supports both single-object parameter and (setProgress, options, task) signature.
 */
export async function executeWithAdminProgress<T>(
  arg1:
    | ExecuteAdminProgressSingleArg<T>
    | React.Dispatch<React.SetStateAction<AdminProgressState>>,
  arg2?: ExecuteAdminProgressOptions,
  arg3?: (update: AdminProgressUpdateFn) => Promise<T>
): Promise<T> {
  let setProgress: React.Dispatch<React.SetStateAction<AdminProgressState>>;
  let mode: 'generation' | 'loading';
  let kind: 'generacion' | 'carga';
  let title: string;
  let stages: Array<{ atPercent: number; label: string }>;
  let detail: string | undefined;
  let intervalMs = 320;
  let task: (updateStage: AdminProgressUpdateFn) => Promise<T>;

  if (typeof arg1 === 'function') {
    setProgress = arg1;
    const opts = arg2!;
    kind = opts.kind;
    mode = opts.kind === 'generacion' ? 'generation' : 'loading';
    title = opts.title;
    detail = opts.subtitle;
    intervalMs = opts.intervalMs ?? 320;
    const initLabel =
      opts.initialStage ||
      (mode === 'generation' ? 'Iniciando generación...' : 'Cargando información...');
    stages = [{ atPercent: 10, label: initLabel }];
    task = arg3!;
  } else {
    setProgress = arg1.setProgress;
    mode = arg1.mode;
    kind = arg1.mode === 'generation' ? 'generacion' : 'carga';
    title = arg1.title;
    stages = arg1.stages;
    detail = arg1.detail;
    intervalMs = arg1.intervalMs ?? 350;
    task = arg1.task;
  }

  const firstStage =
    stages[0]?.label || (mode === 'generation' ? 'Iniciando generación...' : 'Cargando datos...');
  const initialPercent = stages[0]?.atPercent ?? 10;

  let currentPercent = initialPercent;
  let manualOverride = false;

  setProgress({
    open: true,
    isOpen: true,
    mode,
    kind,
    title,
    subtitle: detail,
    stage: firstStage,
    percent: currentPercent,
    detail,
  });

  const resolveStageLabel = (pct: number): string => {
    let active = firstStage;
    for (const s of stages) {
      if (pct >= s.atPercent) {
        active = s.label;
      }
    }
    return active;
  };

  const timer = setInterval(() => {
    if (manualOverride) return;
    currentPercent = Math.min(
      92,
      currentPercent + (currentPercent < 50 ? 9 : currentPercent < 75 ? 5 : 2)
    );
    const stageLabel = resolveStageLabel(currentPercent);
    setProgress((prev) =>
      prev.open || prev.isOpen
        ? {
            ...prev,
            percent: Math.max(prev.percent, currentPercent),
            stage: prev.stage || stageLabel,
          }
        : prev
    );
  }, intervalMs);

  const updateStage: AdminProgressUpdateFn = (percent: number, stage?: string, customDetail?: string) => {
    manualOverride = true;
    currentPercent = Math.max(0, Math.min(99, Math.round(percent)));
    setProgress((prev) => ({
      ...prev,
      open: true,
      isOpen: true,
      percent: currentPercent,
      stage: stage !== undefined ? stage : prev.stage,
      detail: customDetail !== undefined ? customDetail : prev.detail,
      subtitle: customDetail !== undefined ? customDetail : prev.subtitle,
    }));
  };

  try {
    const result = await task(updateStage);
    clearInterval(timer);
    setProgress((prev) => ({
      ...prev,
      open: true,
      isOpen: true,
      percent: 100,
      stage:
        mode === 'generation'
          ? 'Documento generado exitosamente (100%)'
          : 'Información cargada exitosamente (100%)',
    }));
    await new Promise((r) => setTimeout(r, 260));
    setProgress(INITIAL_ADMIN_PROGRESS);
    return result;
  } catch (err) {
    clearInterval(timer);
    setProgress(INITIAL_ADMIN_PROGRESS);
    throw err;
  }
}
