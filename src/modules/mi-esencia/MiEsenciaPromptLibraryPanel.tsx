import React, { useState, useMemo } from 'react';
import {
  BookOpen,
  Plus,
  Search,
  Copy,
  Trash2,
  Download,
  Upload,
  Play,
  History,
  CheckCircle2,
  Edit3,
  UserPlus,
  FolderPlus,
  Eye,
} from 'lucide-react';
import type { MiEsenciaPersonProfile } from '../../logic/miEsenciaRules';
import {
  DEFAULT_PROMPT_CATEGORIES,
  SUPPORTED_DYNAMIC_VARIABLES,
  type MiEsenciaAiProvider,
  type MiEsenciaLibraryPromptRecord,
  type MiEsenciaPromptCompatibleProvider,
} from '../../logic/miEsenciaAiTypesAndRules';

interface MiEsenciaPromptLibraryPanelProps {
  promptLibrary: MiEsenciaLibraryPromptRecord[];
  customCategories: string[];
  persons: MiEsenciaPersonProfile[];
  adminEmail: string;
  onUpdated: () => Promise<void>;
  onOpenSimulatorWithPrompt: (params: {
    personId?: string;
    provider: MiEsenciaAiProvider;
    draftPromptContent: string;
  }) => void;
  onNotify: (type: 'ok' | 'err', text: string) => void;
}

