import React, { useState, useEffect, useRef } from 'react';
import {
  HelpCircle,
  Plus,
  Upload,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Edit2,
  ToggleLeft,
  ToggleRight,
  FileSpreadsheet,
  Check,
  X,
  GitBranch,
  CornerDownRight,
  Trash2,
  FileText,
} from 'lucide-react';
import { QuestionRecord, BranchConfig } from '../logic/interviewRules.ts';
import { apiFetch } from '../utils/apiClient.ts';
import {
  AdminProgressModal,
  AdminProgressState,
  INITIAL_ADMIN_PROGRESS,
  executeWithAdminProgress,
} from './AdminProgressModal.tsx';


interface QuestionBankPanelProps {
  adminEmail: string | null;
}

export const QuestionBankPanel: React.FC<QuestionBankPanelProps> = ({ adminEmail }) => {
  const [questions, setQuestions] = useState<QuestionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [adminProgress, setAdminProgress] = useState<AdminProgressState>(INITIAL_ADMIN_PROGRESS);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('todas');
  const [modeFilter, setModeFilter] = useState<string>('todas');
  const [flowFilter, setFlowFilter] = useState<string>('todos');

  // Modal create/edit
  const [showModal, setShowModal] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Partial<QuestionRecord> | null>(null);
  const [customFlowIdInput, setCustomFlowIdInput] = useState<string>('');
  const [keywordsInput, setKeywordsInput] = useState<string>('');

  // Import Modal & Preview
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importTab, setImportTab] = useState<'file' | 'paste'>('file');
  const [pastedCsvText, setPastedCsvText] = useState<string>('');
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [importPreview, setImportPreview] = useState<{
    totalRows: number;
    validRowsCount: number;
    invalidRowsCount: number;
    previewRows: Array<{
      rowIndex: number;
      id: string;
      text: string;
      lifeStage: string;
      topic: string;
      priority: string;
      allowedStoryModes: string;
      requirementType: string;
      flowId?: string;
      orderIndex?: number;
      branchConfig?: BranchConfig | null;
      isValid: boolean;
      errors: string[];
    }>;
    canCommit: boolean;
  } | null>(null);
  const [importingFileBase64, setImportingFileBase64] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  // Selection & Deletion State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteSingleTarget, setDeleteSingleTarget] = useState<QuestionRecord | null>(null);
  const [showDeleteSelectedModal, setShowDeleteSelectedModal] = useState(false);
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [deleteAllConfirmText, setDeleteAllConfirmText] = useState('');
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchQuestions = async () => {
    try {
      setLoading(true);
      await executeWithAdminProgress(
        setAdminProgress,
        {
          kind: 'carga',
          title: 'Cargando Banco de Preguntas',
          subtitle: 'Hilo principal, sub-flujos y reglas de ramificación',
          initialStage: 'Consultando preguntas registradas en la base de datos...',
        },
        async (update) => {
          const res = await apiFetch<QuestionRecord[]>('/api/questions', { retries: 2 });
          update(85, 'Organizando flujos y etapas vitales...');
          if (res.ok && res.data) {
            setQuestions(res.data);
          } else if (res.error) {
            console.warn('Notice fetching questions:', res.error);
          }
        }
      );
    } catch (err: unknown) {
      console.error('Error fetching questions:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuestions();
  }, []);

  // Discover all distinct flowIds in the question bank
  const availableFlows = Array.from(
    new Set(['principal', 'hijos', ...questions.map((q) => (q.flowId || 'principal').toLowerCase())])
  );

  // Filtered list
  const filteredQuestions = questions.filter((q) => {
    const qFlow = (q.flowId || 'principal').toLowerCase();
    const matchesSearch =
      q.text.toLowerCase().includes(search.toLowerCase()) ||
      q.topic.toLowerCase().includes(search.toLowerCase()) ||
      q.id.toLowerCase().includes(search.toLowerCase()) ||
      qFlow.includes(search.toLowerCase());

    const matchesStage = stageFilter === 'todas' || q.lifeStage === stageFilter;
    const matchesMode =
      modeFilter === 'todas' || q.allowedStoryModes === modeFilter || q.allowedStoryModes === 'ambas';
    const matchesFlow = flowFilter === 'todos' || qFlow === flowFilter;

    return matchesSearch && matchesStage && matchesMode && matchesFlow;
  });

  // Toggle active status
  const handleToggleActive = async (question: QuestionRecord) => {
    try {
      const updated = { ...question, active: !question.active };
      const res = await fetch('/api/questions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
        body: JSON.stringify(updated),
      });
      const data = await res.json();
      if (data.success) {
        setQuestions((prev) => prev.map((q) => (q.id === question.id ? data.data : q)));
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Selection handlers
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const visibleIds = filteredQuestions.map((q) => q.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.add(id));
        return next;
      });
    }
  };

  // Delete Single Question
  const handleDeleteSingle = async (question: QuestionRecord) => {
    try {
      setIsDeleting(true);
      const res = await fetch(`/api/questions/${encodeURIComponent(question.id)}`, {
        method: 'DELETE',
        headers: {
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
      });
      const data = await res.json();
      if (data.success) {
        setQuestions((prev) => prev.filter((q) => q.id !== question.id));
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(question.id);
          return next;
        });
        setDeleteNotice(`La pregunta "${question.id}" fue eliminada de la base de datos.`);
        setTimeout(() => setDeleteNotice(null), 3500);
      } else {
        setDeleteNotice(data.error || 'Error al eliminar la pregunta.');
      }
    } catch (err: unknown) {
      setDeleteNotice('Error de red al eliminar la pregunta.');
    } finally {
      setIsDeleting(false);
      setDeleteSingleTarget(null);
    }
  };

  // Batch Delete Selected Questions
  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    try {
      setIsDeleting(true);
      const idsToDelete = Array.from(selectedIds);
      const res = await fetch('/api/questions/batch-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
        body: JSON.stringify({ questionIds: idsToDelete }),
      });
      const data = await res.json();
      if (data.success) {
        const setDeleted = new Set(idsToDelete);
        setQuestions((prev) => prev.filter((q) => !setDeleted.has(q.id)));
        setSelectedIds(new Set());
        setShowDeleteSelectedModal(false);
        setDeleteNotice(
          `${data.data?.count || idsToDelete.length} preguntas seleccionadas fueron eliminadas de la base de datos.`
        );
        setTimeout(() => setDeleteNotice(null), 4000);
      } else {
        setDeleteNotice(data.error || 'Error al eliminar las preguntas seleccionadas.');
      }
    } catch (err) {
      setDeleteNotice('Error de red al eliminar las preguntas.');
    } finally {
      setIsDeleting(false);
    }
  };

  // Delete All Questions
  const handleDeleteAll = async () => {
    try {
      setIsDeleting(true);
      const res = await fetch('/api/questions/delete-all', {
        method: 'POST',
        headers: {
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
      });
      const data = await res.json();
      if (data.success) {
        setQuestions([]);
        setSelectedIds(new Set());
        setShowDeleteAllModal(false);
        setDeleteAllConfirmText('');
        setDeleteNotice('Se han eliminado todas las preguntas del Banco de Preguntas en la base de datos.');
        setTimeout(() => setDeleteNotice(null), 4000);
      } else {
        setDeleteNotice(data.error || 'Error al eliminar todas las preguntas.');
      }
    } catch (err) {
      setDeleteNotice('Error de red al eliminar todas las preguntas.');
    } finally {
      setIsDeleting(false);
    }
  };

  const openEditModal = (q: Partial<QuestionRecord>) => {
    const flowId = q.flowId || 'principal';
    setEditingQuestion({
      ...q,
      flowId,
      branchConfig: q.branchConfig
        ? { ...q.branchConfig }
        : {
            enabled: false,
            targetFlowId: 'hijos',
            triggerRule: 'affirmative',
            branchLabel: '',
          },
    });
    setCustomFlowIdInput('');
    setKeywordsInput((q.branchConfig?.keywords || []).join(', '));
    setShowModal(true);
  };

  // Save (Create or Edit)
  const handleSaveQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingQuestion || !editingQuestion.text) return;

    try {
      const resolvedFlowId =
        editingQuestion.flowId === '__custom__'
          ? customFlowIdInput.trim().toLowerCase().replace(/\s+/g, '_') || 'principal'
          : (editingQuestion.flowId || 'principal').trim().toLowerCase();

      let branchConfig: BranchConfig | null = null;
      if (editingQuestion.branchConfig?.enabled && editingQuestion.branchConfig.targetFlowId) {
        const kws = keywordsInput
          .split(',')
          .map((k) => k.trim())
          .filter((k) => k.length > 0);
        branchConfig = {
          enabled: true,
          targetFlowId: editingQuestion.branchConfig.targetFlowId.trim().toLowerCase(),
          triggerRule: editingQuestion.branchConfig.triggerRule || 'affirmative',
          keywords: kws.length > 0 ? kws : undefined,
          branchLabel:
            editingQuestion.branchConfig.branchLabel?.trim() ||
            `Flujo ${editingQuestion.branchConfig.targetFlowId}`,
        };
      }

      const payload: QuestionRecord = {
        id: editingQuestion.id || `q_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        text: editingQuestion.text.trim(),
        lifeStage: (editingQuestion.lifeStage as any) || 'infancia',
        topic: editingQuestion.topic?.trim() || 'general',
        priority: (editingQuestion.priority as any) || 'media',
        allowedStoryModes: (editingQuestion.allowedStoryModes as any) || 'ambas',
        requirementType: (editingQuestion.requirementType as any) || 'mandatory',
        active: editingQuestion.active !== undefined ? editingQuestion.active : true,
        version: editingQuestion.version || 1,
        createdAt: editingQuestion.createdAt || new Date().toISOString(),
        flowId: resolvedFlowId,
        orderIndex:
          editingQuestion.orderIndex !== undefined ? Number(editingQuestion.orderIndex) : undefined,
        branchConfig,
      };

      const res = await fetch('/api/questions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.success) {
        setShowModal(false);
        setEditingQuestion(null);
        fetchQuestions();
      }
    } catch (err) {
      console.error('Error saving question:', err);
    }
  };

  // Process File for CSV / Excel
  const processFile = (file: File) => {
    setImportError(null);
    setImportSuccess(null);
    setImportPreview(null);
    setSelectedFileName(`${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
    setIsAnalyzing(true);

    const reader = new FileReader();
    reader.onerror = () => {
      setIsAnalyzing(false);
      setImportError('No se pudo leer el archivo seleccionado en el navegador.');
    };
    reader.onload = async (evt) => {
      try {
        await executeWithAdminProgress(
          setAdminProgress,
          {
            kind: 'carga',
            title: 'Analizando Archivo de Preguntas',
            subtitle: file.name,
            initialStage: 'Codificando y enviando archivo al servidor para validación...',
          },
          async (update) => {
            const rawResult = evt.target?.result as string;
            const base64 = rawResult.includes(',') ? rawResult.split(',')[1] : rawResult;
            setImportingFileBase64(base64);

            const res = await fetch('/api/questions/import', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
              },
              body: JSON.stringify({ fileBase64: base64, commit: false }),
            });

            update(85, 'Validando estructura de columnas y flujos...');
            const data = await res.json();
            if (data.success && data.data) {
              setImportPreview(data.data);
              if (data.data.invalidRowsCount > 0) {
                setImportError(
                  `Se analizaron ${data.data.totalRows} filas: ${data.data.validRowsCount} válidas y ${data.data.invalidRowsCount} con avisos.`
                );
              }
            } else {
              setImportError(data.error || 'No se pudo analizar el archivo. Verifica el formato de las columnas.');
            }
          }
        );
      } catch (err: unknown) {
        setImportError('Error de red al comunicarse con el servidor.');
      } finally {
        setIsAnalyzing(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
    // Reset file input value so user can re-select the same file
    if (e.target) {
      e.target.value = '';
    }
  };

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  // Analyze Pasted CSV Text
  const handleAnalyzePastedText = async () => {
    if (!pastedCsvText.trim()) {
      setImportError('Por favor pega el contenido CSV antes de analizar.');
      return;
    }
    setImportError(null);
    setImportSuccess(null);
    setImportPreview(null);
    setIsAnalyzing(true);

    try {
      await executeWithAdminProgress(
        setAdminProgress,
        {
          kind: 'carga',
          title: 'Analizando Contenido CSV',
          subtitle: 'Validación de preguntas y ramificaciones',
          initialStage: 'Procesando filas CSV en el servidor...',
        },
        async (update) => {
          const res = await fetch('/api/questions/import', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
            },
            body: JSON.stringify({ csvText: pastedCsvText, commit: false }),
          });

          update(85, 'Generando vista previa de importación...');
          const data = await res.json();
          if (data.success && data.data) {
            setImportPreview(data.data);
            if (data.data.invalidRowsCount > 0) {
              setImportError(
                `Se analizaron ${data.data.totalRows} filas: ${data.data.validRowsCount} válidas y ${data.data.invalidRowsCount} con avisos.`
              );
            }
          } else {
            setImportError(data.error || 'No se pudo analizar el texto CSV pegado.');
          }
        }
      );
    } catch (err) {
      setImportError('Error de red al analizar el texto CSV.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Confirm Import & Save to Firestore
  const handleConfirmImport = async () => {
    if ((!importingFileBase64 && !pastedCsvText) || !importPreview?.canCommit) return;

    try {
      setIsCommitting(true);
      await executeWithAdminProgress(
        setAdminProgress,
        {
          kind: 'carga',
          title: 'Importando Preguntas a la Base de Datos',
          subtitle: `${importPreview.validRowsCount} preguntas válidas`,
          initialStage: 'Guardando lote de preguntas en el servidor y Firestore...',
        },
        async (update) => {
          const res = await fetch('/api/questions/import', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-admin-user': adminEmail || 'garcia.michel@gmail.com',
            },
            body: JSON.stringify({
              fileBase64: importingFileBase64 || undefined,
              csvText: !importingFileBase64 ? pastedCsvText : undefined,
              commit: true,
            }),
          });

          update(90, 'Actualizando catálogo del Banco de Preguntas...');
          const data = await res.json();
          if (data.success) {
            setImportSuccess(data.message);
            setShowImportModal(false);
            setImportPreview(null);
            setImportingFileBase64(null);
            setPastedCsvText('');
            setSelectedFileName(null);
            await fetchQuestions();
          } else {
            setImportError(data.error || 'Error al guardar las preguntas importadas en la base de datos.');
          }
        }
      );
    } catch (err) {
      setImportError('Error de red al confirmar importación.');
    } finally {
      setIsCommitting(false);
    }
  };

  const mainThreadCount = questions.filter((q) => (q.flowId || 'principal') === 'principal').length;
  const subFlowCount = questions.filter((q) => (q.flowId || 'principal') !== 'principal').length;
  const branchGatewaysCount = questions.filter((q) => q.branchConfig?.enabled).length;

  return (
    <div className="space-y-6">
      <AdminProgressModal state={adminProgress} />
      {/* Header with actions */}
      <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold font-serif text-stone-900 flex items-center space-x-2">
            <HelpCircle className="w-5 h-5 text-amber-700" />
            <span>Banco de Preguntas &amp; Flujos Ramificados</span>
          </h2>
          <p className="text-sm text-stone-500">
            Configura las preguntas del hilo principal, sub-flujos condicionales (ej. hijos) y reglas de retorno automático.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {selectedIds.size > 0 && (
            <button
              onClick={() => setShowDeleteSelectedModal(true)}
              className="inline-flex items-center space-x-1.5 px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 rounded-lg text-xs font-semibold transition shadow-xs"
              title="Eliminar preguntas seleccionadas"
            >
              <Trash2 className="w-4 h-4 text-rose-600" />
              <span>Eliminar seleccionadas ({selectedIds.size})</span>
            </button>
          )}

          {questions.length > 0 && (
            <button
              onClick={() => {
                setDeleteAllConfirmText('');
                setShowDeleteAllModal(true);
              }}
              className="inline-flex items-center space-x-1.5 px-3.5 py-2 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 rounded-lg text-xs font-semibold transition"
              title="Eliminar todas las preguntas de la base de datos"
            >
              <Trash2 className="w-4 h-4 text-rose-600" />
              <span>Eliminar todas</span>
            </button>
          )}

          <button
            onClick={() => {
              setImportPreview(null);
              setImportError(null);
              setImportSuccess(null);
              setShowImportModal(true);
            }}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-300 rounded-lg text-xs font-semibold transition"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
            <span>Importar CSV / Excel</span>
          </button>

          <button
            onClick={() =>
              openEditModal({
                id: `q_${Date.now()}`,
                text: '',
                lifeStage: 'adultez',
                topic: 'hijos_y_crianza',
                priority: 'alta',
                allowedStoryModes: 'ambas',
                requirementType: 'mandatory',
                active: true,
                version: 1,
                flowId: flowFilter !== 'todos' ? flowFilter : 'principal',
              })
            }
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 bg-amber-700 hover:bg-amber-800 text-white rounded-lg text-xs font-semibold shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            <span>Nueva Pregunta</span>
          </button>
        </div>
      </div>

      {deleteNotice && (
        <div className="p-3 bg-stone-900 text-white rounded-xl text-xs flex items-center justify-between shadow-md">
          <span className="font-medium">{deleteNotice}</span>
          <button
            onClick={() => setDeleteNotice(null)}
            className="text-stone-400 hover:text-white ml-2 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Flow Architecture Summary Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <button
          type="button"
          onClick={() => setFlowFilter(flowFilter === 'principal' ? 'todos' : 'principal')}
          className={`p-4 rounded-xl border text-left transition ${
            flowFilter === 'principal'
              ? 'bg-amber-50 border-amber-400 shadow-xs'
              : 'bg-white border-stone-200 hover:border-amber-200'
          }`}
        >
          <div className="text-xs font-bold text-stone-600 uppercase tracking-wide">
            Hilo Principal (principal)
          </div>
          <div className="text-lg font-serif font-bold text-stone-900 mt-0.5">
            {mainThreadCount} preguntas base
          </div>
          <div className="text-[11px] text-stone-500 mt-0.5">
            Tronco narrativo general al que retornan todos los sub-flujos.
          </div>
        </button>

        <button
          type="button"
          onClick={() => setFlowFilter(flowFilter === 'hijos' ? 'todos' : 'hijos')}
          className={`p-4 rounded-xl border text-left transition ${
            flowFilter === 'hijos'
              ? 'bg-emerald-50 border-emerald-400 shadow-xs'
              : 'bg-white border-stone-200 hover:border-emerald-200'
          }`}
        >
          <div className="text-xs font-bold text-emerald-800 uppercase tracking-wide flex items-center space-x-1">
            <GitBranch className="w-3.5 h-3.5" />
            <span>Sub-flujos Configurados</span>
          </div>
          <div className="text-lg font-serif font-bold text-stone-900 mt-0.5">
            {subFlowCount} preguntas en sub-flujos
          </div>
          <div className="text-[11px] text-stone-500 mt-0.5">
            Incluye el flujo «hijos» ({questions.filter((q) => q.flowId === 'hijos').length} preguntas) con retorno al hilo principal.
          </div>
        </button>

        <div className="p-4 rounded-xl border border-stone-200 bg-white">
          <div className="text-xs font-bold text-amber-800 uppercase tracking-wide flex items-center space-x-1">
            <CornerDownRight className="w-3.5 h-3.5" />
            <span>Saltos Condicionales Activos</span>
          </div>
          <div className="text-lg font-serif font-bold text-stone-900 mt-0.5">
            {branchGatewaysCount} {branchGatewaysCount === 1 ? 'pregunta puente' : 'preguntas puente'}
          </div>
          <div className="text-[11px] text-stone-500 mt-0.5">
            Si el entrevistado cumple la condición (ej. tiene hijos), salta al sub-flujo y luego retorna.
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm flex flex-col md:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 absolute left-3 top-3 text-stone-400" />
          <input
            type="text"
            placeholder="Buscar por texto, tema, flujo o ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-stone-300 rounded-lg text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-600"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <Filter className="w-4 h-4 text-stone-400 shrink-0" />
          <select
            aria-label="Filtrar por flujo"
            value={flowFilter}
            onChange={(e) => setFlowFilter(e.target.value)}
            className="border border-stone-300 rounded-lg px-2.5 py-2 text-xs text-stone-800 font-medium focus:outline-none focus:ring-2 focus:ring-amber-200"
          >
            <option value="todos">Todos los Flujos</option>
            {availableFlows.map((f) => (
              <option key={f} value={f}>
                {f === 'principal' ? 'Hilo Principal (principal)' : `Sub-flujo: ${f}`}
              </option>
            ))}
          </select>

          <select
            aria-label="Filtrar por etapa"
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="border border-stone-300 rounded-lg px-2.5 py-2 text-xs text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-200"
          >
            <option value="todas">Todas las Etapas</option>
            <option value="infancia">Infancia</option>
            <option value="juventud">Juventud</option>
            <option value="adultez">Adultez</option>
            <option value="madurez">Madurez</option>
            <option value="legado_general">Legado y Valores</option>
          </select>

          <select
            aria-label="Filtrar por modalidad"
            value={modeFilter}
            onChange={(e) => setModeFilter(e.target.value)}
            className="border border-stone-300 rounded-lg px-2.5 py-2 text-xs text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-200"
          >
            <option value="todas">Todas las Modalidades</option>
            <option value="individual">Individual</option>
            <option value="compartida">Compartida</option>
          </select>
        </div>
      </div>

      {/* Questions Table */}
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-stone-200 text-left text-xs">
            <thead className="bg-stone-50 text-stone-600 font-semibold uppercase tracking-wider">
              <tr>
                <th className="px-3 py-3 w-8">
                  <input
                    type="checkbox"
                    aria-label="Seleccionar todas las preguntas visibles"
                    checked={
                      filteredQuestions.length > 0 &&
                      filteredQuestions.every((q) => selectedIds.has(q.id))
                    }
                    onChange={toggleSelectAll}
                    className="w-4 h-4 text-amber-700 rounded border-stone-300 focus:ring-amber-500 cursor-pointer"
                  />
                </th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">ID / Etapa</th>
                <th className="px-4 py-3">Flujo &amp; Ramificación</th>
                <th className="px-4 py-3">Pregunta</th>
                <th className="px-4 py-3">Tema</th>
                <th className="px-4 py-3">Prioridad</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 bg-white">
              {filteredQuestions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-stone-500">
                    No se encontraron preguntas que coincidan con los filtros.
                  </td>
                </tr>
              ) : (
                filteredQuestions.map((q) => {
                  const qFlow = (q.flowId || 'principal').toLowerCase();
                  const isSubFlow = qFlow !== 'principal';
                  const isSelected = selectedIds.has(q.id);
                  return (
                    <tr
                      key={q.id}
                      className={`hover:bg-stone-50/80 ${isSelected ? 'bg-amber-50/40' : ''} ${!q.active ? 'opacity-60 bg-stone-50/50' : ''}`}
                    >
                      <td className="px-3 py-3 whitespace-nowrap">
                        <input
                          type="checkbox"
                          aria-label={`Seleccionar pregunta ${q.id}`}
                          checked={isSelected}
                          onChange={() => toggleSelect(q.id)}
                          className="w-4 h-4 text-amber-700 rounded border-stone-300 focus:ring-amber-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <button
                          onClick={() => handleToggleActive(q)}
                          title={q.active ? 'Desactivar pregunta' : 'Activar pregunta'}
                          className="text-stone-500 hover:text-amber-700 transition"
                        >
                          {q.active ? (
                            <ToggleRight className="w-6 h-6 text-emerald-600" />
                          ) : (
                            <ToggleLeft className="w-6 h-6 text-stone-400" />
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-mono text-[11px] text-stone-700 font-medium">{q.id}</div>
                        <span className="inline-block mt-0.5 px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200/60 rounded text-[10px] capitalize">
                          {q.lifeStage.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-1">
                          <span
                            className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-semibold ${
                              isSubFlow
                                ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                                : 'bg-stone-100 text-stone-800 border border-stone-200'
                            }`}
                          >
                            {isSubFlow && <GitBranch className="w-3 h-3 mr-1 text-emerald-700" />}
                            <span>
                              {isSubFlow ? `Sub-flujo: ${qFlow}` : 'Hilo Principal'}
                            </span>
                          </span>

                          {q.branchConfig?.enabled && q.branchConfig.targetFlowId && (
                            <div className="flex items-center space-x-1 text-[11px] text-amber-900 bg-amber-50 border border-amber-200 px-2 py-1 rounded-md font-medium">
                              <CornerDownRight className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                              <span>
                                Si aplica ➔ salta a <strong>«{q.branchConfig.targetFlowId}»</strong> y retorna al hilo principal
                              </span>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 max-w-md">
                        <p className="text-stone-900 font-medium leading-relaxed">{q.text}</p>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-stone-600">
                        <span className="bg-stone-100 px-2 py-0.5 rounded text-[11px]">
                          {q.topic.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                            q.priority === 'alta'
                              ? 'bg-rose-100 text-rose-800'
                              : q.priority === 'media'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-stone-100 text-stone-700'
                          }`}
                        >
                          {q.priority}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end space-x-1.5">
                          <button
                            onClick={() => openEditModal(q)}
                            className="inline-flex items-center space-x-1 px-2.5 py-1.5 text-stone-600 hover:text-amber-800 hover:bg-amber-50 border border-stone-200 rounded-lg transition text-xs font-medium"
                            title="Editar pregunta y configurar flujo"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                            <span>Configurar</span>
                          </button>
                          <button
                            onClick={() => setDeleteSingleTarget(q)}
                            className="inline-flex items-center p-1.5 text-stone-400 hover:text-rose-700 hover:bg-rose-50 border border-stone-200 hover:border-rose-200 rounded-lg transition"
                            title="Eliminar pregunta de la base de datos"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Create or Edit Question & Flow Configuration */}
      {showModal && editingQuestion && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-xl w-full p-6 shadow-xl border border-stone-200 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-stone-200 mb-4">
              <h3 className="font-serif text-lg font-bold text-stone-900">
                {questions.some((q) => q.id === editingQuestion.id)
                  ? 'Configurar Pregunta y Flujo en el Banco'
                  : 'Crear Nueva Pregunta y Configurar Flujo'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-stone-400 hover:text-stone-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveQuestion} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-stone-700 mb-1">
                  Texto de la pregunta *
                </label>
                <textarea
                  required
                  rows={3}
                  value={editingQuestion.text || ''}
                  onChange={(e) =>
                    setEditingQuestion({ ...editingQuestion, text: e.target.value })
                  }
                  placeholder="Formula una pregunta cálida y respetuosa..."
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-200"
                />
              </div>

              {/* Flow Membership Section */}
              <div className="p-3.5 bg-stone-50 rounded-xl border border-stone-200 space-y-3">
                <div className="flex items-center space-x-1.5 text-stone-800 font-bold">
                  <GitBranch className="w-4 h-4 text-amber-700" />
                  <span>1. Ubicación en el Flujo del Cuestionario</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block font-semibold text-stone-700 mb-1">
                      Hilo o Sub-flujo al que pertenece
                    </label>
                    <select
                      value={editingQuestion.flowId || 'principal'}
                      onChange={(e) =>
                        setEditingQuestion({ ...editingQuestion, flowId: e.target.value })
                      }
                      className="w-full px-2.5 py-2 border border-stone-300 rounded-lg text-xs text-stone-900 bg-white"
                    >
                      <option value="principal">Hilo Principal (principal)</option>
                      {availableFlows
                        .filter((f) => f !== 'principal')
                        .map((f) => (
                          <option key={f} value={f}>
                            Sub-flujo: {f} (retorna al hilo principal al terminar)
                          </option>
                        ))}
                      <option value="__custom__">+ Crear un nuevo sub-flujo...</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">
                      Orden en el flujo
                    </label>
                    <input
                      type="number"
                      min={1}
                      placeholder="Ej. 1"
                      value={editingQuestion.orderIndex ?? ''}
                      onChange={(e) =>
                        setEditingQuestion({
                          ...editingQuestion,
                          orderIndex: e.target.value ? Number(e.target.value) : undefined,
                        })
                      }
                      className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs text-stone-900 bg-white"
                    />
                  </div>
                </div>

                {editingQuestion.flowId === '__custom__' && (
                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">
                      Identificador del nuevo sub-flujo (ej. hijos, pareja, migracion) *
                    </label>
                    <input
                      type="text"
                      required
                      value={customFlowIdInput}
                      onChange={(e) => setCustomFlowIdInput(e.target.value)}
                      placeholder="Ej. hijos"
                      className="w-full px-3 py-2 border border-amber-300 rounded-lg text-xs text-stone-900 bg-white"
                    />
                  </div>
                )}
              </div>

              {/* Conditional Branching Trigger Section */}
              <div className="p-3.5 bg-amber-50/60 rounded-xl border border-amber-200 space-y-3">
                <label className="flex items-start space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(editingQuestion.branchConfig?.enabled)}
                    onChange={(e) =>
                      setEditingQuestion({
                        ...editingQuestion,
                        branchConfig: {
                          enabled: e.target.checked,
                          targetFlowId: editingQuestion.branchConfig?.targetFlowId || 'hijos',
                          triggerRule: editingQuestion.branchConfig?.triggerRule || 'affirmative',
                          branchLabel:
                            editingQuestion.branchConfig?.branchLabel || 'Flujo sobre Hijos',
                        },
                      })
                    }
                    className="mt-0.5 rounded border-stone-300 text-amber-700 focus:ring-amber-500"
                  />
                  <div>
                    <span className="font-bold text-amber-950 block">
                      2. Configurar Salto Condicional a un Sub-flujo (Ramificación)
                    </span>
                    <span className="text-[11px] text-stone-600">
                      Si el entrevistado responde afirmativamente a esta pregunta (por ejemplo, que sí tiene hijos), el cuestionario brincará al sub-flujo indicado y, al terminar ese sub-flujo, retornará automáticamente al hilo principal.
                    </span>
                  </div>
                </label>

                {editingQuestion.branchConfig?.enabled && (
                  <div className="space-y-3 pt-2 border-t border-amber-200/80">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block font-semibold text-stone-700 mb-1">
                          Brincar hacia el sub-flujo destino *
                        </label>
                        <input
                          type="text"
                          required
                          list="available-subflows-list"
                          value={editingQuestion.branchConfig.targetFlowId || ''}
                          onChange={(e) =>
                            setEditingQuestion({
                              ...editingQuestion,
                              branchConfig: {
                                ...editingQuestion.branchConfig!,
                                targetFlowId: e.target.value,
                              },
                            })
                          }
                          placeholder="Ej. hijos"
                          className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs text-stone-900 bg-white"
                        />
                        <datalist id="available-subflows-list">
                          {availableFlows
                            .filter((f) => f !== 'principal')
                            .map((f) => (
                              <option key={f} value={f} />
                            ))}
                        </datalist>
                      </div>

                      <div>
                        <label className="block font-semibold text-stone-700 mb-1">
                          Condición para activar el salto
                        </label>
                        <select
                          value={editingQuestion.branchConfig.triggerRule || 'affirmative'}
                          onChange={(e) =>
                            setEditingQuestion({
                              ...editingQuestion,
                              branchConfig: {
                                ...editingQuestion.branchConfig!,
                                triggerRule: e.target.value as any,
                              },
                            })
                          }
                          className="w-full px-2.5 py-2 border border-stone-300 rounded-lg text-xs text-stone-900 bg-white"
                        >
                          <option value="affirmative">
                            Respuesta afirmativa / Sí aplica (ej. Sí tiene hijos)
                          </option>
                          <option value="keywords">
                            Contiene palabras clave específicas
                          </option>
                          <option value="any_answer">
                            Cualquier respuesta válida distinta de «No lo recuerdo»
                          </option>
                        </select>
                      </div>
                    </div>

                    {editingQuestion.branchConfig.triggerRule === 'keywords' && (
                      <div>
                        <label className="block font-semibold text-stone-700 mb-1">
                          Palabras clave que disparan el salto (separadas por coma)
                        </label>
                        <input
                          type="text"
                          value={keywordsInput}
                          onChange={(e) => setKeywordsInput(e.target.value)}
                          placeholder="Ej. sí, hijos, hija, hijo, padre, madre"
                          className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs text-stone-900 bg-white"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block font-semibold text-stone-700 mb-1">
                        Nombre descriptivo del sub-flujo para el entrevistado
                      </label>
                      <input
                        type="text"
                        value={editingQuestion.branchConfig.branchLabel || ''}
                        onChange={(e) =>
                          setEditingQuestion({
                            ...editingQuestion,
                            branchConfig: {
                              ...editingQuestion.branchConfig!,
                              branchLabel: e.target.value,
                            },
                          })
                        }
                        placeholder="Ej. Flujo sobre Hijos y Crianza"
                        className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs text-stone-900 bg-white"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Etapa Vital</label>
                  <select
                    value={editingQuestion.lifeStage || 'infancia'}
                    onChange={(e) =>
                      setEditingQuestion({ ...editingQuestion, lifeStage: e.target.value as any })
                    }
                    className="w-full px-2.5 py-2 border border-stone-300 rounded-lg text-xs text-stone-900"
                  >
                    <option value="infancia">Infancia</option>
                    <option value="juventud">Juventud</option>
                    <option value="adultez">Adultez</option>
                    <option value="madurez">Madurez</option>
                    <option value="legado_general">Legado General</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Tema / Eje</label>
                  <input
                    type="text"
                    value={editingQuestion.topic || ''}
                    onChange={(e) =>
                      setEditingQuestion({ ...editingQuestion, topic: e.target.value })
                    }
                    placeholder="Ej. hijos_y_crianza, educacion"
                    className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs text-stone-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Prioridad</label>
                  <select
                    value={editingQuestion.priority || 'media'}
                    onChange={(e) =>
                      setEditingQuestion({ ...editingQuestion, priority: e.target.value as any })
                    }
                    className="w-full px-2.5 py-2 border border-stone-300 rounded-lg text-xs text-stone-900"
                  >
                    <option value="alta">Alta</option>
                    <option value="media">Media</option>
                    <option value="baja">Baja</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Modalidad</label>
                  <select
                    value={editingQuestion.allowedStoryModes || 'ambas'}
                    onChange={(e) =>
                      setEditingQuestion({
                        ...editingQuestion,
                        allowedStoryModes: e.target.value as any,
                      })
                    }
                    className="w-full px-2.5 py-2 border border-stone-300 rounded-lg text-xs text-stone-900"
                  >
                    <option value="ambas">Ambas</option>
                    <option value="individual">Individual</option>
                    <option value="compartida">Compartida</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Requisito</label>
                  <select
                    value={editingQuestion.requirementType || 'mandatory'}
                    onChange={(e) =>
                      setEditingQuestion({
                        ...editingQuestion,
                        requirementType: e.target.value as any,
                      })
                    }
                    className="w-full px-2.5 py-2 border border-stone-300 rounded-lg text-xs text-stone-900"
                  >
                    <option value="mandatory">Obligatoria</option>
                    <option value="optional">Opcional</option>
                    <option value="skippable">Omitible</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-4 border-t border-stone-200">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-700 hover:bg-amber-800 text-white rounded-lg font-semibold"
                >
                  Guardar Configuración de Pregunta
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Import CSV / Excel with Live Preview & Error Reporting */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-3xl w-full p-6 shadow-2xl border border-stone-200 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-stone-200 mb-4">
              <div>
                <h3 className="font-serif text-lg font-bold text-stone-900 flex items-center space-x-2">
                  <FileSpreadsheet className="w-5 h-5 text-emerald-700" />
                  <span>Importar Banco de Preguntas (CSV o Excel)</span>
                </h3>
                <p className="text-xs text-stone-500">
                  Sube un archivo para validar estructura, identificar errores fila por fila y previsualizar antes de guardar.
                </p>
              </div>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-stone-400 hover:text-stone-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs: Subir Archivo vs Pegar Texto */}
            <div className="flex border-b border-stone-200 mb-3 space-x-2">
              <button
                type="button"
                onClick={() => setImportTab('file')}
                className={`py-2 px-3 text-xs font-semibold border-b-2 transition flex items-center space-x-1.5 ${
                  importTab === 'file'
                    ? 'border-emerald-600 text-emerald-800 font-bold'
                    : 'border-transparent text-stone-500 hover:text-stone-700'
                }`}
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Subir Archivo (.csv / .xlsx)</span>
              </button>

              <button
                type="button"
                onClick={() => setImportTab('paste')}
                className={`py-2 px-3 text-xs font-semibold border-b-2 transition flex items-center space-x-1.5 ${
                  importTab === 'paste'
                    ? 'border-emerald-600 text-emerald-800 font-bold'
                    : 'border-transparent text-stone-500 hover:text-stone-700'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Copiar y Pegar Texto CSV</span>
              </button>
            </div>

            {/* Upload Zone / Paste Zone */}
            <div className="space-y-4 overflow-y-auto pr-1">
              {importTab === 'file' ? (
                <div>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleFileDrop}
                    className={`border-2 border-dashed rounded-xl p-6 text-center transition cursor-pointer select-none ${
                      isDragging
                        ? 'border-emerald-500 bg-emerald-50/70'
                        : 'border-stone-300 hover:border-amber-500 bg-stone-50'
                    }`}
                  >
                    <Upload className="w-8 h-8 mx-auto text-stone-400 mb-2" />
                    <p className="text-xs font-semibold text-amber-800 hover:text-amber-900">
                      Haz clic aquí para seleccionar o arrastra tu archivo CSV (.csv) o Excel (.xlsx / .xls)
                    </p>
                    <p className="text-[11px] text-stone-500 mt-1">
                      Compatible con comas, punto y coma (;), tabulaciones y hojas de cálculo de Excel
                    </p>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv, .xlsx, .xls, text/csv, text/plain, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                      onChange={handleFileUpload}
                      className="hidden"
                    />

                    {selectedFileName && (
                      <div className="mt-3 inline-flex items-center space-x-2 bg-emerald-100 text-emerald-900 px-3 py-1.5 rounded-lg text-xs font-semibold border border-emerald-300">
                        <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                        <span>{selectedFileName}</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <textarea
                    rows={6}
                    value={pastedCsvText}
                    onChange={(e) => setPastedCsvText(e.target.value)}
                    placeholder="Pega aquí el contenido copiado de tu archivo CSV o Excel (ej. desde Google Sheets o Excel)&#10;pregunta,etapa,tema&#10;¿Dónde pasaste tu infancia?,infancia,familia&#10;¿A qué te dedicaste en tu vida?,adultez,laboral"
                    className="w-full p-3 border border-stone-300 rounded-lg text-xs font-mono bg-stone-50 text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:bg-white"
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleAnalyzePastedText}
                      disabled={isAnalyzing || !pastedCsvText.trim()}
                      className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 bg-stone-800 hover:bg-stone-900 text-white rounded-lg text-xs font-semibold disabled:opacity-50 transition shadow-xs"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{isAnalyzing ? 'Analizando...' : 'Analizar Texto Pegado'}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Sample Template Download */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-stone-50 rounded-lg border border-stone-200 text-xs">
                <span className="text-stone-600 text-[11px]">
                  ¿Deseas verificar la estructura recomendada con columnas y sub-flujos?
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const csvHeaders =
                      'id,pregunta,etapa,tema,prioridad,modalidad,tipo,flujo,orden,bifurcacion,flujo_destino,regla_disparo,palabras_clave,etiqueta_flujo';
                    const csvRows = [
                      'q_inf_01,"¿Cómo describirías el lugar y el ambiente familiar donde creciste durante tu infancia?",infancia,origen_familiar,alta,ambas,mandatory,principal,1,no,,,,',
                      'q_adu_03,"¿Tienes hijos o asumiste la crianza de hijos a lo largo de tu vida? Cuéntanos qué significó para ti.",adultez,familia_propia,alta,ambas,mandatory,principal,8,si,hijos,affirmative,"sí; hijo; hija; hijos; padre; madre",Flujo sobre Hijos y Crianza',
                      'q_hijos_01,"¿Cómo recuerdas el nacimiento o la llegada de tus hijos y qué cambió en tu vida en ese instante?",adultez,hijos_y_crianza,alta,ambas,mandatory,hijos,1,no,,,,',
                      'q_hijos_02,"¿Qué valores o enseñanzas procuraste inculcarles durante su crecimiento?",adultez,hijos_y_crianza,alta,ambas,mandatory,hijos,2,no,,,,',
                      'q_adu_04,"¿Alguna vez te mudaste de ciudad o emigraste a otro país buscando nuevas oportunidades?",adultez,migracion,media,ambas,optional,principal,9,si,migracion,keywords,"mudé; emigré; otro país; otra ciudad; extranjero",Flujo de Migración y Nuevos Horizontes',
                      'q_mig_01,"¿Qué fue lo más difícil de dejar atrás y cómo fueron tus primeros meses en ese nuevo lugar?",adultez,migracion,media,ambas,mandatory,migracion,1,no,,,,',
                    ];
                    const csvContent = '\uFEFF' + [csvHeaders, ...csvRows].join('\n');
                    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'plantilla_banco_preguntas_con_flujos.csv';
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="inline-flex items-center space-x-1.5 px-2.5 py-1 bg-white border border-stone-300 text-stone-800 rounded text-[11px] font-semibold hover:bg-stone-100 transition shadow-xs"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Descargar Plantilla CSV de Ejemplo</span>
                </button>
              </div>

              {isAnalyzing && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-xs flex items-center space-x-2">
                  <div className="w-4 h-4 border-2 border-amber-700 border-t-transparent rounded-full animate-spin shrink-0" />
                  <span>Analizando archivo y normalizando preguntas...</span>
                </div>
              )}

              {importError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs flex items-center space-x-2">
                  <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{importError}</span>
                </div>
              )}

              {importSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-xs flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{importSuccess}</span>
                </div>
              )}

              {/* Preview Table */}
              {importPreview && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs bg-stone-100 p-2.5 rounded-lg">
                    <span className="font-semibold text-stone-700">
                      Total filas analizadas: {importPreview.totalRows}
                    </span>
                    <div className="flex items-center space-x-3">
                      <span className="text-emerald-700 font-semibold flex items-center space-x-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Válidas para importar: {importPreview.validRowsCount}</span>
                      </span>
                      {importPreview.invalidRowsCount > 0 && (
                        <span className="text-rose-700 font-semibold flex items-center space-x-1">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>Con omisión: {importPreview.invalidRowsCount}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="border border-stone-200 rounded-lg max-h-60 overflow-y-auto">
                    <table className="min-w-full divide-y divide-stone-200 text-left text-[11px]">
                      <thead className="bg-stone-50 text-stone-600 sticky top-0">
                        <tr>
                          <th className="px-3 py-2">Fila</th>
                          <th className="px-3 py-2">Estado</th>
                          <th className="px-3 py-2">ID</th>
                          <th className="px-3 py-2">Flujo / Salto</th>
                          <th className="px-3 py-2">Pregunta</th>
                          <th className="px-3 py-2">Etapa</th>
                          <th className="px-3 py-2">Diagnóstico / Errores</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {importPreview.previewRows.map((r) => (
                          <tr
                            key={r.rowIndex}
                            className={r.isValid ? 'bg-white' : 'bg-rose-50/50'}
                          >
                            <td className="px-3 py-2 text-stone-500">{r.rowIndex}</td>
                            <td className="px-3 py-2">
                              {r.isValid ? (
                                <span className="inline-flex items-center text-emerald-700 font-semibold">
                                  <Check className="w-3.5 h-3.5 mr-0.5" /> Válida
                                </span>
                              ) : (
                                <span className="inline-flex items-center text-rose-700 font-semibold">
                                  <X className="w-3.5 h-3.5 mr-0.5" /> Omitida
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 font-mono text-stone-800">{r.id}</td>
                            <td className="px-3 py-2">
                              <span className="font-semibold text-stone-700">
                                {r.flowId || 'principal'}
                                {r.orderIndex ? ` (#${r.orderIndex})` : ''}
                              </span>
                              {r.branchConfig?.enabled && (
                                <span className="block text-[10px] text-amber-800 font-semibold">
                                  ↳ Salta a: {r.branchConfig.targetFlowId} ({r.branchConfig.triggerRule})
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 max-w-xs truncate text-stone-900">{r.text}</td>
                            <td className="px-3 py-2 capitalize text-stone-700">{r.lifeStage}</td>
                            <td className="px-3 py-2">
                              {r.errors.length === 0 ? (
                                <span className="text-emerald-600">Formato correcto</span>
                              ) : (
                                <ul className="text-rose-600 list-disc list-inside space-y-0.5">
                                  {r.errors.map((err, idx) => (
                                    <li key={idx}>{err}</li>
                                  ))}
                                </ul>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Footer Buttons */}
            <div className="flex justify-end space-x-2 pt-4 border-t border-stone-200 mt-4">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="px-4 py-2 border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50 text-xs"
              >
                Cerrar
              </button>

              <button
                type="button"
                onClick={handleConfirmImport}
                disabled={!importPreview?.canCommit || isCommitting}
                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white rounded-lg font-semibold text-xs transition flex items-center space-x-1.5 shadow-sm"
              >
                <Check className="w-4 h-4" />
                <span>
                  {isCommitting
                    ? 'Guardando en la Base de Datos...'
                    : importPreview?.validRowsCount
                    ? `Confirmar e Importar ${importPreview.validRowsCount} Preguntas`
                    : 'Confirmar e Importar al Banco'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirm Delete Single Question */}
      {deleteSingleTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl border border-stone-200">
            <div className="flex items-center space-x-3 text-rose-600 mb-3">
              <div className="p-2 bg-rose-50 rounded-lg">
                <Trash2 className="w-5 h-5 text-rose-600" />
              </div>
              <h3 className="text-base font-bold text-stone-900">Eliminar Pregunta</h3>
            </div>
            <p className="text-xs text-stone-600 mb-2">
              ¿Estás seguro de que deseas eliminar permanentemente esta pregunta de la base de datos?
            </p>
            <div className="bg-stone-50 border border-stone-200 rounded-lg p-3 my-3 text-xs space-y-1">
              <div className="font-mono text-[11px] text-stone-500 font-semibold">{deleteSingleTarget.id}</div>
              <p className="font-medium text-stone-800">{deleteSingleTarget.text}</p>
            </div>
            <p className="text-[11px] text-stone-400">
              Esta acción no se puede deshacer. Se actualizará en la base de datos de inmediato.
            </p>
            <div className="flex justify-end space-x-2 mt-5">
              <button
                type="button"
                onClick={() => setDeleteSingleTarget(null)}
                disabled={isDeleting}
                className="px-3.5 py-2 border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50 text-xs font-medium"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => handleDeleteSingle(deleteSingleTarget)}
                disabled={isDeleting}
                className="px-4 py-2 bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition shadow-xs"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeleting ? 'Eliminando...' : 'Eliminar de la Base de Datos'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirm Delete Selected Questions */}
      {showDeleteSelectedModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl border border-stone-200">
            <div className="flex items-center space-x-3 text-rose-600 mb-3">
              <div className="p-2 bg-rose-50 rounded-lg">
                <Trash2 className="w-5 h-5 text-rose-600" />
              </div>
              <h3 className="text-base font-bold text-stone-900">
                Eliminar {selectedIds.size} {selectedIds.size === 1 ? 'Pregunta Seleccionada' : 'Preguntas Seleccionadas'}
              </h3>
            </div>
            <p className="text-xs text-stone-600 mb-3">
              Estás a punto de eliminar <strong>{selectedIds.size}</strong> preguntas seleccionadas. Se borrarán permanentemente tanto del servidor como de la base de datos Firestore.
            </p>
            <div className="max-h-36 overflow-y-auto border border-stone-200 rounded-lg divide-y divide-stone-100 bg-stone-50/50 p-2 text-xs mb-3">
              {Array.from(selectedIds).map((id) => {
                const q = questions.find((item) => item.id === id);
                return (
                  <div key={id} className="py-1 px-1 flex items-baseline justify-between gap-2">
                    <span className="font-mono text-[10px] text-stone-500 shrink-0">{id}</span>
                    <span className="truncate text-[11px] text-stone-800 flex-1">{q?.text || id}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-stone-400">
              Esta operación es irreversible.
            </p>
            <div className="flex justify-end space-x-2 mt-5">
              <button
                type="button"
                onClick={() => setShowDeleteSelectedModal(false)}
                disabled={isDeleting}
                className="px-3.5 py-2 border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50 text-xs font-medium"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDeleteSelected}
                disabled={isDeleting}
                className="px-4 py-2 bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition shadow-xs"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeleting ? 'Eliminando...' : `Eliminar ${selectedIds.size} Preguntas`}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirm Delete All Questions (Previa Confirmación) */}
      {showDeleteAllModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-2xl border-2 border-rose-200">
            <div className="flex items-center space-x-3 text-rose-600 mb-3">
              <div className="p-3 bg-rose-100 rounded-xl">
                <AlertTriangle className="w-6 h-6 text-rose-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-stone-900">
                  ¿Eliminar TODAS las preguntas del banco?
                </h3>
                <p className="text-xs text-rose-600 font-semibold">
                  Acción crítica: Afecta a {questions.length} preguntas
                </p>
              </div>
            </div>
            <p className="text-xs text-stone-600 leading-relaxed mb-4">
              Esta acción eliminará de forma inmediata y definitiva <strong>todas las {questions.length} preguntas</strong> guardadas en la base de datos Firestore y en el servidor, incluyendo hilos principales y sub-flujos configurados.
            </p>

            <div className="bg-rose-50 border border-rose-200 rounded-lg p-3.5 mb-4 text-xs space-y-2">
              <p className="text-rose-900 font-medium">
                Para confirmar la eliminación total, escribe la palabra <strong className="font-mono uppercase bg-rose-200/80 px-1 py-0.5 rounded text-rose-950">ELIMINAR</strong> en el siguiente campo:
              </p>
              <input
                type="text"
                placeholder="Escribe ELIMINAR para continuar"
                value={deleteAllConfirmText}
                onChange={(e) => setDeleteAllConfirmText(e.target.value)}
                className="w-full px-3 py-2 border border-rose-300 rounded-lg text-xs font-mono uppercase bg-white text-stone-900 focus:outline-none focus:ring-2 focus:ring-rose-400"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-stone-200">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteAllModal(false);
                  setDeleteAllConfirmText('');
                }}
                disabled={isDeleting}
                className="px-4 py-2 border border-stone-300 text-stone-700 rounded-lg hover:bg-stone-50 text-xs font-medium"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDeleteAll}
                disabled={deleteAllConfirmText.trim().toUpperCase() !== 'ELIMINAR' || isDeleting}
                className="px-4 py-2 bg-rose-700 hover:bg-rose-800 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition shadow-sm"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeleting ? 'Eliminando todo...' : 'Confirmar y Eliminar Todo'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
