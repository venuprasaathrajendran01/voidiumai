import { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";
import { motion, AnimatePresence } from "motion/react";
import { Mic, MicOff, Volume2, VolumeX, Sparkles, MessageSquare, Heart, Brain, ThumbsUp, ThumbsDown, CheckCircle2, Settings, X, Sliders, User, Square } from "lucide-react";
import Markdown from 'react-markdown';

// Constants for Audio Processing
const SAMPLE_RATE = 16000;
const CHUNK_SIZE = 4096;

type Message = {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
};

export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [history, setHistory] = useState<Message[]>(() => {
    const saved = localStorage.getItem('voidium_history');
    return saved ? JSON.parse(saved) : [];
  });
  const [volume, setVolume] = useState(0);
  const [currentEmotion, setCurrentEmotion] = useState<'neutral' | 'angry' | 'calm' | 'sad' | 'happy'>('neutral');
  const emotionHeuristicRef = useRef({ happy: 0, angry: 0, sad: 0, calm: 0, frames: 0 });
  const lastEmotionUpdateRef = useRef(Date.now());
  const [harmonicColor, setHarmonicColor] = useState('rgba(242, 125, 38, 0.2)'); // Default orange
  const lastHueRef = useRef(30); // Start with orange hue
  const [feedbackStatus, setFeedbackStatus] = useState<'none' | 'positive' | 'negative' | 'submitted'>('none');
  const [feedbackText, setFeedbackText] = useState("");
  const [commandStatus, setCommandStatus] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const isConnectedRef = useRef(isConnected);
  const isMutedRef = useRef(isMuted);

  useEffect(() => {
    localStorage.setItem('voidium_history', JSON.stringify(history.slice(-50))); // Keep last 50
  }, [history]);

  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  const [voiceSettings, setVoiceSettings] = useState({
    voiceName: 'Zephyr' as 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr',
    pitch: 0, // detune in cents
    speed: 1.0, // playbackRate
    tone: 'Empathetic' as 'Empathetic' | 'Professional' | 'Calm' | 'Energetic'
  });

  const recognitionRef = useRef<any>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionRef = useRef<any>(null);
  const audioQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const stopAudio = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setIsRecording(false);
  }, []);

  const playQueuedAudio = useCallback(async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0 || !audioContextRef.current) return;

    isPlayingRef.current = true;
    const chunk = audioQueueRef.current.shift()!;
    
    const audioBuffer = audioContextRef.current.createBuffer(1, chunk.length, SAMPLE_RATE);
    audioBuffer.getChannelData(0).set(chunk);
    
    const source = audioContextRef.current.createBufferSource();
    currentSourceRef.current = source;
    source.buffer = audioBuffer;
    
    // Apply Voice Settings
    source.playbackRate.value = voiceSettings.speed;
    source.detune.value = voiceSettings.pitch;
    
    source.connect(audioContextRef.current.destination);
    
    // Connect AI voice to analyser for visualization
    if (analyserRef.current) {
      source.connect(analyserRef.current);
    }
    
    source.onended = () => {
      if (currentSourceRef.current === source) {
        currentSourceRef.current = null;
      }
      isPlayingRef.current = false;
      playQueuedAudio();
    };
    
    source.start();
  }, [voiceSettings]);

  const handleMessage = useCallback((message: LiveServerMessage) => {
    // Handle Audio Output
    const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (base64Audio && audioContextRef.current) {
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const pcmData = new Int16Array(bytes.buffer);
      const floatData = new Float32Array(pcmData.length);
      for (let i = 0; i < pcmData.length; i++) {
        floatData[i] = pcmData[i] / 32768.0;
      }
      audioQueueRef.current.push(floatData);
      playQueuedAudio();
    }

    // Handle Interruption
    if (message.serverContent?.interrupted) {
      audioQueueRef.current = [];
      currentSourceRef.current?.stop();
      currentSourceRef.current = null;
      isPlayingRef.current = false;
    }

    // Handle Transcriptions
    const modelText = message.serverContent?.modelTurn?.parts?.[0]?.text || message.serverContent?.outputTranscription?.text;
    if (modelText) {
      setHistory(prev => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'model' && (Date.now() - last.timestamp < 5000)) {
          return [...prev.slice(0, -1), { ...last, text: last.text + modelText, timestamp: Date.now() }];
        }
        return [...prev, { role: 'model', text: modelText, timestamp: Date.now() }];
      });
      
      // Simple emotion detection from text
      const lowerText = modelText.toLowerCase();
      if (lowerText.includes('angry') || lowerText.includes('furious') || lowerText.includes('mad')) setCurrentEmotion('angry');
      else if (lowerText.includes('calm') || lowerText.includes('peaceful') || lowerText.includes('relax')) setCurrentEmotion('calm');
      else if (lowerText.includes('sad') || lowerText.includes('unhappy') || lowerText.includes('sorry')) setCurrentEmotion('sad');
      else if (lowerText.includes('happy') || lowerText.includes('great') || lowerText.includes('wonderful')) setCurrentEmotion('happy');
    }

    const userText = message.serverContent?.inputTranscription?.text;
    if (userText) {
      setHistory(prev => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'user' && (Date.now() - last.timestamp < 5000)) {
          return [...prev.slice(0, -1), { ...last, text: last.text + userText, timestamp: Date.now() }];
        }
        return [...prev, { role: 'user', text: userText, timestamp: Date.now() }];
      });
    }
  }, [playQueuedAudio]);

  const startRecording = useCallback(async (session: any) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      if (!audioContextRef.current) return;

      const source = audioContextRef.current.createMediaStreamSource(stream);
      
      // Setup Analyser for Harmonics
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      source.connect(analyser);

      const processor = audioContextRef.current.createScriptProcessor(CHUNK_SIZE, 1, 1);
      processorRef.current = processor;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      // Start Analysis Loop
      const runAnalysis = () => {
        if (!analyserRef.current) return;
        
        analyserRef.current.getByteFrequencyData(dataArray);
        
        let lowEnergy = 0;
        let midEnergy = 0;
        let highEnergy = 0;
        
        const lowEnd = Math.floor(bufferLength * 0.1);
        const midEnd = Math.floor(bufferLength * 0.5);
        
        for (let i = 0; i < bufferLength; i++) {
          const val = dataArray[i];
          if (i < lowEnd) lowEnergy += val;
          else if (i < midEnd) midEnergy += val;
          else highEnergy += val;
        }
        
        const totalEnergy = lowEnergy + midEnergy + highEnergy;
        
        if (totalEnergy > 0) {
          const targetHue = (
            (lowEnergy / totalEnergy) * 30 + 
            (midEnergy / totalEnergy) * 180 + 
            (highEnergy / totalEnergy) * 320
          );
          
          const lerpFactor = 0.15;
          let newHue = lastHueRef.current + (targetHue - lastHueRef.current) * lerpFactor;
          
          if (Math.abs(targetHue - lastHueRef.current) > 180) {
            if (targetHue > lastHueRef.current) newHue = lastHueRef.current - (360 - targetHue + lastHueRef.current) * lerpFactor;
            else newHue = lastHueRef.current + (360 - lastHueRef.current + targetHue) * lerpFactor;
          }
          
          newHue = (newHue + 360) % 360;
          lastHueRef.current = newHue;
          
          const saturation = 60 + Math.min(40, (totalEnergy / (bufferLength * 255)) * 1000);
          const lightness = 40 + Math.min(20, (totalEnergy / (bufferLength * 255)) * 500);
          
          setHarmonicColor(`hsla(${newHue}, ${saturation}%, ${lightness}%, 0.4)`);

          // Real-time Emotion Detection Heuristic
          const avgEnergy = totalEnergy / bufferLength;
          if (avgEnergy > 30) {
            const highRatio = highEnergy / totalEnergy;
            const lowRatio = lowEnergy / totalEnergy;
            const midRatio = midEnergy / totalEnergy;

            if (highRatio > 0.45 && avgEnergy > 80) emotionHeuristicRef.current.happy++;
            else if (midRatio > 0.55 && avgEnergy > 120) emotionHeuristicRef.current.angry++;
            else if (lowRatio > 0.65 && avgEnergy < 70) emotionHeuristicRef.current.sad++;
            else if (midRatio > 0.45 && avgEnergy < 90) emotionHeuristicRef.current.calm++;
            
            emotionHeuristicRef.current.frames++;

            if (emotionHeuristicRef.current.frames >= 30) {
              const { happy, angry, sad, calm } = emotionHeuristicRef.current;
              const max = Math.max(happy, angry, sad, calm);
              
              if (max > 10) {
                if (max === angry) setCurrentEmotion('angry');
                else if (max === happy) setCurrentEmotion('happy');
                else if (max === sad) setCurrentEmotion('sad');
                else if (max === calm) setCurrentEmotion('calm');
              }
              emotionHeuristicRef.current = { happy: 0, angry: 0, sad: 0, calm: 0, frames: 0 };
            }
          }
        }

        animationFrameRef.current = requestAnimationFrame(runAnalysis);
      };

      runAnalysis();

      processor.onaudioprocess = (e) => {
        if (isMutedRef.current) {
          setVolume(0);
          return;
        }

        const inputData = e.inputBuffer.getChannelData(0);
        
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        setVolume(Math.sqrt(sum / inputData.length));

        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcm16[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
        }

        const base64Data = btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer)));
        session.sendRealtimeInput({
          media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
        });
      };

      source.connect(processor);
      processor.connect(audioContextRef.current.destination);
      setIsRecording(true);
    } catch (err) {
      console.error("Microphone access denied:", err);
      setCommandStatus("Microphone access denied.");
    }
  }, []);

  const startConnection = useCallback(async () => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        setCommandStatus("API Key missing.");
        return;
      }

      const ai = new GoogleGenAI({ apiKey });

      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: SAMPLE_RATE });
      }
      
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const toneInstructions = {
        Empathetic: "Your primary goal is to listen deeply, understand the user's underlying emotions, and respond with genuine empathy and insight. If you detect a shift in mood, acknowledge it gently.",
        Professional: "Maintain a professional, objective, and helpful tone. Focus on providing clear, structured insights while acknowledging the user's emotional state respectfully.",
        Calm: "Speak in a very soothing, slow, and tranquil manner. Your goal is to help the user feel relaxed and grounded. Use gentle language.",
        Energetic: "Be highly enthusiastic, motivating, and upbeat. Use positive reinforcement and high-energy language to lift the user's spirits."
      };

      const lastHistory = history.slice(-10).map(m => `${m.role === 'user' ? 'User' : 'Atlas'}: ${m.text}`).join('\n');

      const session = await ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-09-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceSettings.voiceName } },
          },
          systemInstruction: `You are Atlas, an emotionally intelligent AI companion. ${toneInstructions[voiceSettings.tone]} Keep your responses concise and conversational. 
          When you greet the user for the first time in a session, say: "Hi, I am Atlas, how can I assist you today?".
          CRITICAL: You must detect the user's emotional state. If they seem angry, calm, sad, or happy, you MUST include the exact word "ANGRY", "CALM", "SAD", or "HAPPY" (in any case) in your response so the system can update the UI theme.
          
          Previous Conversation Context:
          ${lastHistory || "No previous history."}`,
        },
        callbacks: {
          onopen: () => {
            setIsConnected(true);
            setCommandStatus("Connected.");
            setTimeout(() => setCommandStatus(null), 2000);
          },
          onmessage: handleMessage,
          onclose: () => {
            setIsConnected(false);
            setCommandStatus("Disconnected.");
          },
          onerror: (err) => {
            console.error("Live API Error:", err);
            setCommandStatus("Connection Error.");
          },
        }
      });

      sessionRef.current = session;
      startRecording(session);
    } catch (err) {
      console.error("Failed to connect:", err);
      setCommandStatus("Failed to connect.");
    }
  }, [handleMessage, voiceSettings, startRecording, history]);

  const toggleMute = () => setIsMuted(!isMuted);

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem('voidium_history');
    setCommandStatus("Memory Cleared.");
    setTimeout(() => setCommandStatus(null), 2000);
  };

  const disconnect = useCallback(() => {
    stopAudio();
    sessionRef.current?.close();
    sessionRef.current = null;
    setIsConnected(false);
    setFeedbackStatus('none');
    setFeedbackText("");
    setCurrentEmotion('neutral');
    setHarmonicColor('rgba(242, 125, 38, 0.2)');
  }, [stopAudio]);

  const handleFeedback = useCallback((type: 'positive' | 'negative') => {
    setFeedbackStatus(type);
    // In a real app, you'd send this to a backend.
    console.log(`Feedback received: ${type}`);
  }, []);

  const submitFeedback = useCallback(() => {
    // Simulate submission
    console.log(`Detailed feedback: ${feedbackText}`);
    setFeedbackStatus('submitted');
    setTimeout(() => setFeedbackStatus('none'), 3000);
  }, [feedbackText]);

  // Voice Command Listener
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    let recognition: any = null;
    let shouldRestart = true;

    const initRecognition = () => {
      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event: any) => {
        const transcript = Array.from(event.results)
          .map((result: any) => result[0])
          .map((result: any) => result.transcript)
          .join('')
          .toLowerCase();

        if (transcript.includes('atlas start') || transcript.includes('atlas activate')) {
          if (!isConnectedRef.current) {
            setCommandStatus('Starting session...');
            startConnection();
            setTimeout(() => setCommandStatus(null), 2000);
          }
        } else if (transcript.includes('atlas stop') || transcript.includes('atlas end')) {
          if (isConnectedRef.current) {
            setCommandStatus('Ending session...');
            disconnect();
            setTimeout(() => setCommandStatus(null), 2000);
          }
        } else if (transcript.includes('atlas mute')) {
          if (isConnectedRef.current && !isMutedRef.current) {
            setCommandStatus('Muting...');
            setIsMuted(true);
            setTimeout(() => setCommandStatus(null), 2000);
          }
        } else if (transcript.includes('atlas unmute')) {
          if (isConnectedRef.current && isMutedRef.current) {
            setCommandStatus('Unmuting...');
            setIsMuted(false);
            setTimeout(() => setCommandStatus(null), 2000);
          }
        } else if (transcript.includes('atlas feedback') || transcript.includes('atlas submit')) {
          if (isConnectedRef.current && history.some(m => m.role === 'model')) {
            setCommandStatus('Submitting feedback...');
            handleFeedback('positive');
            submitFeedback();
            setTimeout(() => setCommandStatus(null), 2000);
          }
        }
      };

      recognition.onerror = (event: any) => {
        if (event.error === 'no-speech' || event.error === 'aborted') return;
        console.error('Speech recognition error:', event.error);
        if (event.error === 'not-allowed') shouldRestart = false;
      };

      recognition.onend = () => {
        if (shouldRestart) {
          try {
            recognition.start();
          } catch (e) {
            console.warn('Failed to restart recognition:', e);
            // If it fails to start, try re-initializing after a short delay
            setTimeout(initRecognition, 1000);
          }
        }
      };

      try {
        recognition.start();
      } catch (e) {
        console.error('Initial recognition start failed:', e);
      }
    };

    initRecognition();

    return () => {
      shouldRestart = false;
      if (recognition) {
        recognition.stop();
      }
    };
  }, [startConnection, disconnect, handleFeedback, submitFeedback]);

  const getEmotionStyles = () => {
    switch (currentEmotion) {
      case 'angry': return { bg: 'bg-red-950/60', accent: 'bg-red-600', text: 'text-red-400', glow: 'rgba(220, 38, 38, 0.5)' };
      case 'calm': return { bg: 'bg-blue-950/60', accent: 'bg-blue-600', text: 'text-blue-400', glow: 'rgba(37, 99, 235, 0.5)' };
      case 'sad': return { bg: 'bg-zinc-950', accent: 'bg-zinc-800', text: 'text-zinc-500', glow: 'rgba(24, 24, 27, 0.8)' };
      case 'happy': return { bg: 'bg-emerald-950/60', accent: 'bg-emerald-600', text: 'text-emerald-400', glow: 'rgba(5, 150, 105, 0.5)' };
      default: return { bg: 'bg-orange-950/20', accent: 'bg-orange-500', text: 'text-orange-400', glow: 'rgba(242, 125, 38, 0.2)' };
    }
  };

  const emotionStyles = getEmotionStyles();

  return (
    <div className={`relative min-h-screen flex flex-col items-center justify-center p-4 md:p-8 overflow-x-hidden overflow-y-auto transition-colors duration-1000 ${emotionStyles.bg}`}>
      {/* Immersive Background */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="atmosphere absolute inset-0" />
        <motion.div 
          animate={{ 
            scale: [1, 1.2, 1],
            opacity: [0.3, 0.5, 0.3],
            backgroundColor: isRecording ? harmonicColor : emotionStyles.glow
          }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-[120px]" 
        />
        <motion.div 
          animate={{ 
            scale: [1.2, 1, 1.2],
            opacity: [0.2, 0.4, 0.2],
            backgroundColor: isRecording ? harmonicColor : emotionStyles.glow
          }}
          transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
          className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] rounded-full blur-[150px]" 
        />
      </div>

      {/* Main Content */}
      <div className="relative z-10 w-full max-w-2xl flex flex-col items-center gap-12">
        {/* Header */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center relative w-full px-4 flex flex-col items-center"
        >
          <div className="absolute right-0 top-0 z-20">
            <button 
              onClick={() => setIsSettingsOpen(true)}
              className="p-3 rounded-full bg-white/10 border border-white/20 hover:bg-white/20 transition-all text-white/80 hover:text-white shadow-lg"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>

          <h1 className="text-4xl md:text-6xl font-serif italic tracking-tight mb-2 text-white drop-shadow-sm">Atlas</h1>
          <p className="text-white/70 text-[10px] md:text-xs uppercase tracking-[0.3em] font-bold">Emotionally Aware Companion</p>
          
          <AnimatePresence>
            {isConnected && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className={`mt-4 px-4 py-1.5 rounded-full border ${emotionStyles.bg} ${emotionStyles.text} border-current/30 text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 shadow-lg shadow-current/10`}
              >
                <div className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                Detected Emotion: {currentEmotion}
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {commandStatus && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className={`mt-4 px-4 py-1 rounded-full border text-[10px] font-bold uppercase tracking-widest inline-block ${emotionStyles.bg} ${emotionStyles.text} border-current/30`}
              >
                Voice Command: {commandStatus}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Visualizer / Orb */}
        <div className="relative group">
          <motion.div
            animate={{
              scale: isRecording ? [1, 1.05 + volume * 2, 1] : 1,
              boxShadow: isRecording 
                ? [`0 0 40px ${harmonicColor}`, `0 0 80px ${harmonicColor}`, `0 0 40px ${harmonicColor}`]
                : `0 0 20px ${emotionStyles.glow}`,
              backgroundColor: isRecording ? harmonicColor : 'rgba(255, 255, 255, 0.05)'
            }}
            transition={{ duration: 0.15, repeat: isRecording ? Infinity : 0 }}
            className={`w-40 h-40 md:w-56 md:h-56 rounded-full flex items-center justify-center transition-all duration-500 border ${
              isConnected ? `border-current/30 ${emotionStyles.text}` : 'bg-white/5 border-white/10'
            }`}
          >
            <AnimatePresence mode="wait">
              {!isConnected ? (
                <motion.button
                  key="start"
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  onClick={startConnection}
                  className="w-full h-full rounded-full flex flex-col items-center justify-center gap-3 hover:bg-white/5 transition-colors"
                >
                  <Sparkles className={`w-8 h-8 ${emotionStyles.text}`} />
                  <span className="text-xs font-semibold uppercase tracking-widest">A.T.L.A.S</span>
                </motion.button>
              ) : (
                <motion.div
                  key="active"
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  className="flex flex-col items-center gap-2"
                >
                  <div className="flex gap-1 items-end h-8">
                    {[...Array(5)].map((_, i) => (
                      <motion.div
                        key={i}
                        animate={{ 
                          height: isRecording ? [8, 24 + Math.random() * 16, 8] : 8,
                          backgroundColor: isRecording ? '#fff' : emotionStyles.accent.replace('bg-', '')
                        }}
                        transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.1 }}
                        className="w-1 rounded-full bg-current"
                      />
                    ))}
                  </div>
                  <span className={`text-[10px] font-bold uppercase tracking-[0.3em] ${emotionStyles.text}`}>Listening</span>
                  
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={disconnect}
                    className="mt-4 flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/20 hover:bg-red-500/40 text-red-400 transition-all border border-red-500/30 group/stop"
                    title="Stop Session"
                  >
                    <Square className="w-3 h-3 fill-current" />
                    <span className="text-[9px] font-bold uppercase tracking-widest">Stop</span>
                  </motion.button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>

        {/* History / Transcription Display */}
        <AnimatePresence>
          {isConnected && history.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full glass rounded-3xl p-6 md:p-8 space-y-6 max-h-[50vh] overflow-y-auto custom-scrollbar shadow-2xl"
            >
              {history.slice(-5).map((msg, idx) => (
                <div key={msg.timestamp + idx} className="flex gap-3 md:gap-4">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-white/20' : `${emotionStyles.bg.replace('40', '60')}`}`}>
                    {msg.role === 'user' ? <User className="w-4 h-4 text-white/90" /> : <Sparkles className={`w-4 h-4 ${emotionStyles.text}`} />}
                  </div>
                  <div className={`flex-1 ${msg.role === 'user' ? 'text-white/90 font-light italic text-sm md:text-base' : 'markdown-body text-white font-serif text-base md:text-xl leading-relaxed'}`}>
                    {msg.role === 'user' ? msg.text : <Markdown>{msg.text}</Markdown>}
                  </div>
                </div>
              ))}

              {/* Feedback Widget */}
              {history.length > 0 && history[history.length - 1].role === 'model' && feedbackStatus !== 'submitted' && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="pt-6 border-t border-white/10 flex flex-col gap-6"
                >
                  <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-white/5 p-4 rounded-2xl border border-white/5">
                    <div className="space-y-1">
                      <span className="text-[10px] md:text-xs font-bold uppercase tracking-widest text-white/80">Response Accuracy</span>
                      <p className="text-[9px] text-white/40 uppercase tracking-wider">Help us refine the emotional core</p>
                    </div>
                    <div className="flex gap-3">
                      <motion.button 
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => handleFeedback('positive')}
                        className={`p-3 rounded-xl transition-all flex items-center justify-center ${
                          feedbackStatus === 'positive' 
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.2)]' 
                            : 'bg-white/5 hover:bg-white/10 text-white/40 border border-white/5'
                        }`}
                      >
                        <ThumbsUp className={`w-5 h-5 ${feedbackStatus === 'positive' ? 'fill-current' : ''}`} />
                      </motion.button>
                      <motion.button 
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => handleFeedback('negative')}
                        className={`p-3 rounded-xl transition-all flex items-center justify-center ${
                          feedbackStatus === 'negative' 
                            ? 'bg-red-500/20 text-red-400 border border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.2)]' 
                            : 'bg-white/5 hover:bg-white/10 text-white/40 border border-white/5'
                        }`}
                      >
                        <ThumbsDown className={`w-5 h-5 ${feedbackStatus === 'negative' ? 'fill-current' : ''}`} />
                      </motion.button>
                    </div>
                  </div>

                  {feedbackStatus !== 'none' && (
                    <motion.div 
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      className="space-y-4 overflow-hidden"
                    >
                      <div className="relative group">
                        <textarea
                          value={feedbackText}
                          onChange={(e) => setFeedbackText(e.target.value)}
                          placeholder="What could be improved? (e.g. tone, empathy, accuracy...)"
                          className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-sm text-white/80 placeholder:text-white/20 focus:outline-none focus:border-orange-500/40 focus:bg-white/[0.07] transition-all resize-none h-28 custom-scrollbar"
                        />
                        <div className="absolute bottom-3 right-3 text-[9px] font-mono text-white/20 group-focus-within:text-orange-500/40 transition-colors">
                          {feedbackText.length} characters
                        </div>
                      </div>
                      <motion.button 
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={submitFeedback}
                        className="w-full py-3 bg-orange-500 text-white text-[10px] font-bold uppercase tracking-[0.2em] rounded-xl transition-all shadow-lg shadow-orange-500/20 hover:shadow-orange-500/40 flex items-center justify-center gap-2"
                      >
                        <Sparkles className="w-3 h-3" />
                        Submit Refinement
                      </motion.button>
                    </motion.div>
                  )}
                </motion.div>
              )}

              {feedbackStatus === 'submitted' && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="pt-4 border-t border-white/5 flex items-center justify-center gap-2 text-emerald-400"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Thank you for helping us refine Atlas</span>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Controls */}
        <AnimatePresence>
          {isConnected && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="flex items-center gap-4"
            >
              <button
                onClick={toggleMute}
                className={`p-4 rounded-full transition-all ${
                  isMuted ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-white/5 text-white/60 hover:bg-white/10 border border-white/10'
                }`}
              >
                {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
              </button>
              
              <button
                onClick={disconnect}
                className="flex items-center gap-2 px-8 py-4 rounded-full bg-red-500 text-white font-bold text-sm uppercase tracking-widest hover:bg-red-600 transition-all shadow-lg shadow-red-500/20"
              >
                <Square className="w-4 h-4 fill-current" />
                Stop
              </button>

              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10">
                <Heart className={`w-4 h-4 ${emotionStyles.text}`} />
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/60">Empathy Active</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer Info */}
        {!isConnected && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 w-full border-t border-white/10 pt-12"
          >
            <div className="space-y-3 p-4 rounded-2xl bg-white/5 border border-white/5">
              <Brain className="w-6 h-6 text-orange-400" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-white">Neural Analysis</h3>
              <p className="text-white/60 text-[11px] leading-relaxed">Real-time emotional processing and sentiment detection.</p>
            </div>
            <div className="space-y-3 p-4 rounded-2xl bg-white/5 border border-white/5">
              <Heart className="w-6 h-6 text-orange-400" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-white">Empathetic Core</h3>
              <p className="text-white/60 text-[11px] leading-relaxed">Designed to provide comfort and understanding through voice.</p>
            </div>
            <div className="space-y-3 p-4 rounded-2xl bg-white/5 border border-white/5">
              <Volume2 className="w-6 h-6 text-orange-400" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-white">Natural Voice</h3>
              <p className="text-white/60 text-[11px] leading-relaxed">Fluid, human-like conversation with low latency.</p>
            </div>
          </motion.div>
        )}

        {/* Voice Commands Help */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="w-full glass rounded-2xl p-4 md:p-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-4"
        >
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/60 w-full text-center md:w-auto">Voice Commands:</span>
          {[
            { cmd: "ATLAS Start", desc: "Activate" },
            { cmd: "ATLAS Stop", desc: "Stop Session" },
            { cmd: "ATLAS Mute", desc: "Silence Mic" },
            { cmd: "ATLAS Unmute", desc: "Resume Mic" },
            { cmd: "ATLAS Feedback", desc: "Rate Positive" }
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-xl border border-white/10">
              <code className="text-[10px] font-mono text-orange-400 font-bold">"{item.cmd}"</code>
              <span className="text-[9px] font-bold uppercase tracking-widest text-white/60">{item.desc}</span>
            </div>
          ))}
        </motion.div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}</style>

      {/* Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSettingsOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md glass rounded-[32px] p-6 md:p-8 space-y-6 md:space-y-8 max-h-[90vh] overflow-y-auto custom-scrollbar"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-orange-500/20 text-orange-400">
                    <Sliders className="w-5 h-5" />
                  </div>
                  <h2 className="text-xl font-serif italic">Voice Parameters</h2>
                </div>
                <button 
                  onClick={() => setIsSettingsOpen(false)}
                  className="p-2 rounded-full hover:bg-white/5 text-white/40 hover:text-white transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-6">
                {/* Voice Selection */}
                <div className="space-y-3">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-white/40 flex items-center gap-2">
                    <User className="w-3 h-3" /> Persona
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir'].map((name) => (
                      <button
                        key={name}
                        onClick={() => setVoiceSettings(prev => ({ ...prev, voiceName: name as any }))}
                        className={`py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest border transition-all ${
                          voiceSettings.voiceName === name 
                            ? 'bg-orange-500/20 border-orange-500/40 text-orange-400' 
                            : 'bg-white/5 border-white/5 text-white/40 hover:bg-white/10'
                        }`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Tone Selection */}
                <div className="space-y-3">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-white/40 flex items-center gap-2">
                    <Heart className="w-3 h-3" /> Emotional Tone
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {['Empathetic', 'Professional', 'Calm', 'Energetic'].map((tone) => (
                      <button
                        key={tone}
                        onClick={() => setVoiceSettings(prev => ({ ...prev, tone: tone as any }))}
                        className={`py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest border transition-all ${
                          voiceSettings.tone === tone 
                            ? 'bg-orange-500/20 border-orange-500/40 text-orange-400' 
                            : 'bg-white/5 border-white/5 text-white/40 hover:bg-white/10'
                        }`}
                      >
                        {tone}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Speed Slider */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-white/40">Speed</label>
                    <span className="text-[10px] font-mono text-orange-400">{voiceSettings.speed.toFixed(1)}x</span>
                  </div>
                  <input 
                    type="range" 
                    min="0.5" 
                    max="2.0" 
                    step="0.1"
                    value={voiceSettings.speed}
                    onChange={(e) => setVoiceSettings(prev => ({ ...prev, speed: parseFloat(e.target.value) }))}
                    className="w-full accent-orange-500 bg-white/10 rounded-lg h-1 appearance-none cursor-pointer"
                  />
                </div>

                {/* Pitch Slider */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-white/40">Pitch</label>
                    <span className="text-[10px] font-mono text-orange-400">{voiceSettings.pitch > 0 ? '+' : ''}{voiceSettings.pitch} cents</span>
                  </div>
                  <input 
                    type="range" 
                    min="-1200" 
                    max="1200" 
                    step="100"
                    value={voiceSettings.pitch}
                    onChange={(e) => setVoiceSettings(prev => ({ ...prev, pitch: parseInt(e.target.value) }))}
                    className="w-full accent-orange-500 bg-white/10 rounded-lg h-1 appearance-none cursor-pointer"
                  />
                </div>

                {/* Memory Management */}
                <div className="pt-4 border-t border-white/10 space-y-4">
                  <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-red-500/20 text-red-400">
                        <X className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">Clear Memory</p>
                        <p className="text-xs text-white/40">Erase all previous conversation history</p>
                      </div>
                    </div>
                    <button 
                      onClick={clearHistory}
                      className="px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-bold transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>

              <div className="pt-4">
                <button 
                  onClick={() => setIsSettingsOpen(false)}
                  className="w-full py-4 rounded-2xl bg-white text-black font-bold text-xs uppercase tracking-widest hover:bg-white/90 transition-all"
                >
                  Apply & Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