export const MiEsenciaPromptLibraryPanel: React.FC<MiEsenciaPromptLibraryPanelProps> = ({
  promptLibrary,
  customCategories,
  persons,
  adminEmail,
  onUpdated,
  onOpenSimulatorWithPrompt,
  onNotify,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('todas');
  const [providerFilter, setProviderFilter] = useState<string>('todos');
  const [selectedPromptIds, setSelectedPromptIds] = useState<string[]>([]);

  // Editor / Creador de prompt
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState<boolean>(false);
  const [formName, setFormName] = useState<string>('');
  const [formDescription, setFormDescription] = useState<string>('');
  const [formCategory, setFormCategory] = useState<string>('Conversación familiar');
  const [formCompatibleProvider, setFormCompatibleProvider] =
    useState<MiEsenciaPromptCompatibleProvider>('ambos');
  const [formContent, setFormContent] = useState<string>('');
  const [isSavingPrompt, setIsSavingPrompt] = useState<boolean>(false);

  // Nueva categoría personalizada
  const [newCategoryInput, setNewCategoryInput] = useState<string>('');
  const [showNewCategoryForm, setShowNewCategoryForm] = useState<boolean>(false);

  // Confirmación inline de borrado
  const [confirmDeletePromptId, setConfirmDeletePromptId] = useState<string | null>(null);

  // Asignar copia independiente a un avatar
  const [assigningPrompt, setAssigningPrompt] = useState<MiEsenciaLibraryPromptRecord | null>(null);
  const [assignTargetPersonId, setAssignTargetPersonId] = useState<string>(
    persons[0]?.personId || ''
  );
  const [assignTargetProvider, setAssignTargetProvider] = useState<MiEsenciaAiProvider | 'ambos'>(
    'ambos'
  );
  const [assignActivateCustomMode, setAssignActivateCustomMode] = useState<boolean>(true);

  // Historial de versiones de un prompt de biblioteca
  const [historyPrompt, setHistoryPrompt] = useState<MiEsenciaLibraryPromptRecord | null>(null);

  // Importación de prompts
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [importFormat, setImportFormat] = useState<'json' | 'md' | 'txt'>('txt');
  const [importDefaultName, setImportDefaultName] = useState<string>('');
  const [importDefaultCategory, setImportDefaultCategory] =
    useState<string>('Conversación familiar');
  const [importDefaultProvider, setImportDefaultProvider] =
    useState<MiEsenciaPromptCompatibleProvider>('ambos');
  const [importRawContent, setImportRawContent] = useState<string>('');

  // Exportación formato
  const [exportFormat, setExportFormat] = useState<'json' | 'md' | 'txt'>('json');

  const allCategories = useMemo(() => {
    const set = new Set([...DEFAULT_PROMPT_CATEGORIES, ...(customCategories || [])]);
    for (const p of promptLibrary) {
      if (p.category) set.add(p.category);
    }
    return Array.from(set);
  }, [customCategories, promptLibrary]);

  const filteredPrompts = useMemo(() => {
    return promptLibrary.filter((p) => {
      if (categoryFilter !== 'todas' && p.category !== categoryFilter) return false;
      if (
        providerFilter !== 'todos' &&
        p.compatibleProvider !== providerFilter &&
        p.compatibleProvider !== 'ambos'
      ) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = p.name.toLowerCase().includes(q);
        const matchDesc = (p.description || '').toLowerCase().includes(q);
        const matchContent = p.content.toLowerCase().includes(q);
        const matchCat = p.category.toLowerCase().includes(q);
        if (!matchName && !matchDesc && !matchContent && !matchCat) return false;
      }
      return true;
    });
  }, [promptLibrary, categoryFilter, providerFilter, searchQuery]);

  const openNewPromptEditor = () => {
    setEditingPromptId(null);
    setFormName('');
    setFormDescription('');
    setFormCategory(allCategories[0] || 'Conversación familiar');
    setFormCompatibleProvider('ambos');
    setFormContent('');
    setIsEditorOpen(true);
  };

  const openEditPromptEditor = (prompt: MiEsenciaLibraryPromptRecord) => {
    setEditingPromptId(prompt.promptId);
    setFormName(prompt.name);
    setFormDescription(prompt.description || '');
    setFormCategory(prompt.category);
    setFormCompatibleProvider(prompt.compatibleProvider);
    setFormContent(prompt.content);
    setIsEditorOpen(true);
  };

  const handleSavePrompt = async () => {
    if (!formName.trim() || !formContent.trim()) {
      onNotify('err', 'El nombre del prompt y su contenido íntegro son obligatorios.');
      return;
    }
    setIsSavingPrompt(true);
    try {
      const res = await fetch('/api/mi-esencia/admin/prompts/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({
          promptId: editingPromptId || undefined,
          name: formName.trim(),
          description: formDescription.trim(),
          category: formCategory,
          compatibleProvider: formCompatibleProvider,
          content: formContent,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        onNotify('err', json.error || 'No se pudo guardar el prompt en la biblioteca.');
        return;
      }
      setIsEditorOpen(false);
      onNotify(
        'ok',
        `Prompt «${json.data.name}» guardado en la biblioteca global (Versión v${json.data.version}).`
      );
      await onUpdated();
    } catch (err: any) {
      onNotify('err', err?.message || 'Error al guardar prompt.');
    } finally {
      setIsSavingPrompt(false);
    }
  };

  const handleDuplicatePrompt = async (promptId: string) => {
    try {
      const res = await fetch('/api/mi-esencia/admin/prompts/duplicate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({ promptId }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        onNotify('err', json.error || 'No se pudo duplicar el prompt.');
        return;
      }
      onNotify('ok', `Prompt duplicado como «${json.data.name}».`);
      await onUpdated();
    } catch {
      onNotify('err', 'Error al duplicar prompt.');
    }
  };

  const handleDeletePromptConfirmed = async (promptId: string) => {
    try {
      const res = await fetch('/api/mi-esencia/admin/prompts/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({ promptId }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        onNotify('err', json.error || 'No se pudo eliminar el prompt.');
        return;
      }
      setConfirmDeletePromptId(null);
      setSelectedPromptIds((prev) => prev.filter((id) => id !== promptId));
      onNotify(
        'ok',
        'Prompt eliminado de la biblioteca global. Las copias independientes asignadas a avatares permanecen intactas.'
      );
      await onUpdated();
    } catch {
      onNotify('err', 'Error al eliminar prompt.');
    }
  };

  const handleRestoreLibraryVersion = async (promptId: string, versionId: string, verNum: number) => {
    try {
      const res = await fetch('/api/mi-esencia/admin/prompts/restore-version', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({ promptId, versionId }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        onNotify('err', json.error || 'No se pudo restaurar la versión.');
        return;
      }
      setHistoryPrompt(json.data);
      onNotify(
        'ok',
        `Versión v${verNum} restaurada como nueva versión activa (v${json.data.version}).`
      );
      await onUpdated();
    } catch {
      onNotify('err', 'Error al restaurar versión.');
    }
  };

  const handleAssignToAvatar = async () => {
    if (!assigningPrompt || !assignTargetPersonId) {
      onNotify('err', 'Selecciona un perfil de avatar para asignarle la copia del prompt.');
      return;
    }
    try {
      const res = await fetch('/api/mi-esencia/admin/prompts/assign-to-avatar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({
          promptId: assigningPrompt.promptId,
          personId: assignTargetPersonId,
          targetProvider: assignTargetProvider,
          activateCustomMode: assignActivateCustomMode,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        onNotify('err', json.error || 'No se pudo asignar el prompt al avatar.');
        return;
      }
      const targetPerson = persons.find((p) => p.personId === assignTargetPersonId);
      setAssigningPrompt(null);
      onNotify(
        'ok',
        `Copia independiente de «${assigningPrompt.name}» asignada a «${
          targetPerson?.fullName || assignTargetPersonId
        }».`
      );
      await onUpdated();
    } catch {
      onNotify('err', 'Error al asignar prompt al avatar.');
    }
  };

  const handleAddCategory = async () => {
    if (!newCategoryInput.trim()) return;
    try {
      const res = await fetch('/api/mi-esencia/admin/prompts/categories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({ categoryName: newCategoryInput.trim() }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setFormCategory(newCategoryInput.trim());
        setNewCategoryInput('');
        setShowNewCategoryForm(false);
        onNotify('ok', 'Categoría personalizada agregada.');
        await onUpdated();
      }
    } catch {
      onNotify('err', 'Error al crear categoría.');
    }
  };

  const handleExportPrompts = async (promptIds?: string[]) => {
    try {
      const res = await fetch('/api/mi-esencia/admin/prompts/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({
          promptIds,
          format: exportFormat,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        onNotify('err', json.error || 'No se pudo exportar.');
        return;
      }
      const blob = new Blob([json.data.content], { type: json.data.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = json.data.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onNotify('ok', `Archivo «${json.data.fileName}» exportado correctamente.`);
    } catch {
      onNotify('err', 'Error al exportar prompts.');
    }
  };

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.name.endsWith('.json')) setImportFormat('json');
    else if (file.name.endsWith('.md') || file.name.endsWith('.markdown')) setImportFormat('md');
    else setImportFormat('txt');

    if (!importDefaultName) {
      setImportDefaultName(file.name.replace(/\.[^.]+$/, ''));
    }

    const reader = new FileReader();
    reader.onload = () => {
      setImportRawContent(String(reader.result || ''));
    };
    reader.readAsText(file);
  };

  const handleImportSubmit = async () => {
    if (!importRawContent.trim()) {
      onNotify('err', 'Selecciona un archivo o pega el contenido del prompt a importar.');
      return;
    }
    try {
      const res = await fetch('/api/mi-esencia/admin/prompts/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': adminEmail,
        },
        body: JSON.stringify({
          rawContent: importRawContent,
          format: importFormat,
          defaultName: importDefaultName.trim() || undefined,
          defaultCategory: importDefaultCategory,
          defaultCompatibleProvider: importDefaultProvider,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        onNotify('err', json.error || 'No se pudo importar el archivo de prompts.');
        return;
      }
      setShowImportModal(false);
      setImportRawContent('');
      setImportDefaultName('');
      onNotify(
        'ok',
        `Se importaron ${json.data.length} prompt(s) en la biblioteca sin sobrescribir registros existentes.`
      );
      await onUpdated();
    } catch {
      onNotify('err', 'Error al importar prompts.');
    }
  };

  const toggleSelectPrompt = (promptId: string) => {
    setSelectedPromptIds((prev) =>
      prev.includes(promptId) ? prev.filter((id) => id !== promptId) : [...prev, promptId]
    );
  };

  return (
    <div className="space-y-6">
      {/* Cabecera de la Biblioteca Global de Prompts */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 text-amber-800 text-xs font-bold uppercase tracking-wider">
              <BookOpen className="w-4 h-4" />
              <span>Biblioteca Global Reutilizable</span>
            </div>
            <h3 className="font-serif text-xl text-stone-900 mt-0.5">
              Administrador de Prompts («Mi Esencia»)
            </h3>
            <p className="text-xs text-stone-500 max-w-2xl">
              Crea, edita, duplica, versiona, importa y exporta prompts completos para Gemini y
              OpenAI GPT. Al asignar un prompt a un avatar se crea una copia independiente para que
              los cambios futuros en la biblioteca no alteren avatares en producción sin tu
              autorización.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={openNewPromptEditor}
              className="px-4 py-2 rounded-xl bg-stone-900 hover:bg-stone-800 text-amber-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Nuevo Prompt</span>
            </button>
            <button
              type="button"
              onClick={() => setShowImportModal(true)}
              className="px-3.5 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Importar (TXT / MD / JSON)</span>
            </button>
            <div className="flex items-center gap-1 bg-stone-100 rounded-xl p-1">
              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as 'json' | 'md' | 'txt')}
                className="px-2 py-1 rounded-lg bg-white border border-stone-300 text-[11px] font-medium"
              >
                <option value="json">JSON</option>
                <option value="md">Markdown</option>
                <option value="txt">TXT</option>
              </select>
              <button
                type="button"
                onClick={() =>
                  handleExportPrompts(
                    selectedPromptIds.length > 0 ? selectedPromptIds : undefined
                  )
                }
                className="px-3 py-1 rounded-lg bg-stone-900 text-amber-300 text-xs font-semibold flex items-center gap-1 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>
                  {selectedPromptIds.length > 0
                    ? `Exportar Selección (${selectedPromptIds.length})`
                    : 'Exportar Biblioteca'}
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Filtros de búsqueda, categoría y proveedor */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-2 border-t border-stone-100 text-xs">
          <div className="md:col-span-2 relative">
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por nombre, descripción, categoría o contenido del prompt..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-stone-300 text-xs"
            />
          </div>

          <div className="flex gap-1.5">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white text-xs"
            >
              <option value="todas">Todas las categorías</option>
              {allCategories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setShowNewCategoryForm(!showNewCategoryForm)}
              className="px-2.5 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 shrink-0 cursor-pointer"
              title="Crear nueva categoría personalizada"
            >
              <FolderPlus className="w-4 h-4" />
            </button>
          </div>

          <div>
            <select
              value={providerFilter}
              onChange={(e) => setProviderFilter(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white text-xs"
            >
              <option value="todos">Todos los proveedores (Gemini / OpenAI / Ambos)</option>
              <option value="gemini">Compatible con Gemini</option>
              <option value="openai">Compatible con OpenAI GPT</option>
              <option value="ambos">Universal (Ambos proveedores)</option>
            </select>
          </div>
        </div>

        {showNewCategoryForm && (
          <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 flex items-center gap-2 text-xs">
            <input
              type="text"
              value={newCategoryInput}
              onChange={(e) => setNewCategoryInput(e.target.value)}
              placeholder="Nombre de la nueva categoría (ej. Abuelos afectuosos, Memorial solemne)..."
              className="flex-1 px-3 py-1.5 rounded-lg border border-stone-300"
            />
            <button
              type="button"
              onClick={handleAddCategory}
              className="px-3 py-1.5 rounded-lg bg-stone-900 text-amber-300 font-semibold cursor-pointer"
            >
              Guardar Categoría
            </button>
          </div>
        )}
      </div>

      {/* Modal / Panel de Creación y Edición de Prompt */}
      {isEditorOpen && (
        <div className="bg-white rounded-2xl border-2 border-amber-400 p-6 shadow-md space-y-4 text-xs">
          <div className="flex items-center justify-between border-b border-stone-200 pb-3">
            <h4 className="font-serif font-bold text-base text-stone-900">
              {editingPromptId ? 'Editar Prompt de la Biblioteca' : 'Crear Nuevo Prompt en Biblioteca'}
            </h4>
            <button
              type="button"
              onClick={() => setIsEditorOpen(false)}
              className="text-stone-500 hover:text-stone-900 font-semibold cursor-pointer"
            >
              ✕ Cerrar editor
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block font-semibold text-stone-700 mb-1">Nombre del Prompt</label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Ej. Recreación Biográfica Cálida"
                className="w-full px-3 py-2 rounded-xl border border-stone-300"
              />
            </div>

            <div>
              <label className="block font-semibold text-stone-700 mb-1">Categoría</label>
              <select
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white"
              >
                {allCategories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-stone-700 mb-1">
                Proveedor Compatible
              </label>
              <select
                value={formCompatibleProvider}
                onChange={(e) =>
                  setFormCompatibleProvider(e.target.value as MiEsenciaPromptCompatibleProvider)
                }
                className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white"
              >
                <option value="ambos">Ambos (Gemini y OpenAI GPT)</option>
                <option value="gemini">Google Gemini</option>
                <option value="openai">OpenAI GPT</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block font-semibold text-stone-700 mb-1">Descripción Breve</label>
            <input
              type="text"
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              placeholder="Propósito u orientación de este prompt..."
              className="w-full px-3 py-2 rounded-xl border border-stone-300"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="font-semibold text-stone-700">
                Texto Íntegro del Prompt ({formContent.length.toLocaleString()} caracteres)
              </label>
              <div className="flex flex-wrap gap-1">
                {SUPPORTED_DYNAMIC_VARIABLES.map((v) => (
                  <button
                    key={v.token}
                    type="button"
                    onClick={() =>
                      setFormContent(
                        (prev) => `${prev}${prev.endsWith(' ') || !prev ? '' : ' '}${v.token}`
                      )
                    }
                    className="px-2 py-0.5 rounded bg-amber-50 hover:bg-amber-100 border border-amber-300 font-mono text-[11px] text-amber-950 cursor-pointer"
                    title={v.description}
                  >
                    +{v.token}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              rows={14}
              value={formContent}
              onChange={(e) => setFormContent(e.target.value)}
              placeholder="Escribe o pega aquí el prompt completo con sus encabezados, listas y reglas..."
              className="w-full p-3 rounded-xl border border-stone-300 font-mono text-xs leading-relaxed"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsEditorOpen(false)}
              className="px-4 py-2 rounded-xl bg-stone-100 text-stone-700 font-semibold cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSavePrompt}
              disabled={isSavingPrompt}
              className="px-5 py-2 rounded-xl bg-stone-900 text-amber-300 font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isSavingPrompt ? 'Guardando...' : 'Guardar Prompt en Biblioteca'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Modal inline de Importación */}
      {showImportModal && (
        <div className="bg-white rounded-2xl border-2 border-stone-800 p-6 space-y-4 text-xs">
          <div className="flex items-center justify-between border-b border-stone-200 pb-3">
            <h4 className="font-serif font-bold text-base text-stone-900">
              Importar Prompts a la Biblioteca (TXT, Markdown o JSON)
            </h4>
            <button
              type="button"
              onClick={() => setShowImportModal(false)}
              className="text-stone-500 hover:text-stone-900 font-semibold cursor-pointer"
            >
              ✕ Cerrar
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block font-semibold text-stone-700 mb-1">Archivo de Origen</label>
              <label className="flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-stone-300 bg-stone-50 hover:bg-stone-100 cursor-pointer">
                <Upload className="w-4 h-4 text-amber-700" />
                <span>Seleccionar .txt, .md o .json</span>
                <input
                  type="file"
                  accept=".txt,.md,.markdown,.json"
                  onChange={handleImportFileChange}
                  className="hidden"
                />
              </label>
            </div>
            <div>
              <label className="block font-semibold text-stone-700 mb-1">Formato</label>
              <select
                value={importFormat}
                onChange={(e) => setImportFormat(e.target.value as 'txt' | 'md' | 'json')}
                className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white"
              >
                <option value="txt">Texto plano (.txt)</option>
                <option value="md">Markdown (.md)</option>
                <option value="json">Estructura JSON (.json)</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-stone-700 mb-1">Categoría</label>
              <select
                value={importDefaultCategory}
                onChange={(e) => setImportDefaultCategory(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white"
              >
                {allCategories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-semibold text-stone-700 mb-1">Proveedor</label>
              <select
                value={importDefaultProvider}
                onChange={(e) =>
                  setImportDefaultProvider(e.target.value as MiEsenciaPromptCompatibleProvider)
                }
                className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white"
              >
                <option value="ambos">Ambos</option>
                <option value="gemini">Gemini</option>
                <option value="openai">OpenAI GPT</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block font-semibold text-stone-700 mb-1">
              Nombre por defecto (para archivos TXT o MD)
            </label>
            <input
              type="text"
              value={importDefaultName}
              onChange={(e) => setImportDefaultName(e.target.value)}
              placeholder="Ej. Prompt Importado Personalizado"
              className="w-full px-3 py-2 rounded-xl border border-stone-300"
            />
          </div>

          <div>
            <label className="block font-semibold text-stone-700 mb-1">
              Contenido a Importar
            </label>
            <textarea
              rows={6}
              value={importRawContent}
              onChange={(e) => setImportRawContent(e.target.value)}
              placeholder="Pega aquí el contenido TXT, Markdown o JSON..."
              className="w-full p-3 rounded-xl border border-stone-300 font-mono text-xs"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowImportModal(false)}
              className="px-4 py-2 rounded-xl bg-stone-100 text-stone-700 font-semibold cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleImportSubmit}
              className="px-4 py-2 rounded-xl bg-stone-900 text-amber-300 font-semibold cursor-pointer"
            >
              Validar e Importar a la Biblioteca
            </button>
          </div>
        </div>
      )}

      {/* Modal inline para Asignar Copia Independiente a un Avatar */}
      {assigningPrompt && (
        <div className="bg-amber-50 rounded-2xl border-2 border-amber-400 p-5 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <h4 className="font-serif font-bold text-sm text-stone-900">
              Asignar Copia Independiente de «{assigningPrompt.name}» a un Avatar
            </h4>
            <button
              type="button"
              onClick={() => setAssigningPrompt(null)}
              className="text-stone-500 hover:text-stone-900 font-semibold cursor-pointer"
            >
              ✕
            </button>
          </div>
          <p className="text-stone-600">
            Se copiará el texto íntegro del prompt dentro de la configuración del avatar elegido.
            Si después modificas este prompt en la biblioteca, el avatar conservará su propia copia
            sin alteraciones imprevistas.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block font-semibold text-stone-700 mb-1">Perfil de Avatar</label>
              <select
                value={assignTargetPersonId}
                onChange={(e) => setAssignTargetPersonId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white"
              >
                {persons.map((p) => (
                  <option key={p.personId} value={p.personId}>
                    {p.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-semibold text-stone-700 mb-1">
                Bloque de Proveedor Destino
              </label>
              <select
                value={assignTargetProvider}
                onChange={(e) =>
                  setAssignTargetProvider(e.target.value as MiEsenciaAiProvider | 'ambos')
                }
                className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white"
              >
                <option value="gemini">Asignar al Prompt de Gemini</option>
                <option value="openai">Asignar al Prompt de OpenAI GPT</option>
                <option value="ambos">Asignar a Ambos (Gemini y OpenAI GPT)</option>
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer pb-2">
                <input
                  type="checkbox"
                  checked={assignActivateCustomMode}
                  onChange={(e) => setAssignActivateCustomMode(e.target.checked)}
                  className="rounded border-stone-300 text-amber-700"
                />
                <span>Activar `modo_personalizado` en el avatar</span>
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={handleAssignToAvatar}
              className="px-4 py-2 rounded-xl bg-stone-900 text-amber-300 font-semibold cursor-pointer"
            >
              Confirmar Asignación de Copia Independiente
            </button>
          </div>
        </div>
      )}

      {/* Modal inline de Historial de Versiones de un Prompt de Biblioteca */}
      {historyPrompt && (
        <div className="bg-white rounded-2xl border border-stone-300 p-5 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <h4 className="font-serif font-bold text-sm text-stone-900">
              Historial de Versiones: «{historyPrompt.name}» (Versión activa: v
              {historyPrompt.version})
            </h4>
            <button
              type="button"
              onClick={() => setHistoryPrompt(null)}
              className="text-stone-500 hover:text-stone-900 font-semibold cursor-pointer"
            >
              ✕ Cerrar historial
            </button>
          </div>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {historyPrompt.versionHistory.map((ver) => (
              <div
                key={ver.versionId}
                className="p-3 rounded-xl bg-stone-50 border border-stone-200 flex items-center justify-between gap-3"
              >
                <div>
                  <span className="font-bold text-stone-900">
                    Versión v{ver.versionNumber} — {ver.promptName}
                  </span>
                  <span className="block text-[11px] text-stone-500">
                    {new Date(ver.modifiedAt).toLocaleString('es-MX')} • Por: {ver.modifiedBy} •{' '}
                    {ver.sourceReference}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    handleRestoreLibraryVersion(
                      historyPrompt.promptId,
                      ver.versionId,
                      ver.versionNumber
                    )
                  }
                  className="px-3 py-1.5 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-950 font-semibold shrink-0 cursor-pointer"
                >
                  Restaurar esta versión
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Listado de Prompts en la Biblioteca Global */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="font-serif text-base text-stone-900">
            Prompts Registrados ({filteredPrompts.length})
          </h4>
        </div>

        {filteredPrompts.length === 0 ? (
          <p className="text-xs text-stone-500 py-6 text-center">
            No se encontraron prompts que coincidan con los filtros seleccionados.
          </p>
        ) : (
          <div className="space-y-3">
            {filteredPrompts.map((prompt) => {
              const isSelected = selectedPromptIds.includes(prompt.promptId);
              return (
                <div
                  key={prompt.promptId}
                  className="p-4 rounded-xl border border-stone-200 hover:border-stone-300 transition space-y-2.5 text-xs"
                >
                  <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectPrompt(prompt.promptId)}
                        className="mt-1 rounded border-stone-300 text-amber-700"
                      />
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-serif font-bold text-sm text-stone-900">
                            {prompt.name}
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-stone-100 text-stone-700 text-[11px] font-medium">
                            {prompt.category}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                              prompt.compatibleProvider === 'gemini'
                                ? 'bg-sky-100 text-sky-900'
                                : prompt.compatibleProvider === 'openai'
                                ? 'bg-emerald-100 text-emerald-900'
                                : 'bg-amber-100 text-amber-900'
                            }`}
                          >
                            Proveedor: {prompt.compatibleProvider.toUpperCase()}
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-stone-200 text-stone-800 text-[11px] font-semibold">
                            v{prompt.version}
                          </span>
                          <span className="text-[11px] text-stone-400">
                            Modificado: {new Date(prompt.updatedAt).toLocaleDateString('es-MX')}
                          </span>
                        </div>
                        {prompt.description && (
                          <p className="text-stone-600">{prompt.description}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditPromptEditor(prompt)}
                        className="px-2.5 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-800 font-medium flex items-center gap-1 cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Ver / Editar</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAssigningPrompt(prompt);
                          if (prompt.compatibleProvider === 'gemini') {
                            setAssignTargetProvider('gemini');
                          } else if (prompt.compatibleProvider === 'openai') {
                            setAssignTargetProvider('openai');
                          } else {
                            setAssignTargetProvider('ambos');
                          }
                        }}
                        className="px-2.5 py-1.5 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-950 font-semibold flex items-center gap-1 cursor-pointer"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>Asignar a Avatar</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onOpenSimulatorWithPrompt({
                            personId: persons[0]?.personId,
                            provider:
                              prompt.compatibleProvider === 'openai' ? 'openai' : 'gemini',
                            draftPromptContent: prompt.content,
                          })
                        }
                        className="px-2.5 py-1.5 rounded-lg bg-stone-900 text-amber-300 font-semibold flex items-center gap-1 cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>Probar</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDuplicatePrompt(prompt.promptId)}
                        className="px-2.5 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 font-medium flex items-center gap-1 cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Duplicar</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setHistoryPrompt(prompt)}
                        className="px-2.5 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 font-medium flex items-center gap-1 cursor-pointer"
                      >
                        <History className="w-3.5 h-3.5" />
                        <span>Versiones ({prompt.versionHistory?.length || 1})</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExportPrompts([prompt.promptId])}
                        className="px-2.5 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 font-medium flex items-center gap-1 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Exportar</span>
                      </button>
                      {confirmDeletePromptId === prompt.promptId ? (
                        <div className="inline-flex items-center gap-1 bg-red-100 px-2 py-1 rounded-lg border border-red-300">
                          <span className="text-red-900 font-semibold">¿Confirmar?</span>
                          <button
                            type="button"
                            onClick={() => handleDeletePromptConfirmed(prompt.promptId)}
                            className="px-2 py-0.5 rounded bg-red-700 text-white font-bold cursor-pointer"
                          >
                            Sí, borrar
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeletePromptId(null)}
                            className="px-2 py-0.5 rounded bg-white text-stone-700 cursor-pointer"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeletePromptId(prompt.promptId)}
                          className="px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-800 font-medium flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Eliminar</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <details className="text-[11px] text-stone-600 pt-1">
                    <summary className="cursor-pointer font-medium text-stone-500 hover:text-stone-800">
                      Ver extracto del prompt ({prompt.content.length.toLocaleString()} caracteres)
                    </summary>
                    <pre className="mt-2 p-3 rounded-lg bg-stone-50 border border-stone-200 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto text-stone-800">
                      {prompt.content}
                    </pre>
                  </details>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
