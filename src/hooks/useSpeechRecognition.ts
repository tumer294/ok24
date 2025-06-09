import { useState, useEffect, useRef, useCallback } from 'react';

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((this: SpeechRecognition, ev: Event) => any) | null;
  onend: ((this: SpeechRecognition, ev: Event) => any) | null;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => any) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

export const useSpeechRecognition = () => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const onSpeechEndRef = useRef<((text: string) => void) | null>(null);
  const finalTranscriptRef = useRef('');
  const isVoiceModeRef = useRef(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (SpeechRecognition) {
      setIsSupported(true);
    }
  }, []);

  const cleanup = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const checkMicrophonePermission = async (): Promise<boolean> => {
    try {
      // Modern browsers - check permissions API
      if ('permissions' in navigator) {
        const permission = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        if (permission.state === 'denied') {
          return false;
        }
      }

      // Try to get user media to test microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      return true;
    } catch (error) {
      console.error('Mikrofon izni kontrolü hatası:', error);
      return false;
    }
  };

  // Function specifically for voice mode to restart listening
  const restartListening = useCallback((onSpeechEnd: (text: string) => void) => {
    console.log('🔄 Restarting listening for voice mode');
    
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    // Set a longer timeout to restart listening (especially for mobile)
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const restartDelay = isMobile ? 3000 : 2000; // 3 seconds for mobile, 2 seconds for desktop
    
    timeoutRef.current = setTimeout(() => {
      if (isVoiceModeRef.current) {
        startListening(onSpeechEnd);
      }
    }, restartDelay);
  }, []);

  const startListening = useCallback(async (onSpeechEnd?: (text: string) => void) => {
    if (!isSupported) return;

    // Check microphone permission first
    const hasPermission = await checkMicrophonePermission();
    if (!hasPermission) {
      alert('Mikrofon erişimi reddedildi. Lütfen tarayıcı ayarlarından mikrofon iznini verin ve sayfayı yenileyin.');
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    // Cleanup any existing recognition
    cleanup();

    console.log('🎤 Starting speech recognition', onSpeechEnd ? '(Voice Mode)' : '(Manual Mode)');
    
    // Set mode flags
    isVoiceModeRef.current = !!onSpeechEnd;
    onSpeechEndRef.current = onSpeechEnd || null;
    finalTranscriptRef.current = '';

    // Create new recognition instance
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;

    // Settings
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'tr-TR';

    recognition.onstart = () => {
      console.log('✅ Speech recognition started');
      setIsListening(true);
      setTranscript('');
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;

        if (result.isFinal) {
          finalTranscript += transcript;
          finalTranscriptRef.current += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      // Update transcript (interim + final)
      const currentTranscript = finalTranscriptRef.current + interimTranscript;
      console.log('📝 Transcript updated:', currentTranscript);
      setTranscript(currentTranscript);

      // Clear any existing silence timeout
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
        silenceTimeoutRef.current = null;
      }

      // For voice mode, set a silence timeout after final results
      if (finalTranscript && isVoiceModeRef.current && onSpeechEndRef.current) {
        console.log('🎯 Final result detected, setting silence timeout');
        
        // Wait for silence before processing (longer timeout for mobile)
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const silenceDelay = isMobile ? 3500 : 3000; // 3.5 seconds for mobile, 3 seconds for desktop
        
        silenceTimeoutRef.current = setTimeout(() => {
          const fullText = finalTranscriptRef.current.trim();
          if (fullText && isVoiceModeRef.current && onSpeechEndRef.current) {
            console.log('🔇 Silence detected, processing speech:', fullText);
            recognition.stop();
            
            // Process the speech after a brief delay
            const callback = onSpeechEndRef.current;
            setTimeout(() => {
              if (callback) {
                callback(fullText);
              }
            }, 300);
          }
        }, silenceDelay);
      }
    };

    recognition.onend = () => {
      console.log('🛑 Speech recognition ended');
      setIsListening(false);
      recognitionRef.current = null;
      
      // Clear silence timeout
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
        silenceTimeoutRef.current = null;
      }
      
      // For manual mode, keep the transcript
      if (!isVoiceModeRef.current && finalTranscriptRef.current) {
        console.log('💾 Keeping transcript for manual input:', finalTranscriptRef.current);
        setTranscript(finalTranscriptRef.current);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // Handle different error types appropriately
      if (event.error === 'aborted') {
        console.log('ℹ️ Speech recognition was aborted (normal operation)');
      } else if (event.error === 'not-allowed') {
        console.error('❌ Microphone permission denied');
        alert('Mikrofon erişimi reddedildi. Lütfen tarayıcı ayarlarından mikrofon iznini verin ve sayfayı yenileyin.');
      } else if (event.error === 'no-speech') {
        console.log('🔇 No speech detected');
        // If in voice mode, restart listening after no-speech error
        if (isVoiceModeRef.current && onSpeechEndRef.current) {
          console.log('🔄 Restarting listening after no-speech error in voice mode');
          restartListening(onSpeechEndRef.current);
          return; // Don't set isListening to false
        }
      } else {
        console.error('❌ Speech recognition error:', event.error);
      }
      setIsListening(false);
      recognitionRef.current = null;
      
      // Clear silence timeout on error
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
        silenceTimeoutRef.current = null;
      }
    };

    try {
      recognition.start();
    } catch (error) {
      console.error('❌ Error starting recognition:', error);
      setIsListening(false);
      recognitionRef.current = null;
    }
  }, [isSupported, cleanup, restartListening]);

  const stopListening = useCallback(() => {
    console.log('⏹️ Stopping speech recognition');
    isVoiceModeRef.current = false;
    onSpeechEndRef.current = null;
    cleanup();
  }, [cleanup]);

  const resetTranscript = useCallback(() => {
    console.log('🔄 Resetting transcript');
    setTranscript('');
    finalTranscriptRef.current = '';
  }, []);

  return {
    isListening,
    transcript,
    isSupported,
    startListening,
    stopListening,
    resetTranscript,
    restartListening
  };
};