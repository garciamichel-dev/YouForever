import React, { useRef, useState, useEffect } from 'react';
import {
  Camera,
  Trash2,
  Image as ImageIcon,
  AlertCircle,
  CheckCircle2,
  X,
  RotateCcw,
  Check,
  RefreshCw,
} from 'lucide-react';

export interface DraftPhotoItem {
  id?: string;
  tempId: string;
  fileName: string;
  mimeType: string;
  caption: string;
  dataUrl?: string;
  imageUrl?: string;
  isPersisted?: boolean;
}

interface QuestionPhotoUploaderProps {
  photos: DraftPhotoItem[];
  onChange: (updatedPhotos: DraftPhotoItem[]) => void;
  onDeletePersistedPhoto?: (photoId: string) => Promise<void>;
  disabled?: boolean;
  compact?: boolean;
  label?: string;
}

/**
 * Compress and resize an uploaded image in the browser so it uploads fast
 * and stays well within Firestore's per-document storage limit.
 */
async function processAndCompressImage(file: File): Promise<{ dataUrl: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo de imagen.'));
    reader.onload = () => {
      const rawDataUrl = reader.result as string;
      // If file is SVG or already small (< 200KB), keep directly
      if (file.type === 'image/svg+xml' || rawDataUrl.length < 220_000) {
        resolve({ dataUrl: rawDataUrl, mimeType: file.type || 'image/jpeg' });
        return;
      }

      const img = new Image();
      img.onerror = () => resolve({ dataUrl: rawDataUrl, mimeType: file.type || 'image/jpeg' });
      img.onload = () => {
        try {
          const maxDim = 1200;
          let width = img.width;
          let height = img.height;
          if (width > maxDim || height > maxDim) {
            if (width >= height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve({ dataUrl: rawDataUrl, mimeType: file.type || 'image/jpeg' });
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.82);
          resolve({ dataUrl: compressedDataUrl, mimeType: 'image/jpeg' });
        } catch {
          resolve({ dataUrl: rawDataUrl, mimeType: file.type || 'image/jpeg' });
        }
      };
      img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export const QuestionPhotoUploader: React.FC<QuestionPhotoUploaderProps> = ({
  photos,
  onChange,
  onDeletePersistedPhoto,
  disabled = false,
  compact = false,
  label = ' Puedes Cargar Fotografías o Imágenes Relacionadas (Opcional)',
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [processingFiles, setProcessingFiles] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Live Camera Viewfinder State
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<'environment' | 'user'>('environment');
  const [cameraLoading, setCameraLoading] = useState(false);
  const [capturedImagePreview, setCapturedImagePreview] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Cleanup camera stream on unmount
  useEffect(() => {
    return () => {
      stopCameraStream();
    };
  }, []);

  const stopCameraStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const handleStartCamera = async (facing: 'environment' | 'user' = cameraFacing) => {
    setUploadError(null);
    setCapturedImagePreview(null);
    setIsCameraOpen(true);
    setCameraLoading(true);

    // If getUserMedia is not supported, directly trigger native mobile camera input
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraLoading(false);
      setIsCameraOpen(false);
      cameraInputRef.current?.click();
      return;
    }

    stopCameraStream();

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraFacing(facing);
    } catch (_err: unknown) {
      // Fallback: trigger native device camera input
      setIsCameraOpen(false);
      stopCameraStream();
      cameraInputRef.current?.click();
    } finally {
      setCameraLoading(false);
    }
  };

  const handleSwitchCameraFacing = () => {
    const nextFacing = cameraFacing === 'environment' ? 'user' : 'environment';
    handleStartCamera(nextFacing);
  };

  const handleCaptureSnapshot = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    setCapturedImagePreview(dataUrl);
  };

  const handleConfirmCapturedPhoto = () => {
    if (!capturedImagePreview) return;

    const newPhotoItem: DraftPhotoItem = {
      tempId: `tmp_cam_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      fileName: `Foto_camara_${new Date().toISOString().slice(0, 10)}.jpg`,
      mimeType: 'image/jpeg',
      caption: '',
      dataUrl: capturedImagePreview,
      isPersisted: false,
    };

    onChange([...photos, newPhotoItem]);
    handleCloseCameraModal();
  };

  const handleCloseCameraModal = () => {
    stopCameraStream();
    setIsCameraOpen(false);
    setCapturedImagePreview(null);
  };

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    setUploadError(null);
    setProcessingFiles(true);

    try {
      const addedItems: DraftPhotoItem[] = [];
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        if (!file.type.startsWith('image/')) {
          setUploadError(`El archivo «${file.name}» no es una imagen válida.`);
          continue;
        }

        const { dataUrl, mimeType } = await processAndCompressImage(file);
        addedItems.push({
          tempId: `tmp_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`,
          fileName: file.name || `Foto_${Date.now()}.jpg`,
          mimeType,
          caption: '',
          dataUrl,
          isPersisted: false,
        });
      }

      if (addedItems.length > 0) {
        onChange([...photos, ...addedItems]);
      }
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : 'Error al procesar la fotografía seleccionada.'
      );
    } finally {
      setProcessingFiles(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
    }
  };

  const handleCaptionChange = (tempId: string, newCaption: string) => {
    onChange(
      photos.map((p) => (p.tempId === tempId ? { ...p, caption: newCaption } : p))
    );
  };

  const handleRemovePhoto = async (item: DraftPhotoItem) => {
    setUploadError(null);
    if (item.isPersisted && item.id && onDeletePersistedPhoto) {
      try {
        setDeletingId(item.id);
        await onDeletePersistedPhoto(item.id);
      } catch (err) {
        setUploadError(
          err instanceof Error ? err.message : 'No se pudo eliminar la fotografía del servidor.'
        );
        setDeletingId(null);
        return;
      } finally {
        setDeletingId(null);
      }
    }
    onChange(photos.filter((p) => p.tempId !== item.tempId));
  };

  if (!isOpen) {
    return (
      <div className="pt-1 flex justify-center">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setIsOpen(true)}
          className="inline-flex items-center justify-center gap-2 text-xs font-semibold text-amber-800 hover:text-amber-950 bg-amber-50/70 hover:bg-amber-100/80 border border-amber-200/90 px-4 py-2 rounded-lg transition cursor-pointer disabled:opacity-50"
        >
          <Camera className="w-3.5 h-3.5 text-amber-700" />
          <span>Añadir fotografías o recuerdos</span>
          {photos.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-amber-200/80 text-amber-950 text-[10px] font-bold">
              {photos.length}
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl border border-stone-200 bg-stone-50/80 ${
        compact ? 'p-3.5 space-y-3' : 'p-4 space-y-3.5'
      }`}
    >
      {/* Hidden file inputs: standard file chooser and native camera capture */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFilesSelected}
        className="sr-only"
        aria-label="Seleccionar fotografías desde galería o archivo"
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFilesSelected}
        className="sr-only"
        aria-label="Tomar fotografía directamente con la cámara del dispositivo"
      />

      {/* Header with Title and Photo Options */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center space-x-2 text-xs font-bold text-stone-800">
            <Camera className="w-4 h-4 text-amber-700 shrink-0" />
            <span>{label}</span>
            {photos.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-semibold">
                {photos.length} {photos.length === 1 ? 'fotografía' : 'fotografías'}
              </span>
            )}
          </div>
        </div>

        {/* Dual Actions: Tomar Foto con Cámara, Subir Archivo y Ocultar */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {!disabled && (
            <>
              {/* 1. Tomar Foto con la Cámara */}
              <button
                type="button"
                disabled={processingFiles}
                onClick={() => handleStartCamera('environment')}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-amber-700 hover:bg-amber-800 text-white rounded-lg text-xs font-semibold shadow-xs transition disabled:opacity-50 cursor-pointer"
                title="Abrir cámara para tomar una foto en este momento"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Tomar foto</span>
              </button>

              {/* 2. Subir Archivo / Galería */}
              <button
                type="button"
                disabled={processingFiles}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-stone-100 text-stone-700 border border-stone-300 rounded-lg text-xs font-semibold shadow-2xs transition disabled:opacity-50 cursor-pointer"
                title="Seleccionar archivos desde la galería o tu dispositivo"
              >
                <ImageIcon className="w-3.5 h-3.5 text-stone-500" />
                <span>Subir archivo</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="text-xs font-semibold text-stone-500 hover:text-stone-800 underline underline-offset-2 px-1.5 py-1 cursor-pointer"
          >
            Ocultar
          </button>
        </div>
      </div>

      {uploadError && (
        <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{uploadError}</span>
        </div>
      )}

      {/* List of attached photographs with context input and delete button */}
      {photos.length > 0 && (
        <div className="space-y-3 pt-1">
          {photos.map((item, idx) => {
            const previewSrc = item.dataUrl || item.imageUrl || '';
            const missingContext = item.caption.trim().length < 3;
            const isDeleting = deletingId === item.id;

            return (
              <div
                key={item.tempId}
                className={`bg-white p-3.5 rounded-xl border transition flex flex-col sm:flex-row gap-3.5 ${
                  missingContext ? 'border-amber-300 ring-1 ring-amber-100' : 'border-stone-200'
                }`}
              >
                {/* Thumbnail Preview */}
                <div className="w-full sm:w-32 h-32 rounded-lg overflow-hidden bg-stone-100 border border-stone-200 shrink-0 flex items-center justify-center relative">
                  {previewSrc ? (
                    <img
                      src={previewSrc}
                      alt={item.caption || item.fileName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <ImageIcon className="w-6 h-6 text-stone-400" />
                  )}
                  <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/65 text-white text-[10px] font-semibold">
                    Foto #{idx + 1}
                  </span>
                </div>

                {/* Description / Context Input + Actions */}
                <div className="flex-1 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-semibold text-stone-800 truncate max-w-[200px]">
                        {item.fileName}
                      </span>
                      {item.isPersisted ? (
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-semibold">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>Guardada en el servidor</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-semibold">
                          Lista para guardar con tu respuesta
                        </span>
                      )}
                    </div>

                    {!disabled && (
                      <button
                        type="button"
                        disabled={isDeleting}
                        onClick={() => handleRemovePhoto(item)}
                        aria-label={`Eliminar fotografía ${item.fileName}`}
                        className="inline-flex items-center space-x-1 px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-[11px] font-semibold transition disabled:opacity-50 cursor-pointer"
                        title="Eliminar esta fotografía si la subiste por error"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>{isDeleting ? 'Eliminando...' : 'Eliminar fotografía'}</span>
                      </button>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor={`photo-caption-${item.tempId}`}
                      className="block text-[11px] font-semibold text-stone-700 mb-1"
                    >
                      Describe la imagen o dale contexto para el manuscrito{' '}
                      <span className="text-amber-700">*</span>
                    </label>
                    <textarea
                      id={`photo-caption-${item.tempId}`}
                      rows={2}
                      disabled={disabled}
                      placeholder="¿Quiénes aparecen, dónde y cuándo fue tomada, o qué momento de tu historia representa esta fotografía?"
                      value={item.caption}
                      onChange={(e) => handleCaptionChange(item.tempId, e.target.value)}
                      className="w-full p-2.5 border border-stone-300 rounded-lg text-xs text-stone-900 bg-white focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-600"
                    />
                    {missingContext && !disabled && (
                      <p className="text-[11px] text-amber-800 mt-1 font-medium">
                        * Por favor escribe una breve descripción o contexto de esta fotografía para ubicarla correctamente en el manuscrito.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Live Camera Viewfinder Modal */}
      {isCameraOpen && (
        <div className="fixed inset-0 z-50 bg-stone-950/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-fadeIn">
          <div className="bg-white w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl border border-stone-200 flex flex-col max-h-[92vh]">
            {/* Modal Header */}
            <div className="bg-stone-900 text-stone-100 px-4 py-3 flex items-center justify-between border-b border-stone-800">
              <div className="flex items-center space-x-2">
                <Camera className="w-4 h-4 text-amber-400" />
                <span className="font-semibold text-xs sm:text-sm">Tomar Fotografía con la Cámara</span>
              </div>
              <button
                type="button"
                onClick={handleCloseCameraModal}
                className="text-stone-400 hover:text-white p-1 rounded-md transition"
                title="Cerrar cámara"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Viewfinder / Preview Body */}
            <div className="relative bg-black flex items-center justify-center min-h-[300px] max-h-[55vh] overflow-hidden">
              <canvas ref={canvasRef} className="hidden" />

              {capturedImagePreview ? (
                <img
                  src={capturedImagePreview}
                  alt="Captura tomada"
                  className="w-full h-full object-contain max-h-[55vh]"
                />
              ) : (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-contain max-h-[55vh]"
                />
              )}

              {cameraLoading && (
                <div className="absolute inset-0 bg-stone-900/70 flex flex-col items-center justify-center text-white space-y-2">
                  <RefreshCw className="w-7 h-7 animate-spin text-amber-400" />
                  <span className="text-xs font-medium">Conectando cámara...</span>
                </div>
              )}
            </div>

            {/* Modal Footer Controls */}
            <div className="p-4 bg-stone-50 border-t border-stone-200 flex items-center justify-between gap-3">
              {capturedImagePreview ? (
                <>
                  <button
                    type="button"
                    onClick={() => setCapturedImagePreview(null)}
                    className="inline-flex items-center space-x-1.5 px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl text-xs font-semibold transition"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Repetir foto</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleConfirmCapturedPhoto}
                    className="inline-flex items-center space-x-1.5 px-5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold shadow-sm transition"
                  >
                    <Check className="w-4 h-4" />
                    <span>Usar esta fotografía</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleSwitchCameraFacing}
                    className="inline-flex items-center space-x-1 px-3 py-2 bg-stone-200 hover:bg-stone-300 text-stone-700 rounded-xl text-xs font-medium transition"
                    title="Cambiar entre cámara trasera y delantera"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Cambiar cámara</span>
                  </button>

                  {/* Main Shutter Button */}
                  <button
                    type="button"
                    onClick={handleCaptureSnapshot}
                    disabled={cameraLoading}
                    className="inline-flex items-center space-x-2 px-6 py-2.5 bg-amber-700 hover:bg-amber-800 text-white rounded-xl text-xs font-bold shadow-md transition disabled:opacity-50 cursor-pointer"
                  >
                    <Camera className="w-4 h-4" />
                    <span>Capturar Fotografía</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCloseCameraModal}
                    className="px-3 py-2 text-stone-600 hover:text-stone-900 text-xs font-medium"
                  >
                    Cancelar
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
