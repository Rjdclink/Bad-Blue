/**
 * LEXARA Webcam & Microphone Integration
 * 
 * Real-time video/audio capture for face-to-face consultation:
 * - Webcam capture with PiP preview
 * - Voice Activity Detection (VAD)
 * - Audio streaming for transcription
 * - Lip-reading support signal preprocessing
 * - Minimal computational footprint
 * 
 * Silent operation - no console logs in production
 */

import { useState, useEffect, useRef, useCallback } from 'react';

// ============================================================================
// TYPES
// ============================================================================

export interface MediaStreamState {
  videoStream: MediaStream | null;
  audioStream: MediaStream | null;
  videoEnabled: boolean;
  audioEnabled: boolean;
  error: string | null;
}

export interface VADConfig {
  threshold: number;         // Audio level threshold for speech detection
  silenceTimeout: number;    // MS of silence before ending speech segment
  minSpeechDuration: number; // Minimum MS for valid speech
}

export interface WebcamConfig {
  width: number;
  height: number;
  frameRate: number;
  facingMode: 'user' | 'environment';
}

export interface AudioConfig {
  sampleRate: number;
  channelCount: number;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

export interface UseLexaraMediaOptions {
  onSpeechStart?: () => void;
  onSpeechEnd?: (audioBlob: Blob) => void;
  onAudioLevel?: (level: number) => void;
  onVideoFrame?: (frame: ImageData) => void;
  vadConfig?: Partial<VADConfig>;
  webcamConfig?: Partial<WebcamConfig>;
  audioConfig?: Partial<AudioConfig>;
}

export interface LexaraMediaState {
  isVideoReady: boolean;
  isAudioReady: boolean;
  isSpeaking: boolean;
  audioLevel: number;
  error: string | null;
}

// ============================================================================
// DEFAULT CONFIGS - Optimized for minimal compute
// ============================================================================

const DEFAULT_VAD_CONFIG: VADConfig = {
  threshold: 0.02,
  silenceTimeout: 1000,
  minSpeechDuration: 200,
};

const DEFAULT_WEBCAM_CONFIG: WebcamConfig = {
  width: 320,      // Low resolution for analysis
  height: 240,
  frameRate: 15,   // Lower FPS for lip-reading
  facingMode: 'user',
};

const DEFAULT_AUDIO_CONFIG: AudioConfig = {
  sampleRate: 16000,
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

// ============================================================================
// HOOK: useLexaraMedia
// ============================================================================

export function useLexaraMedia(options: UseLexaraMediaOptions = {}) {
  const {
    onSpeechStart,
    onSpeechEnd,
    onAudioLevel,
    onVideoFrame,
    vadConfig: vadConfigOverride,
    webcamConfig: webcamConfigOverride,
    audioConfig: audioConfigOverride,
  } = options;

  // Merge configs
  const vadConfig = { ...DEFAULT_VAD_CONFIG, ...vadConfigOverride };
  const webcamConfig = { ...DEFAULT_WEBCAM_CONFIG, ...webcamConfigOverride };
  const audioConfig = { ...DEFAULT_AUDIO_CONFIG, ...audioConfigOverride };

  // State
  const [state, setState] = useState<LexaraMediaState>({
    isVideoReady: false,
    isAudioReady: false,
    isSpeaking: false,
    audioLevel: 0,
    error: null,
  });

  // Refs for streams and processing
  const videoStreamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  
  // VAD state refs
  const isSpeakingRef = useRef(false);
  const silenceStartRef = useRef<number | null>(null);
  const speechStartRef = useRef<number | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const rafIdRef = useRef<number | null>(null);

  // ============================================================================
  // VIDEO CAPTURE
  // ============================================================================

  const startVideo = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: webcamConfig.width },
          height: { ideal: webcamConfig.height },
          frameRate: { ideal: webcamConfig.frameRate },
          facingMode: webcamConfig.facingMode,
        },
      });

      videoStreamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setState(prev => ({ ...prev, isVideoReady: true, error: null }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to access camera';
      setState(prev => ({ ...prev, error: message }));
    }
  }, [webcamConfig]);

  const stopVideo = useCallback(() => {
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach(track => track.stop());
      videoStreamRef.current = null;
    }
    setState(prev => ({ ...prev, isVideoReady: false }));
  }, []);

  // ============================================================================
  // AUDIO CAPTURE WITH VAD
  // ============================================================================

  const startAudio = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: audioConfig.sampleRate,
          channelCount: audioConfig.channelCount,
          echoCancellation: audioConfig.echoCancellation,
          noiseSuppression: audioConfig.noiseSuppression,
          autoGainControl: audioConfig.autoGainControl,
        },
      });

      audioStreamRef.current = stream;

      // Setup Web Audio API for VAD
      const audioContext = new AudioContext({ sampleRate: audioConfig.sampleRate });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Setup MediaRecorder for audio chunks
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4',
      });
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };
      
      mediaRecorderRef.current = mediaRecorder;

      // Start VAD processing
      startVAD();

      setState(prev => ({ ...prev, isAudioReady: true, error: null }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to access microphone';
      setState(prev => ({ ...prev, error: message }));
    }
  }, [audioConfig]);

  const stopAudio = useCallback(() => {
    // Stop VAD
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    // Stop MediaRecorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    // Close AudioContext
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Stop stream
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop());
      audioStreamRef.current = null;
    }

    setState(prev => ({ ...prev, isAudioReady: false, isSpeaking: false, audioLevel: 0 }));
  }, []);

  // ============================================================================
  // VOICE ACTIVITY DETECTION
  // ============================================================================

  const startVAD = useCallback(() => {
    if (!analyserRef.current) return;

    const analyser = analyserRef.current;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const processAudio = () => {
      if (!analyserRef.current) return;

      analyser.getByteFrequencyData(dataArray);

      // Calculate RMS audio level
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / dataArray.length) / 255;

      // Update audio level state (throttled)
      setState(prev => {
        if (Math.abs(prev.audioLevel - rms) > 0.02) {
          return { ...prev, audioLevel: rms };
        }
        return prev;
      });

      // Notify callback
      onAudioLevel?.(rms);

      const now = Date.now();
      const isSpeechDetected = rms > vadConfig.threshold;

      if (isSpeechDetected) {
        silenceStartRef.current = null;

        if (!isSpeakingRef.current) {
          // Speech started
          isSpeakingRef.current = true;
          speechStartRef.current = now;
          audioChunksRef.current = [];
          
          // Start recording
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'inactive') {
            mediaRecorderRef.current.start(100); // Collect chunks every 100ms
          }
          
          setState(prev => ({ ...prev, isSpeaking: true }));
          onSpeechStart?.();
        }
      } else if (isSpeakingRef.current) {
        // Silence detected while speaking
        if (!silenceStartRef.current) {
          silenceStartRef.current = now;
        } else if (now - silenceStartRef.current > vadConfig.silenceTimeout) {
          // Speech ended
          const speechDuration = now - (speechStartRef.current || now);
          
          if (speechDuration >= vadConfig.minSpeechDuration) {
            // Stop recording and emit audio
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
              mediaRecorderRef.current.stop();
              
              // Wait for final data then emit
              setTimeout(() => {
                if (audioChunksRef.current.length > 0) {
                  const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                  onSpeechEnd?.(blob);
                }
              }, 100);
            }
          }

          isSpeakingRef.current = false;
          speechStartRef.current = null;
          silenceStartRef.current = null;
          setState(prev => ({ ...prev, isSpeaking: false }));
        }
      }

      rafIdRef.current = requestAnimationFrame(processAudio);
    };

    processAudio();
  }, [vadConfig, onAudioLevel, onSpeechStart, onSpeechEnd]);

  // ============================================================================
  // VIDEO FRAME PROCESSING (for lip-reading support)
  // ============================================================================

  const captureVideoFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !onVideoFrame) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    if (!ctx || video.videoWidth === 0) return;

    // Downsample to 224x224 for analysis
    canvas.width = 224;
    canvas.height = 224;
    ctx.drawImage(video, 0, 0, 224, 224);

    const imageData = ctx.getImageData(0, 0, 224, 224);
    onVideoFrame(imageData);
  }, [onVideoFrame]);

  // ============================================================================
  // COMBINED START/STOP
  // ============================================================================

  const start = useCallback(async (options: { video?: boolean; audio?: boolean } = {}) => {
    const { video = true, audio = true } = options;
    
    if (video) await startVideo();
    if (audio) await startAudio();
  }, [startVideo, startAudio]);

  const stop = useCallback(() => {
    stopVideo();
    stopAudio();
  }, [stopVideo, stopAudio]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  // ============================================================================
  // REF SETTERS
  // ============================================================================

  const setVideoElement = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && videoStreamRef.current) {
      el.srcObject = videoStreamRef.current;
      el.play().catch(() => {});
    }
  }, []);

  const setCanvasElement = useCallback((el: HTMLCanvasElement | null) => {
    canvasRef.current = el;
  }, []);

  return {
    state,
    start,
    stop,
    startVideo,
    stopVideo,
    startAudio,
    stopAudio,
    setVideoElement,
    setCanvasElement,
    captureVideoFrame,
  };
}

// ============================================================================
// COMPONENT: LexaraPiPPreview
// ============================================================================

export interface LexaraPiPPreviewProps {
  videoRef: (el: HTMLVideoElement | null) => void;
  isActive: boolean;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  className?: string;
}

export const LexaraPiPPreview: React.FC<LexaraPiPPreviewProps> = ({
  videoRef,
  isActive,
  position = 'bottom-right',
  className,
}) => {
  const positionClasses = {
    'top-right': 'top-4 right-4',
    'top-left': 'top-4 left-4',
    'bottom-right': 'bottom-4 right-4',
    'bottom-left': 'bottom-4 left-4',
  };

  if (!isActive) return null;

  return (
    <div
      className={`fixed z-50 ${positionClasses[position]} ${className || ''}`}
    >
      <div className="relative w-32 h-24 rounded-lg overflow-hidden border-2 border-primary/50 shadow-lg bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover transform -scale-x-100"
        />
        <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-red-500 rounded text-[10px] text-white font-medium animate-pulse">
          LIVE
        </div>
      </div>
    </div>
  );
};

export default useLexaraMedia;
