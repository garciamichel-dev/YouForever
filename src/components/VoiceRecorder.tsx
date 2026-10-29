import React, {
  useState,
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from 'react';
import {
  Mic,
  Pause,
  Play,
  Square,
  X,
  Send,
  Trash2,
  FileText,
  AlertCircle,
  RefreshCw,
  Sparkles,
  CheckCircle2,
  PlusCircle,
  HelpCircle,
  Upload,
  FileAudio,
  RotateCcw,
} from 'lucide-react';
import { AnswerVoiceAttachment } from '../logic/interviewRules.ts';
import { AudioPlayer } from './AudioPlayer.tsx';

export interface VoiceRecorderProps {
  token: string;
  questionId: string;
  questionText?: string;
  initialAudio?: AnswerVoiceAttachment | null;
  initialAudios?: AnswerVoiceAttachment[];
  hideSavedList?: boolean;
  onVoiceSubmitted: (
    audio: AnswerVoiceAttachment,
    transcription: string,
    allAudios: AnswerVoiceAttachment[]
  ) => void;
  onVoiceDeleted?: (audioId: string) => void;
  onRecordingStatusChange?: (isRecording: boolean) => void;
  disabled?: boolean;
}

export interface VoiceRecorderHandle {
  isRecordingOrActive: () => boolean;
  finalizeAndUpload: () => Promise<AnswerVoiceAttachment | null>;
}

type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped' | 'uploading';

export const VoiceRecorder = forwardRef<VoiceRecorderHandle, VoiceRecorderProps>(
  (
    {
      token,
      questionId,
      questionText,
      initialAudio,
      initialAudios,
      hideSavedList = false,
      onVoiceSubmitted,
      onVoiceDeleted,
      onRecordingStatusChange,
      disabled = false,
    },
    ref
  ) => {
    // Collect all initial audios (either from array or single object)
    const resolveInitialList = (): AnswerVoiceAttachment[] => {
      if (Array.isArray(initialAudios) && initialAudios.length > 0) {
        return initialAudios;
      }
      if (initialAudio) {
        return [initialAudio];
      }
      return [];
    };

    const [savedAudios, setSavedAudios] = useState<AnswerVoiceAttachment[]>(resolveInitialList);
    const [state, setState] = useState<RecorderState>('idle');
    const [timerSeconds, setTimerSeconds] = useState(0);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [liveTranscription, setLiveTranscription] = useState('');
    const [previewAudioUrl, setPreviewAudioUrl] = useState<string | null>(null);
    const [previewAudioName, setPreviewAudioName] = useState<string | null>(null);
    const [deletingAudioId, setDeletingAudioId] = useState<string | null>(null);
    const [confirmDeleteTarget, setConfirmDeleteTarget] = useState<AnswerVoiceAttachment | null>(null);

    // References for media capture & file inputs
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const audioStreamRef = useRef<MediaStream | null>(null);
    const timerIntervalRef = useRef<number | null>(null);
    const speechRecognitionRef = useRef<any>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const animFrameRef = useRef<number | null>(null);
    const [volumeLevel, setVolumeLevel] = useState<number>(0);
    const finalRecordedBlobRef = useRef<Blob | null>(null);

    const audioFileInputRef = useRef<HTMLInputElement | null>(null);
    const nativeAudioInputRef = useRef<HTMLInputElement | null>(null);

    // Sync when initial audios change or question changes
    useEffect(() => {
      const list = resolveInitialList();
      setSavedAudios(list);
      cleanupResources();
      setState('idle');
      setTimerSeconds(0);
      setLiveTranscription('');
      setErrorMsg(null);
      setPreviewAudioName(null);
      if (previewAudioUrl) {
        URL.revokeObjectURL(previewAudioUrl);
        setPreviewAudioUrl(null);
      }
    }, [questionId, initialAudio?.id, JSON.stringify(initialAudios?.map((a) => a.id))]);

    // Notify parent if recording is active
    useEffect(() => {
      const isActive = state === 'recording' || state === 'paused';
      if (onRecordingStatusChange) {
        onRecordingStatusChange(isActive);
      }
    }, [state, onRecordingStatusChange]);

    // Cleanup on unmount or question change
    useEffect(() => {
      return () => {
        cleanupResources();
      };
    }, [questionId]);

    const cleanupResources = () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      if (speechRecognitionRef.current) {
        try {
          speechRecognitionRef.current.stop();
        } catch {
          // ignore
        }
        speechRecognitionRef.current = null;
      }
      if (audioStreamRef.current) {
        try {
          audioStreamRef.current.getTracks().forEach((t) => t.stop());
        } catch {
          // ignore
        }
        audioStreamRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        try {
          audioContextRef.current.close();
        } catch {
          // ignore
        }
        audioContextRef.current = null;
      }
    };

    // Setup sound level analyzer
    const setupAudioAnalyzer = (stream: MediaStream) => {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextClass) return;

        const audioCtx = new AudioContextClass();
        audioContextRef.current = audioCtx;
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        analyserRef.current = analyser;

        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const updateVolume = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length;
          setVolumeLevel(Math.min(100, Math.round((avg / 128) * 100)));
          animFrameRef.current = requestAnimationFrame(updateVolume);
        };

        updateVolume();
      } catch (err) {
        console.warn('Audio analyzer not supported:', err);
      }
    };

    // Best supported audio MIME type
    const getOptimalMimeType = (): string => {
      const candidateTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
        'audio/ogg',
      ];
      for (const t of candidateTypes) {
        if (
          typeof MediaRecorder !== 'undefined' &&
          MediaRecorder.isTypeSupported &&
          MediaRecorder.isTypeSupported(t)
        ) {
          return t;
        }
      }
      return '';
    };

    // Start Voice Recording with progressive constraints and non-fatal fallback
    const handleStartRecording = async () => {
      setErrorMsg(null);
      setLiveTranscription('');
      setPreviewAudioName(null);
      audioChunksRef.current = [];
      finalRecordedBlobRef.current = null;
      if (previewAudioUrl) {
        URL.revokeObjectURL(previewAudioUrl);
        setPreviewAudioUrl(null);
      }

      if (typeof window === 'undefined' || !navigator?.mediaDevices?.getUserMedia) {
        setErrorMsg(
          'Tu navegador o dispositivo no soporta grabación en vivo de audio. Puedes subir un archivo de audio o nota de voz directamente.'
        );
        return;
      }

      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
        } catch (initialErr: any) {
          // If permission is explicitly blocked or denied, don't retry constraints; throw to catch block
          if (
            initialErr?.name === 'NotAllowedError' ||
            initialErr?.name === 'PermissionDeniedError' ||
            initialErr?.name === 'SecurityError'
          ) {
            throw initialErr;
          }
          // Otherwise try simple unconstrained audio
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }

        audioStreamRef.current = stream;
        setupAudioAnalyzer(stream);

        if (typeof MediaRecorder === 'undefined') {
          throw new Error('MediaRecorder no está disponible en este navegador.');
        }

        const mimeType = getOptimalMimeType();
        let mediaRecorder: MediaRecorder;
        try {
          mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        } catch {
          mediaRecorder = new MediaRecorder(stream);
        }
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        mediaRecorder.onstop = () => {
          const mime = mediaRecorder.mimeType || 'audio/webm';
          const finalBlob = new Blob(audioChunksRef.current, { type: mime });
          finalRecordedBlobRef.current = finalBlob;
          const previewUrl = URL.createObjectURL(finalBlob);
          setPreviewAudioUrl(previewUrl);
        };

        // Real-time Spanish speech recognition preview
        const SpeechRecognition =
          (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecognition) {
          try {
            const recognition = new SpeechRecognition();
            recognition.lang = 'es-ES';
            recognition.continuous = true;
            recognition.interimResults = true;

            recognition.onresult = (e: any) => {
              let fullText = '';
              for (let i = 0; i < e.results.length; i++) {
                fullText += e.results[i][0].transcript + ' ';
              }
              setLiveTranscription(fullText.trim());
            };

            recognition.onerror = () => {
              // Non-fatal
            };

            recognition.start();
            speechRecognitionRef.current = recognition;
          } catch {
            // Non-fatal
          }
        }

        mediaRecorder.start(250);
        setTimerSeconds(0);
        setState('recording');

        timerIntervalRef.current = window.setInterval(() => {
          setTimerSeconds((prev) => prev + 1);
        }, 1000);
      } catch (err: any) {
        cleanupResources();
        const errMsg = err?.message || '';
        const isNotAllowed =
          err?.name === 'NotAllowedError' ||
          err?.name === 'PermissionDeniedError' ||
          err?.name === 'SecurityError' ||
          errMsg.toLowerCase().includes('not allowed');

        if (isNotAllowed) {
          console.warn('[VoiceRecorder] Permiso de micrófono no otorgado o restringido por la plataforma:', errMsg);
          setErrorMsg(
            'El acceso al micrófono no está permitido en este navegador o entorno (por ejemplo, en un marco embebido o permisos bloqueados). Puedes subir directamente una nota de voz o archivo de audio (.mp3, .m4a, .wav, .webm, .ogg) desde tu dispositivo.'
          );
        } else if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
          console.warn('[VoiceRecorder] No se encontró micrófono en el dispositivo:', errMsg);
          setErrorMsg(
            'No se encontró ningún micrófono conectado en tu dispositivo. Puedes subir una nota de voz o archivo de audio grabado previamente.'
          );
        } else {
          console.warn('[VoiceRecorder] Error al iniciar grabador:', errMsg);
          setErrorMsg(
            `No se pudo iniciar la grabación con micrófono (${errMsg || 'error del navegador'}). Puedes subir tu archivo de audio directamente.`
          );
        }
      }
    };

    // Handler for uploading an audio file / voice memo directly
    const handleAudioFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setErrorMsg(null);
      // Maximum 14MB to fit within server JSON limit
      if (file.size > 14 * 1024 * 1024) {
        setErrorMsg(
          'El archivo de audio supera el límite de 14 MB. Por favor selecciona una nota de voz de menor duración o tamaño.'
        );
        if (e.target) e.target.value = '';
        return;
      }

      cleanupResources();
      audioChunksRef.current = [];
      finalRecordedBlobRef.current = file;
      setPreviewAudioName(file.name);

      if (previewAudioUrl) {
        URL.revokeObjectURL(previewAudioUrl);
      }
      const previewUrl = URL.createObjectURL(file);
      setPreviewAudioUrl(previewUrl);

      // Estimate / measure audio duration using temporary Audio element
      let detectedDuration = 0;
      try {
        const tempAudio = document.createElement('audio');
        tempAudio.src = previewUrl;
        await new Promise<void>((resolve) => {
          tempAudio.onloadedmetadata = () => {
            if (Number.isFinite(tempAudio.duration) && tempAudio.duration > 0) {
              detectedDuration = Math.round(tempAudio.duration);
            }
            resolve();
          };
          tempAudio.onerror = () => resolve();
          setTimeout(resolve, 800);
        });
      } catch {
        // Non-fatal
      }

      setTimerSeconds(detectedDuration || Math.max(1, Math.round(file.size / 24000)));
      setState('stopped');
      if (e.target) e.target.value = '';
    };

    // 1. Control: PAUSA
    const handlePause = () => {
      if (!mediaRecorderRef.current || state !== 'recording') return;

      try {
        mediaRecorderRef.current.pause();
        if (timerIntervalRef.current) {
          clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
        }
        if (speechRecognitionRef.current) {
          try {
            speechRecognitionRef.current.stop();
          } catch {
            // ignore
          }
        }
        setState('paused');
      } catch (err) {
        console.warn('Error pausing recorder:', err);
      }
    };

    // 2. Control: CONTINUAR
    const handleResume = () => {
      if (!mediaRecorderRef.current || state !== 'paused') return;

      try {
        mediaRecorderRef.current.resume();
        timerIntervalRef.current = window.setInterval(() => {
          setTimerSeconds((prev) => prev + 1);
        }, 1000);

        if (speechRecognitionRef.current) {
          try {
            speechRecognitionRef.current.start();
          } catch {
            // ignore
          }
        }

        setState('recording');
      } catch (err) {
        console.warn('Error resuming recorder:', err);
      }
    };

    // 3. Control: CANCELAR
    const handleCancel = () => {
      cleanupResources();
      audioChunksRef.current = [];
      finalRecordedBlobRef.current = null;
      if (previewAudioUrl) {
        URL.revokeObjectURL(previewAudioUrl);
        setPreviewAudioUrl(null);
      }
      setPreviewAudioName(null);
      setTimerSeconds(0);
      setLiveTranscription('');
      setErrorMsg(null);
      setState('idle');
    };

    // Stops recording cleanly and returns Promise that resolves with final Blob
    const stopRecordingAndGetBlob = (): Promise<Blob | null> => {
      return new Promise((resolve) => {
        const rec = mediaRecorderRef.current;
        if (!rec || rec.state === 'inactive') {
          resolve(finalRecordedBlobRef.current);
          return;
        }

        rec.onstop = () => {
          const mime = rec.mimeType || 'audio/webm';
          const blob = new Blob(audioChunksRef.current, { type: mime });
          finalRecordedBlobRef.current = blob;
          const previewUrl = URL.createObjectURL(blob);
          setPreviewAudioUrl(previewUrl);
          resolve(blob);
        };

        try {
          rec.stop();
        } catch {
          resolve(finalRecordedBlobRef.current);
        }
      });
    };

    // 4. Control: FINALIZAR (Stop and allow preview)
    const handleStopAndFinalize = async () => {
      if (state !== 'recording' && state !== 'paused') return;

      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      setVolumeLevel(0);

      if (speechRecognitionRef.current) {
        try {
          speechRecognitionRef.current.stop();
        } catch {
          // ignore
        }
      }

      await stopRecordingAndGetBlob();

      if (audioStreamRef.current) {
        try {
          audioStreamRef.current.getTracks().forEach((t) => t.stop());
        } catch {
          // ignore
        }
        audioStreamRef.current = null;
      }

      setState('stopped');
    };

    // 5. Control: ENVIAR & TRANSCRIBIR (works while recording, paused, or stopped)
    const handleSend = async (): Promise<AnswerVoiceAttachment | null> => {
      let audioBlob = finalRecordedBlobRef.current;

      // If active recording or paused, finalize deterministically first
      if (state === 'recording' || state === 'paused') {
        if (timerIntervalRef.current) {
          clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
        }
        if (animFrameRef.current) {
          cancelAnimationFrame(animFrameRef.current);
          animFrameRef.current = null;
        }
        setVolumeLevel(0);

        if (speechRecognitionRef.current) {
          try {
            speechRecognitionRef.current.stop();
          } catch {
            // ignore
          }
        }

        audioBlob = await stopRecordingAndGetBlob();

        if (audioStreamRef.current) {
          try {
            audioStreamRef.current.getTracks().forEach((t) => t.stop());
          } catch {
            // ignore
          }
          audioStreamRef.current = null;
        }
      }

      if (!audioBlob || audioBlob.size === 0) {
        setErrorMsg('No hay ningún archivo de audio grabado o seleccionado para enviar.');
        return null;
      }

      try {
        setState('uploading');
        setErrorMsg(null);

        // Convert blob to Base64
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve, reject) => {
          reader.onloadend = () => {
            const res = reader.result as string;
            resolve(res);
          };
          reader.onerror = reject;
        });
        reader.readAsDataURL(audioBlob);
        const audioBase64 = await base64Promise;

        const duration = timerSeconds > 0 ? timerSeconds : 1;
        const capturedSpeech = liveTranscription.trim();

        // Send to server: persists voice recording, transcribes with Gemini, saves in Firestore
        const res = await fetch('/api/participant/audio/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            questionId,
            questionText: questionText || '',
            audioBase64,
            mimeType: audioBlob.type || 'audio/webm',
            durationSeconds: duration,
            clientTranscription: capturedSpeech,
          }),
        });

        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || 'Error al guardar el archivo de voz.');
        }

        const returnedTranscription =
          (data.data.transcription || '').trim() || capturedSpeech;

        const audioAttachment: AnswerVoiceAttachment = {
          id: data.data.id,
          interviewId: '',
          questionId,
          questionText,
          participantId: '',
          participantName: '',
          audioUrl: data.data.audioUrl,
          audioDataUrl: data.data.audioDataUrl || audioBase64,
          mimeType: data.data.mimeType,
          transcription: returnedTranscription,
          durationSeconds: data.data.durationSeconds,
          createdAt: data.data.createdAt,
        };

        // Append to savedAudios array so all previous voice files are preserved
        const nextAudios = [...savedAudios.filter((a) => a.id !== audioAttachment.id), audioAttachment];
        setSavedAudios(nextAudios);

        // Reset recorder state to idle ready to record another note if desired
        setState('idle');
        setTimerSeconds(0);
        setLiveTranscription('');
        setPreviewAudioName(null);
        finalRecordedBlobRef.current = null;
        audioChunksRef.current = [];
        if (previewAudioUrl) {
          URL.revokeObjectURL(previewAudioUrl);
          setPreviewAudioUrl(null);
        }

        // Notify parent callback with newly created audio and the updated list
        onVoiceSubmitted(audioAttachment, returnedTranscription, nextAudios);

        return audioAttachment;
      } catch (err: any) {
        console.warn('Error uploading voice recording:', err);
        setErrorMsg(err.message || 'Error de conexión al enviar el archivo de voz.');
        setState('stopped');
        return null;
      }
    };

    // Expose handle to parent component via forwardRef
    useImperativeHandle(ref, () => ({
      isRecordingOrActive: () =>
        state === 'recording' || state === 'paused' || state === 'stopped',
      finalizeAndUpload: handleSend,
    }));

    // Delete single audio with confirmation
    const handleConfirmDelete = async () => {
      if (!confirmDeleteTarget) return;

      const audioId = confirmDeleteTarget.id;
      try {
        setDeletingAudioId(audioId);
        setErrorMsg(null);

        const res = await fetch(`/api/participant/audio/${audioId}/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || 'Error al eliminar la grabación.');
        }

        const nextList = savedAudios.filter((a) => a.id !== audioId);
        setSavedAudios(nextList);

        if (onVoiceDeleted) {
          onVoiceDeleted(audioId);
        }

        setConfirmDeleteTarget(null);
      } catch (err: any) {
        setErrorMsg(err.message || 'No se pudo eliminar el archivo de voz.');
      } finally {
        setDeletingAudioId(null);
      }
    };

    const formatTimer = (totalSec: number) => {
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    return (
      <div className="w-full space-y-4">
        {/* Hidden inputs for audio upload and native device recording fallback */}
        <input
          ref={audioFileInputRef}
          type="file"
          accept="audio/*,.mp3,.m4a,.wav,.ogg,.webm,.aac,.flac,.caf,.opus,.wma"
          onChange={handleAudioFileSelected}
          className="sr-only"
          aria-label="Seleccionar archivo de audio o nota de voz"
        />
        <input
          ref={nativeAudioInputRef}
          type="file"
          accept="audio/*"
          capture={true}
          onChange={handleAudioFileSelected}
          className="sr-only"
          aria-label="Grabar audio con el micrófono nativo del dispositivo"
        />

        {/* Main active recorder container */}
        <div className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 transition-all shadow-sm">
          {/* Header bar */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  state === 'recording'
                    ? 'bg-rose-100 text-rose-600 animate-pulse'
                    : state === 'paused'
                    ? 'bg-amber-100 text-amber-700'
                    : state === 'stopped'
                    ? 'bg-indigo-100 text-indigo-700'
                    : state === 'uploading'
                    ? 'bg-indigo-100 text-indigo-700'
                    : savedAudios.length > 0
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-indigo-100 text-indigo-700'
                }`}
              >
                <Mic className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                  Respuesta por Nota de Voz
                  {savedAudios.length > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                      <CheckCircle2 className="w-3 h-3" /> {savedAudios.length}{' '}
                      {savedAudios.length === 1 ? 'audio guardado' : 'audios guardados'}
                    </span>
                  )}
                </h4>
                <p className="text-xs text-slate-600">
                  {state === 'idle' &&
                    (savedAudios.length > 0
                      ? 'Puedes grabar o subir notas de voz adicionales para complementar tu respuesta.'
                      : 'Graba tu testimonio con el micrófono o sube una nota de voz. Se guardará el audio y la transcripción completa.')}
                  {state === 'recording' && 'Grabando audio... Habla con naturalidad.'}
                  {state === 'paused' && 'Grabación en pausa. Puedes continuar cuando lo desees.'}
                  {state === 'stopped' && 'Audio listo. Escucha la vista previa y pulsa «Enviar y Transcribir».'}
                  {state === 'uploading' && 'Guardando archivo de voz y transcribiendo con IA...'}
                </p>
              </div>
            </div>

            {/* Live Timer badge */}
            {(state === 'recording' || state === 'paused' || state === 'stopped') && (
              <div className="flex items-center gap-2 bg-white px-3 py-1 rounded-full border border-slate-200 shadow-xs">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    state === 'recording'
                      ? 'bg-rose-500 animate-ping'
                      : state === 'paused'
                      ? 'bg-amber-500'
                      : 'bg-indigo-500'
                  }`}
                />
                <span className="font-mono text-xs font-semibold text-slate-800">
                  {formatTimer(timerSeconds)}
                </span>
              </div>
            )}
          </div>

          {/* Error notification banner with recovery actions */}
          {errorMsg && (
            <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
              <div className="flex items-start gap-2 text-xs text-amber-900 leading-relaxed">
                <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                <span className="flex-1">{errorMsg}</span>
                <button
                  type="button"
                  onClick={() => setErrorMsg(null)}
                  className="text-amber-500 hover:text-amber-800 p-0.5 rounded cursor-pointer"
                  title="Cerrar aviso"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1 pl-6">
                <button
                  type="button"
                  onClick={() => audioFileInputRef.current?.click()}
                  disabled={disabled}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-xs transition cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Subir archivo de audio o nota de voz
                </button>
                <button
                  type="button"
                  onClick={handleStartRecording}
                  disabled={disabled}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 text-xs font-semibold rounded-lg transition cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Reintentar micrófono
                </button>
              </div>
            </div>
          )}

          {/* 1. STATE: IDLE (Dual options: Live Mic or Upload Audio) */}
          {state === 'idle' && (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                {/* Live Microphone Recording */}
                <button
                  type="button"
                  onClick={handleStartRecording}
                  disabled={disabled}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg shadow-sm transition-colors cursor-pointer"
                >
                  <Mic className="w-4 h-4" />
                  {savedAudios.length > 0 ? 'Grabar con micrófono' : 'Grabar con micrófono'}
                </button>

                {/* Upload Audio File / Voice Memo */}
                <button
                  type="button"
                  onClick={() => audioFileInputRef.current?.click()}
                  disabled={disabled}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg shadow-xs transition-colors cursor-pointer"
                  title="Subir archivo de audio o nota de voz (.mp3, .m4a, .wav, .ogg, .webm)"
                >
                  <Upload className="w-4 h-4 text-slate-500" />
                  Subir nota de voz o audio
                </button>
              </div>

              <span className="text-xs text-slate-500 text-center sm:text-right">
                Puedes grabar en vivo o subir un archivo. Al pulsar «Enviar», se guardará y transcribirá con IA.
              </span>
            </div>
          )}

          {/* 2. STATE: RECORDING or PAUSED (The 5 Controls) */}
          {(state === 'recording' || state === 'paused') && (
            <div className="space-y-3">
              {/* Sound Wave Visualizer */}
              <div className="bg-slate-900 rounded-lg p-3 flex items-center justify-center gap-1.5 h-14 overflow-hidden shadow-inner">
                {[20, 45, 80, 60, 30, 95, 70, 40, 85, 55, 35, 90, 65, 45, 75, 30, 60, 85, 40, 70].map(
                  (baseHeight, idx) => {
                    const dynamicHeight =
                      state === 'recording'
                        ? Math.max(12, Math.min(46, (baseHeight * (volumeLevel + 20)) / 100))
                        : 10;
                    return (
                      <div
                        key={idx}
                        style={{ height: `${dynamicHeight}px` }}
                        className={`w-1.5 rounded-full transition-all duration-75 ${
                          state === 'recording' ? 'bg-indigo-400' : 'bg-slate-600'
                        }`}
                      />
                    );
                  }
                )}
              </div>

              {/* Real-time speech preview */}
              {liveTranscription && (
                <div className="p-2.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-600 italic">
                  <span className="font-semibold not-italic text-slate-700">Detectando voz: </span>«
                  {liveTranscription}»
                </div>
              )}

              {/* CONTROLES: Pausar / Continuar, Finalizar, Cancelar, Enviar y Transcribir */}
              <div className="bg-white p-3 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-2 shadow-xs">
                <div className="flex flex-wrap items-center gap-2">
                  {/* PAUSAR (visible al estar grabando) */}
                  {state === 'recording' && (
                    <button
                      type="button"
                      onClick={handlePause}
                      disabled={disabled}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-amber-100 text-amber-900 hover:bg-amber-200 border border-amber-300 transition-colors cursor-pointer"
                      title="Pausar temporalmente la nota de voz"
                    >
                      <Pause className="w-3.5 h-3.5" />
                      Pausar
                    </button>
                  )}

                  {/* CONTINUAR (visible cuando está en pausa) */}
                  {state === 'paused' && (
                    <button
                      type="button"
                      onClick={handleResume}
                      disabled={disabled}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs transition-colors cursor-pointer"
                      title="Continuar la grabación en el punto donde se quedó"
                    >
                      <Play className="w-3.5 h-3.5" />
                      Continuar
                    </button>
                  )}

                  {/* FINALIZAR PARA ESCUCHAR (detiene grabación y pasa a vista previa) */}
                  <button
                    type="button"
                    onClick={handleStopAndFinalize}
                    disabled={disabled}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-100 text-slate-800 hover:bg-slate-200 border border-slate-300 transition-colors cursor-pointer"
                    title="Detener grabación para escucharla antes de enviar"
                  >
                    <Square className="w-3.5 h-3.5 fill-slate-700" />
                    Finalizar y escuchar
                  </button>

                  {/* CANCELAR (cancela la grabación y descarta) */}
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={disabled}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-600 hover:text-rose-700 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 rounded-lg transition-colors cursor-pointer"
                    title="Cancelar grabación y descartar sin guardar nada"
                  >
                    <X className="w-3.5 h-3.5" />
                    Cancelar
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {/* ENVIAR Y TRANSCRIBIR */}
                  <button
                    type="button"
                    onClick={() => handleSend()}
                    disabled={disabled}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-all transform hover:scale-[1.02] cursor-pointer"
                    title="Finalizar grabación, guardar en base de datos y transcribir con IA"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Enviar y Transcribir
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 3. STATE: STOPPED (Preview mode before upload) */}
          {state === 'stopped' && (
            <div className="space-y-3">
              {previewAudioUrl && (
                <div className="bg-white p-3.5 rounded-xl border border-indigo-200 shadow-xs space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                      <FileAudio className="w-4 h-4 text-indigo-600" />
                      {previewAudioName || 'Audio listo para enviar y transcribir'}
                    </span>
                    <span className="text-slate-500 font-mono text-[11px]">
                      Duración: {formatTimer(timerSeconds)}
                    </span>
                  </div>

                  <AudioPlayer
                    audioUrl={previewAudioUrl}
                    durationSeconds={timerSeconds}
                    title={previewAudioName || 'Vista previa del audio'}
                  />

                  {liveTranscription && (
                    <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 italic">
                      <span className="font-semibold not-italic text-slate-700">Transcripción en vivo: </span>«
                      {liveTranscription}»
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={handleCancel}
                      disabled={disabled}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Descartar y grabar/subir otro
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSend()}
                      disabled={disabled}
                      className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-all transform hover:scale-[1.02] cursor-pointer"
                    >
                      <Send className="w-4 h-4" />
                      Enviar y Transcribir con IA
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 4. STATE: UPLOADING / TRANSCRIBING */}
          {state === 'uploading' && (
            <div className="py-6 px-4 bg-white border border-slate-200 rounded-xl flex flex-col items-center justify-center text-center space-y-3">
              <div className="relative">
                <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
                <Sparkles className="w-4 h-4 text-amber-500 absolute -top-1 -right-1 animate-bounce" />
              </div>
              <div>
                <h5 className="text-sm font-semibold text-slate-900">
                  Guardando archivo de voz en la base de datos...
                </h5>
                <p className="text-xs text-slate-500 mt-1">
                  Transcribiendo testimonio con inteligencia artificial en español y vinculándolo a tu respuesta.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* LIST OF ALL SAVED VOICE RECORDINGS FOR THIS QUESTION (hidden if hideSavedList is true) */}
        {!hideSavedList && savedAudios.length > 0 && (
          <SavedVoiceAudiosList
            audios={savedAudios}
            disabled={disabled}
            onDelete={async (id) => {
              const target = savedAudios.find((a) => a.id === id);
              if (target) setConfirmDeleteTarget(target);
            }}
          />
        )}

        {/* Confirmation Modal for Audio Deletion */}
        {confirmDeleteTarget && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-slate-200">
              <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center text-rose-600 mx-auto">
                <Trash2 className="w-6 h-6" />
              </div>

              <div className="text-center space-y-2">
                <h3 className="text-base font-bold text-slate-900">
                  ¿Confirmas eliminar este archivo de voz?
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Esta acción eliminará permanentemente la grabación de audio de la base de datos del servidor.
                </p>
                {confirmDeleteTarget.transcription && (
                  <p className="text-xs text-slate-500 italic bg-slate-50 p-2 rounded-lg border border-slate-200 text-left line-clamp-2">
                    «{confirmDeleteTarget.transcription}»
                  </p>
                )}
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteTarget(null)}
                  disabled={deletingAudioId !== null}
                  className="flex-1 px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={deletingAudioId !== null}
                  className="flex-1 px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition flex items-center justify-center gap-1.5"
                >
                  {deletingAudioId === confirmDeleteTarget.id ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Eliminando...
                    </>
                  ) : (
                    'Sí, eliminar de la BDD'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
);

export interface SavedVoiceAudiosListProps {
  audios: AnswerVoiceAttachment[];
  disabled?: boolean;
  onDelete?: (audioId: string) => void;
}

export const SavedVoiceAudiosList: React.FC<SavedVoiceAudiosListProps> = ({
  audios,
  disabled = false,
  onDelete,
}) => {
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState<AnswerVoiceAttachment | null>(null);
  const [deletingAudioId, setDeletingAudioId] = useState<string | null>(null);

  const handleConfirmDelete = async () => {
    if (!confirmDeleteTarget) return;
    const id = confirmDeleteTarget.id;
    try {
      setDeletingAudioId(id);
      if (onDelete) {
        await onDelete(id);
      }
      setConfirmDeleteTarget(null);
    } finally {
      setDeletingAudioId(null);
    }
  };

  if (!audios || audios.length === 0) return null;

  return (
    <div className="space-y-3 bg-white border border-emerald-200 rounded-xl p-4 shadow-xs">
      <div className="flex items-center justify-between pb-2 border-b border-emerald-100">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
          <h5 className="text-xs font-bold uppercase tracking-wider text-emerald-900">
            Archivos de voz guardados ({audios.length})
          </h5>
        </div>
        <span className="text-[11px] text-emerald-700 font-medium">
          Disponibles para reproducción permanente y consulta
        </span>
      </div>

      <div className="space-y-3">
        {audios.map((audioItem, idx) => (
          <div
            key={audioItem.id || idx}
            className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2 relative group hover:border-indigo-300 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-indigo-100 text-indigo-900">
                <Mic className="w-3.5 h-3.5 text-indigo-600" />
                Nota de voz #{idx + 1}
                {audioItem.durationSeconds ? ` (${audioItem.durationSeconds}s)` : ''}
              </span>

              {onDelete && (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteTarget(audioItem)}
                  disabled={deletingAudioId === audioItem.id || disabled}
                  className="inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-800 font-medium px-2 py-1 rounded-md hover:bg-rose-50 transition cursor-pointer"
                  title="Eliminar este archivo de voz"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Eliminar
                </button>
              )}
            </div>

            <AudioPlayer
              audioUrl={audioItem.audioUrl}
              audioDataUrl={audioItem.audioDataUrl}
              durationSeconds={audioItem.durationSeconds}
              transcription={audioItem.transcription}
              title={`Nota de voz ${idx + 1}`}
            />
          </div>
        ))}
      </div>

      {confirmDeleteTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-slate-200">
            <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center text-rose-600 mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-base font-bold text-slate-900">
                ¿Confirmas eliminar este archivo de voz?
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Esta acción eliminará permanentemente la grabación de audio de la base de datos del servidor.
              </p>
              {confirmDeleteTarget.transcription && (
                <p className="text-xs text-slate-500 italic bg-slate-50 p-2 rounded-lg border border-slate-200 text-left line-clamp-2">
                  «{confirmDeleteTarget.transcription}»
                </p>
              )}
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteTarget(null)}
                disabled={deletingAudioId !== null}
                className="flex-1 px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deletingAudioId !== null}
                className="flex-1 px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition flex items-center justify-center gap-1.5"
              >
                {deletingAudioId === confirmDeleteTarget.id ? 'Eliminando...' : 'Sí, eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
