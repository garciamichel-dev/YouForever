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

export interface VoiceQualityDiagnosis {
  audioQuality: 'clear' | 'noisy' | 'unintelligible' | 'silent';
  qualityWarning?: string;
  suggestion?: string;
}

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
    allAudios: AnswerVoiceAttachment[],
    diagnosis?: VoiceQualityDiagnosis
  ) => void;
  onVoiceDeleted?: (audioId: string) => void;
  onRecordingStatusChange?: (isRecording: boolean) => void;
  onFocusKeyboard?: () => void;
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
      onFocusKeyboard,
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
    const [thirtySecAlert, setThirtySecAlert] = useState<{
      title: string;
      message: string;
      suggestion: string;
    } | null>(null);
    const [qualityAlert, setQualityAlert] = useState<{
      audioQuality: 'noisy' | 'unintelligible' | 'silent';
      warning: string;
      suggestion: string;
    } | null>(null);
    const [previewAudioUrl, setPreviewAudioUrl] = useState<string | null>(null);
    const [previewAudioName, setPreviewAudioName] = useState<string | null>(null);
    const [deletingAudioId, setDeletingAudioId] = useState<string | null>(null);
    const [confirmDeleteTarget, setConfirmDeleteTarget] = useState<AnswerVoiceAttachment | null>(null);

    // References for media capture & file inputs
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const audioStreamRef = useRef<MediaStream | null>(null);
    const timerIntervalRef = useRef<number | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const animFrameRef = useRef<number | null>(null);
    const [volumeLevel, setVolumeLevel] = useState<number>(0);
    const finalRecordedBlobRef = useRef<Blob | null>(null);

    // Live Speech & Acoustic Intelligibility Monitors (for 30-second check)
    const speechRecognitionRef = useRef<any>(null);
    const speechRecognitionSupportedRef = useRef<boolean>(false);
    const legibleWordsCountRef = useRef<number>(0);
    const liveClientTranscriptRef = useRef<string>('');
    const vocalModulationFramesRef = useRef<number>(0);
    const backgroundNoiseFramesRef = useRef<number>(0);
    const thirtySecCheckTriggeredRef = useRef<boolean>(false);

    const audioFileInputRef = useRef<HTMLInputElement | null>(null);
    const nativeAudioInputRef = useRef<HTMLInputElement | null>(null);

    // Sync when initial audios change or question changes
    useEffect(() => {
      const list = resolveInitialList();
      setSavedAudios(list);
      cleanupResources();
      setState('idle');
      setTimerSeconds(0);
      setErrorMsg(null);
      setThirtySecAlert(null);
      setQualityAlert(null);
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

    const stopLiveSpeechMonitor = () => {
      if (speechRecognitionRef.current) {
        try {
          speechRecognitionRef.current.onend = null;
          speechRecognitionRef.current.stop();
        } catch {
          // ignore
        }
        speechRecognitionRef.current = null;
      }
    };

    const startLiveSpeechMonitor = () => {
      if (typeof window === 'undefined') return;
      const SpeechRec =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRec) {
        speechRecognitionSupportedRef.current = false;
        return;
      }

      try {
        stopLiveSpeechMonitor();
        const recognition = new SpeechRec();
        recognition.lang = 'es-MX';
        recognition.continuous = true;
        recognition.interimResults = true;
        speechRecognitionSupportedRef.current = true;

        recognition.onresult = (event: any) => {
          let fullTranscript = '';
          for (let i = 0; i < event.results.length; i++) {
            const piece = event.results[i][0]?.transcript || '';
            fullTranscript += ' ' + piece;
          }
          const clean = fullTranscript.trim();
          const words = clean
            .split(/\s+/)
            .map((w: string) => w.replace(/[^a-záéíóúüñA-ZÁÉÍÓÚÜÑ]/g, ''))
            .filter((w: string) => w.length >= 2);

          if (words.length > 0) {
            legibleWordsCountRef.current = Math.max(legibleWordsCountRef.current, words.length);
            liveClientTranscriptRef.current = clean;
          }
        };

        recognition.onerror = () => {
          // If browser blocks or fails speech recognition, fall back to spectral modulation check
          speechRecognitionSupportedRef.current = false;
        };

        recognition.start();
        speechRecognitionRef.current = recognition;
      } catch {
        speechRecognitionSupportedRef.current = false;
      }
    };

    const cleanupResources = () => {
      stopLiveSpeechMonitor();
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
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

    // Setup sound level and voice intelligibility analyzer
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
          let voiceBandSum = 0;
          let edgeNoiseSum = 0;
          const len = dataArray.length;

          for (let i = 0; i < len; i++) {
            const val = dataArray[i];
            sum += val;
            if (i >= 2 && i <= 14) {
              voiceBandSum += val;
            } else {
              edgeNoiseSum += val;
            }
          }
          const avg = sum / len;
          const voiceAvg = voiceBandSum / 13;
          const noiseAvg = edgeNoiseSum / Math.max(1, len - 13);

          // Detect modulated human voice vs flat background noise or silence
          if (voiceAvg > 28 && voiceAvg - noiseAvg > 14) {
            vocalModulationFramesRef.current += 1;
          } else if (noiseAvg > 32) {
            backgroundNoiseFramesRef.current += 1;
          }

          setVolumeLevel(Math.min(100, Math.round((avg / 128) * 100)));
          animFrameRef.current = requestAnimationFrame(updateVolume);
        };

        updateVolume();
      } catch (_err) {
        // Audio analyzer not supported
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
      setThirtySecAlert(null);
      setQualityAlert(null);
      setPreviewAudioName(null);
      audioChunksRef.current = [];
      finalRecordedBlobRef.current = null;
      legibleWordsCountRef.current = 0;
      liveClientTranscriptRef.current = '';
      vocalModulationFramesRef.current = 0;
      backgroundNoiseFramesRef.current = 0;
      thirtySecCheckTriggeredRef.current = false;

      if (previewAudioUrl) {
        URL.revokeObjectURL(previewAudioUrl);
        setPreviewAudioUrl(null);
      }

      if (typeof window === 'undefined' || !navigator?.mediaDevices?.getUserMedia) {
        setErrorMsg(
          'Tu navegador o dispositivo no soporta grabación en vivo de audio. Puedes subir un archivo de audio o escribir tu respuesta directamente usando el teclado.'
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
        startLiveSpeechMonitor();

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
          setErrorMsg(
            'El acceso al micrófono no está permitido en este navegador. Puedes subir un archivo de audio o escribir tu respuesta por tu cuenta usando el teclado.'
          );
        } else if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
          setErrorMsg(
            'No se encontró ningún micrófono conectado en tu dispositivo. Puedes subir una nota de voz o escribir tu respuesta por tu cuenta usando el teclado.'
          );
        } else {
          setErrorMsg(
            `No se pudo iniciar la grabación con micrófono (${errMsg || 'error del navegador'}). Puedes subir tu archivo de audio o escribir tu respuesta usando el teclado.`
          );
        }
      }
    };

    // Handler for uploading an audio file / voice memo directly
    const handleAudioFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setErrorMsg(null);
      setThirtySecAlert(null);
      setQualityAlert(null);
      // Maximum 50MB (supports recordings of 10-30+ minutes)
      if (file.size > 50 * 1024 * 1024) {
        setErrorMsg(
          'El archivo de audio supera el límite de 50 MB. Por favor selecciona una nota de voz de menor tamaño.'
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
        stopLiveSpeechMonitor();
        if (mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.pause();
        }
        if (timerIntervalRef.current) {
          clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
        }
        setState('paused');
      } catch (_err) {
        // ignore
      }
    };

    // 2. Control: CONTINUAR
    const handleResume = () => {
      if (!mediaRecorderRef.current || state !== 'paused') return;

      try {
        setThirtySecAlert(null);
        if (mediaRecorderRef.current.state === 'paused') {
          mediaRecorderRef.current.resume();
        }
        startLiveSpeechMonitor();
        timerIntervalRef.current = window.setInterval(() => {
          setTimerSeconds((prev) => prev + 1);
        }, 1000);

        setState('recording');
      } catch (_err) {
        // ignore
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
      setErrorMsg(null);
      setThirtySecAlert(null);
      setState('idle');
    };

    // 30-Second Live Speech & Intelligibility Check:
    // If ~30 seconds of recording have elapsed and no legible word or clear voice was detected,
    // automatically pause recording and alert the participant.
    useEffect(() => {
      if (
        state === 'recording' &&
        timerSeconds >= 30 &&
        !thirtySecCheckTriggeredRef.current
      ) {
        thirtySecCheckTriggeredRef.current = true;
        const noWordsRecognized = legibleWordsCountRef.current === 0;
        const noClearVoiceSignal =
          speechRecognitionSupportedRef.current || vocalModulationFramesRef.current < 25;

        if (noWordsRecognized && noClearVoiceSignal) {
          handlePause();
          const hasHighBackgroundNoise = backgroundNoiseFramesRef.current > 90;
          setThirtySecAlert({
            title: hasHighBackgroundNoise
              ? 'Grabación en pausa: detectamos mucho ruido de fondo y no hemos logrado comprender palabras claras'
              : 'Grabación en pausa: tras 30 segundos no hemos logrado escuchar ninguna palabra legible',
            message: hasHighBackgroundNoise
              ? 'Llevas 30 segundos grabando, pero el ruido ambiental impide que el sistema comprenda lo que estás diciendo.'
              : 'Llevas 30 segundos de grabación y el sistema aún no ha logrado identificar ninguna palabra comprensible.',
            suggestion:
              'Te sugerimos cancelar esta grabación y revisar tu micrófono o moverte a un lugar tranquilo sin ruido de fondo. Recuerda que también tienes la opción de escribir tu respuesta por tu cuenta usando el teclado.',
          });
        }
      }
    }, [timerSeconds, state]);

    // Stops recording cleanly and returns Promise that resolves with final Blob
    const stopRecordingAndGetBlob = (): Promise<Blob | null> => {
      return new Promise((resolve) => {
        stopLiveSpeechMonitor();
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
        setThirtySecAlert(null);
        setQualityAlert(null);

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

        // Send to server: persists voice recording, strictly transcribes without hallucinating, saves in Firestore
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
            clientTranscription: liveClientTranscriptRef.current || undefined,
          }),
        });

        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || 'Error al guardar el archivo de voz.');
        }

        const returnedTranscription = (data.data.transcription || '').trim();
        const returnedQuality: 'clear' | 'noisy' | 'unintelligible' | 'silent' =
          data.data.audioQuality || (returnedTranscription.length > 0 ? 'clear' : 'unintelligible');
        const returnedWarning: string | undefined = data.data.qualityWarning;
        const returnedSuggestion: string | undefined = data.data.suggestion;

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

        // Show quality alert banner if audio was unintelligible, silent, or had high background noise
        if (
          returnedQuality === 'unintelligible' ||
          returnedQuality === 'silent' ||
          returnedTranscription.length === 0
        ) {
          setQualityAlert({
            audioQuality: returnedQuality === 'silent' ? 'silent' : 'unintelligible',
            warning:
              returnedWarning ||
              'No hemos logrado escucharte correctamente ni identificar ninguna palabra legible en tu grabación.',
            suggestion:
              returnedSuggestion ||
              'Si hay mucho ruido de fondo, te sugerimos moverte a un lugar sin ruido y revisar tu micrófono. Tu archivo de voz se guardó, pero recuerda que también tienes la opción de escribir tu respuesta por tu cuenta usando el teclado.',
          });
        } else if (returnedQuality === 'noisy') {
          setQualityAlert({
            audioQuality: 'noisy',
            warning:
              returnedWarning ||
              'Detectamos bastante ruido de fondo en tu grabación. Se transcribieron únicamente las palabras que lograron escucharse con claridad.',
            suggestion:
              returnedSuggestion ||
              'Te sugerimos moverte a un lugar sin ruido de fondo para tus próximas grabaciones, o bien revisar y completar tu respuesta directamente usando el teclado.',
          });
        } else {
          setQualityAlert(null);
        }

        // Reset recorder state to idle ready to record another note if desired
        setState('idle');
        setTimerSeconds(0);
        setPreviewAudioName(null);
        finalRecordedBlobRef.current = null;
        audioChunksRef.current = [];
        if (previewAudioUrl) {
          URL.revokeObjectURL(previewAudioUrl);
          setPreviewAudioUrl(null);
        }

        // Notify parent callback with newly created audio, transcription, and quality diagnosis
        onVoiceSubmitted(audioAttachment, returnedTranscription, nextAudios, {
          audioQuality: returnedQuality,
          qualityWarning: returnedWarning,
          suggestion: returnedSuggestion,
        });

        return audioAttachment;
      } catch (err: any) {
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
          capture="user"
          onChange={handleAudioFileSelected}
          className="sr-only"
          aria-label="Grabar audio con el micrófono nativo del dispositivo"
        />

        {/* Main active recorder container */}
        <div className="w-full bg-gradient-to-b from-amber-50/30 via-stone-50/60 to-white border border-stone-200/90 rounded-2xl p-5 transition-all shadow-xs">
          {/* Live Timer badge (visible when recording, paused or stopped) */}
          {(state === 'recording' || state === 'paused' || state === 'stopped') && (
            <div className="flex items-center justify-between mb-3 pb-2.5 border-b border-stone-200/60">
              <div className="flex items-center gap-2">
                <span
                  className={`w-3 h-3 rounded-full ${
                    state === 'recording'
                      ? 'bg-rose-500 animate-ping'
                      : state === 'paused'
                      ? 'bg-amber-500'
                      : 'bg-emerald-600'
                  }`}
                />
                <span className="text-xs font-semibold text-stone-700">
                  {state === 'recording' && 'Grabando tu recuerdo en vivo...'}
                  {state === 'paused' && 'Grabación en pausa'}
                  {state === 'stopped' && 'Grabación lista para enviar'}
                </span>
              </div>
              <span className="font-mono text-sm font-bold text-amber-900 bg-amber-100/80 px-3 py-0.5 rounded-full border border-amber-200">
                {formatTimer(timerSeconds)}
              </span>
            </div>
          )}

          {/* 30-Second Auto-Pause Alert when no legible words are detected */}
          {thirtySecAlert && (
            <div
              role="alert"
              className="mb-4 p-4 bg-amber-50 border-2 border-amber-300 rounded-xl space-y-2.5 shadow-xs"
            >
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-5 h-5 shrink-0 text-amber-700 mt-0.5" />
                <div className="flex-1 space-y-1">
                  <h5 className="font-serif font-bold text-sm text-amber-950">
                    {thirtySecAlert.title}
                  </h5>
                  <p className="text-xs text-amber-900 leading-relaxed">
                    {thirtySecAlert.message}
                  </p>
                  <p className="text-xs font-medium text-stone-800 bg-white/80 p-2.5 rounded-lg border border-amber-200 leading-relaxed">
                    {thirtySecAlert.suggestion}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setThirtySecAlert(null)}
                  className="text-amber-600 hover:text-amber-900 p-0.5 rounded cursor-pointer"
                  title="Cerrar alerta"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1 pl-7">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-rose-700 hover:bg-rose-800 text-white text-xs font-semibold rounded-lg shadow-xs transition cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Cancelar grabación</span>
                </button>

                {onFocusKeyboard && (
                  <button
                    type="button"
                    onClick={() => {
                      handleCancel();
                      onFocusKeyboard();
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-amber-800 hover:bg-amber-900 text-white text-xs font-semibold rounded-lg shadow-xs transition cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Escribir con el teclado</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleResume}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-emerald-50 text-emerald-900 border border-emerald-300 text-xs font-semibold rounded-lg transition cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Continuar grabando</span>
                </button>
              </div>
            </div>
          )}

          {/* Post-Upload Audio Quality / Unintelligible Speech Alert */}
          {qualityAlert && (
            <div
              role="alert"
              className={`mb-4 p-4 rounded-xl border-2 space-y-2.5 shadow-xs ${
                qualityAlert.audioQuality === 'noisy'
                  ? 'bg-amber-50 border-amber-300 text-amber-950'
                  : 'bg-rose-50 border-rose-300 text-rose-950'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <AlertCircle
                  className={`w-5 h-5 shrink-0 mt-0.5 ${
                    qualityAlert.audioQuality === 'noisy' ? 'text-amber-700' : 'text-rose-700'
                  }`}
                />
                <div className="flex-1 space-y-1">
                  <h5 className="font-serif font-bold text-sm">
                    {qualityAlert.audioQuality === 'noisy'
                      ? 'Aviso: Se detectó mucho ruido de fondo en tu audio'
                      : 'Alerta: No hemos logrado escucharte correctamente'}
                  </h5>
                  <p className="text-xs leading-relaxed">{qualityAlert.warning}</p>
                  <p className="text-xs font-medium bg-white/85 p-2.5 rounded-lg border border-stone-200/80 text-stone-800 leading-relaxed">
                    {qualityAlert.suggestion}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setQualityAlert(null)}
                  className="text-stone-500 hover:text-stone-800 p-0.5 rounded cursor-pointer"
                  title="Cerrar alerta"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1 pl-7">
                {onFocusKeyboard && (
                  <button
                    type="button"
                    onClick={() => {
                      onFocusKeyboard();
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-amber-800 hover:bg-amber-900 text-white text-xs font-semibold rounded-lg shadow-xs transition cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Escribir mi respuesta con el teclado</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleStartRecording}
                  disabled={disabled}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-stone-100 text-stone-800 border border-stone-300 text-xs font-semibold rounded-lg transition cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Intentar grabar de nuevo en un lugar sin ruido</span>
                </button>
              </div>
            </div>
          )}

          {/* Error notification banner with recovery actions */}
          {errorMsg && (
            <div className="mb-4 p-3.5 bg-amber-50 border border-amber-300 rounded-xl space-y-2">
              <div className="flex items-start gap-2 text-xs text-amber-900 leading-relaxed">
                <AlertCircle className="w-4 h-4 shrink-0 text-amber-700 mt-0.5" />
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
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-800 hover:bg-amber-900 text-white text-xs font-semibold rounded-lg shadow-xs transition cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Subir archivo de audio o nota de voz
                </button>
                {onFocusKeyboard && (
                  <button
                    type="button"
                    onClick={onFocusKeyboard}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-stone-100 text-stone-800 border border-stone-300 text-xs font-semibold rounded-lg transition cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Escribir con el teclado
                  </button>
                )}
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

          {/* 1. STATE: IDLE (Senior-friendly circular button) */}
          {state === 'idle' && (
            <div className="flex flex-col items-center justify-center text-center space-y-4 py-4">
              {/* Circular voice button designed for seniors */}
              <button
                type="button"
                onClick={handleStartRecording}
                disabled={disabled}
                className="w-36 h-36 sm:w-40 sm:h-40 rounded-full bg-gradient-to-br from-amber-700 via-amber-800 to-amber-900 text-white shadow-md hover:shadow-xl hover:scale-105 active:scale-95 transition-all duration-300 flex flex-col items-center justify-center p-3 cursor-pointer group focus:outline-none focus:ring-4 focus:ring-amber-200 border-4 border-amber-100 disabled:opacity-50"
                aria-label="Pulsa y cuéntanos tu recuerdo"
              >
                <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center mb-1 group-hover:bg-white/30 transition shadow-inner">
                  <Mic className="w-7 h-7 text-white" />
                </div>
                <span className="text-xs sm:text-sm font-bold text-center leading-snug px-2 text-amber-50">
                  Pulsa y cuéntanos tu recuerdo
                </span>
              </button>

              <p className="font-serif italic text-sm text-stone-700 text-center max-w-md px-2 leading-relaxed">
                «Habla con calma y a tu propio ritmo. Te escuchamos con el respeto que merece tu historia.»
              </p>

              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => audioFileInputRef.current?.click()}
                  disabled={disabled}
                  className="inline-flex items-center gap-1.5 text-xs text-stone-500 hover:text-amber-800 transition underline underline-offset-4 cursor-pointer"
                  title="Subir archivo de audio o nota de voz (.mp3, .m4a, .wav, .ogg, .webm)"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>O si lo prefieres, sube una nota de voz o archivo de audio</span>
                </button>
              </div>
            </div>
          )}

          {/* 2. STATE: RECORDING or PAUSED (Controls: Pausar/Continuar, Cancelar, Enviar y Transcribir) */}
          {(state === 'recording' || state === 'paused') && (
            <div className="space-y-4 py-2">
              {/* Sound Wave Visualizer */}
              <div className="bg-stone-900 rounded-xl p-3 flex items-center justify-center gap-1.5 h-16 overflow-hidden shadow-inner">
                {[20, 45, 80, 60, 30, 95, 70, 40, 85, 55, 35, 90, 65, 45, 75, 30, 60, 85, 40, 70].map(
                  (baseHeight, idx) => {
                    const dynamicHeight =
                      state === 'recording'
                        ? Math.max(12, Math.min(50, (baseHeight * (volumeLevel + 20)) / 100))
                        : 10;
                    return (
                      <div
                        key={idx}
                        style={{ height: `${dynamicHeight}px` }}
                        className={`w-1.5 rounded-full transition-all duration-75 ${
                          state === 'recording' ? 'bg-amber-400' : 'bg-stone-600'
                        }`}
                      />
                    );
                  }
                )}
              </div>

              {/* CONTROLES: Pausar / Continuar, Cancelar, Enviar y Transcribir */}
              <div className="bg-white p-3 rounded-xl border border-stone-200 flex flex-wrap items-center justify-between gap-2 shadow-xs">
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
                      <span>Pausar</span>
                    </button>
                  )}

                  {/* CONTINUAR (visible cuando está en pausa) */}
                  {state === 'paused' && (
                    <button
                      type="button"
                      onClick={handleResume}
                      disabled={disabled}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 shadow-xs transition-colors cursor-pointer"
                      title="Continuar la grabación en el punto donde se quedó"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>Continuar</span>
                    </button>
                  )}

                  {/* CANCELAR (cancela la grabación y descarta) */}
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={disabled}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-stone-600 hover:text-rose-700 hover:bg-rose-50 border border-stone-200 hover:border-rose-200 rounded-lg transition-colors cursor-pointer"
                    title="Cancelar grabación y descartar sin guardar nada"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Cancelar</span>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {/* ENVIAR Y TRANSCRIBIR */}
                  <button
                    type="button"
                    onClick={() => handleSend()}
                    disabled={disabled}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-amber-800 hover:bg-amber-900 rounded-lg shadow-sm transition-all transform hover:scale-[1.02] cursor-pointer"
                    title="Finalizar grabación, guardar en base de datos y transcribir con IA"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Enviar y Transcribir</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 3. STATE: STOPPED (Preview mode before upload) */}
          {state === 'stopped' && (
            <div className="space-y-3 py-1">
              {previewAudioUrl && (
                <div className="bg-white p-4 rounded-xl border border-amber-200 shadow-xs space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-stone-800 flex items-center gap-1.5">
                      <FileAudio className="w-4 h-4 text-amber-700" />
                      <span>{previewAudioName || 'Grabación lista para enviar y transcribir'}</span>
                    </span>
                    <span className="text-stone-500 font-mono text-[11px]">
                      Duración: {formatTimer(timerSeconds)}
                    </span>
                  </div>

                  <AudioPlayer
                    audioUrl={previewAudioUrl}
                    durationSeconds={timerSeconds}
                    title={previewAudioName || 'Vista previa del audio'}
                  />

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-stone-100">
                    <button
                      type="button"
                      onClick={handleCancel}
                      disabled={disabled}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-stone-600 hover:text-stone-900 bg-stone-100 hover:bg-stone-200 rounded-lg transition cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Descartar y volver a grabar</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSend()}
                      disabled={disabled}
                      className="inline-flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-white bg-amber-800 hover:bg-amber-900 rounded-lg shadow-sm transition-all transform hover:scale-[1.02] cursor-pointer"
                    >
                      <Send className="w-4 h-4" />
                      <span>Enviar y Transcribir</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 4. STATE: UPLOADING / TRANSCRIBING */}
          {state === 'uploading' && (
            <div className="py-8 px-4 bg-white border border-amber-200 rounded-xl flex flex-col items-center justify-center text-center space-y-3">
              <div className="relative">
                <RefreshCw className="w-9 h-9 text-amber-700 animate-spin" />
                <Sparkles className="w-4 h-4 text-amber-500 absolute -top-1 -right-1 animate-bounce" />
              </div>
              <div className="max-w-md">
                <h5 className="text-sm font-bold text-stone-900">
                  Guardando tu audio y transcribiendo con inteligencia artificial...
                </h5>
                <p className="text-xs text-stone-500 mt-1 leading-relaxed">
                  Escuchando con atención tu testimonio para transcribirlo fidedignamente al texto de tu respuesta.
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
  const [isOpen, setIsOpen] = useState(false);
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

  if (!isOpen) {
    return (
      <div className="pt-1">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-800 hover:text-emerald-950 bg-emerald-50/80 hover:bg-emerald-100/80 border border-emerald-200 px-3.5 py-2 rounded-lg transition cursor-pointer"
        >
          <Mic className="w-3.5 h-3.5 text-emerald-700" />
          <span className="underline underline-offset-4">Mostrar Archivos de voz</span>
          <span className="px-1.5 py-0.5 rounded-full bg-emerald-200/80 text-emerald-950 text-[10px] font-bold">
            {audios.length}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 bg-white border border-emerald-200 rounded-xl p-4 shadow-xs">
      <div className="flex items-center justify-between pb-2 border-b border-emerald-100">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
          <h5 className="text-xs font-bold uppercase tracking-wider text-emerald-900">
            Archivos de voz guardados ({audios.length})
          </h5>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline text-[11px] text-emerald-700 font-medium">
            Disponibles para reproducción permanente y consulta
          </span>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="text-xs font-semibold text-stone-500 hover:text-stone-800 underline underline-offset-2 cursor-pointer"
          >
            Ocultar
          </button>
        </div>
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
