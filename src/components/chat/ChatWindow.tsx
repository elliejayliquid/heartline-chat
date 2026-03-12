import { useState, useRef, useEffect, useCallback } from "react";
import { useChatStore } from "@/stores/chatStore";
import type { Message } from "@/stores/chatStore";
import { api } from "@/lib/tauri";

type MicState = "idle" | "recording" | "transcribing";

export function ChatWindow() {
  const messages = useChatStore((s) => s.messages);
  const isGenerating = useChatStore((s) => s.isGenerating);
  const streamingContent = useChatStore((s) => s.streamingContent);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const backendConfigured = useChatStore((s) => s.backendConfigured);
  const setSettingsOpen = useChatStore((s) => s.setSettingsOpen);
  const activeCompanionId = useChatStore((s) => s.activeCompanionId);
  const companions = useChatStore((s) => s.companions);
  const conversations = useChatStore((s) => s.conversations);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const createConversation = useChatStore((s) => s.createConversation);

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Voice recording state
  const [micState, setMicState] = useState<MicState>("idle");
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const activeCompanion = companions.find((c) => c.id === activeCompanionId);
  const activeConversation = conversations.find(
    (c) => c.id === activeConversationId
  );

  // Auto-scroll to bottom on new messages or streaming
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  // Auto-resize textarea as content changes
  const resizeTextarea = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 150) + "px";
  };

  useEffect(() => {
    resizeTextarea();
  }, [input]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isGenerating) return;

    setInput("");
    sendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  /** Encode f32 PCM samples as a 16-bit WAV file */
  const encodeWav = useCallback((samples: Float32Array, sampleRate: number): ArrayBuffer => {
    const numSamples = samples.length;
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    // WAV header
    const writeStr = (offset: number, s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
    };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + numSamples * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);          // chunk size
    view.setUint16(20, 1, true);           // PCM
    view.setUint16(22, 1, true);           // mono
    view.setUint32(24, sampleRate, true);   // sample rate
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true);           // block align
    view.setUint16(34, 16, true);          // bits per sample
    writeStr(36, "data");
    view.setUint32(40, numSamples * 2, true);

    // Convert f32 [-1,1] to i16
    for (let i = 0; i < numSamples; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true);
    }
    return buffer;
  }, []);

  const handleMicClick = useCallback(async () => {
    if (micState === "recording") {
      // Stop recording
      mediaRecorderRef.current?.stop();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return; // handleDataAvailable will process the audio
    }

    if (micState === "transcribing") return; // Already processing

    // Start recording
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      setRecordingTime(0);

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        // Stop all tracks (release microphone)
        stream.getTracks().forEach((t) => t.stop());

        setMicState("transcribing");
        try {
          const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });

          // Decode to raw PCM using Web Audio API
          const arrayBuf = await blob.arrayBuffer();
          const audioCtx = new AudioContext();
          const decoded = await audioCtx.decodeAudioData(arrayBuf);

          // Resample to 16kHz mono
          const offlineCtx = new OfflineAudioContext(1, decoded.duration * 16000, 16000);
          const source = offlineCtx.createBufferSource();
          source.buffer = decoded;
          source.connect(offlineCtx.destination);
          source.start();
          const resampled = await offlineCtx.startRendering();
          const pcm = resampled.getChannelData(0);

          await audioCtx.close();

          // Encode as WAV
          const wavBuf = encodeWav(pcm, 16000);

          // Send to backend as byte array
          const wavBytes = Array.from(new Uint8Array(wavBuf));
          const text = await api.transcribeAudio(wavBytes);

          if (text.trim()) {
            setInput((prev) => (prev ? prev + " " + text.trim() : text.trim()));
            // Focus textarea
            textareaRef.current?.focus();
          }
        } catch (err) {
          console.error("[Whisper] Transcription failed:", err);
        } finally {
          setMicState("idle");
        }
      };

      mediaRecorder.start();
      setMicState("recording");

      // Recording timer
      timerRef.current = setInterval(() => {
        setRecordingTime((t) => t + 1);
      }, 1000);
    } catch (err) {
      console.error("[Whisper] Failed to access microphone:", err);
      setMicState("idle");
    }
  }, [micState, encodeWav]);

  return (
    <div className="h-full flex flex-col">
      {/* Conversation header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-surface-border">
        <div className="flex items-center gap-2 min-w-0">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-text-muted"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span className="text-xs text-text-secondary truncate">
            {activeConversation?.title ?? "No conversation"}
          </span>
        </div>
        <button
          onClick={() => createConversation()}
          className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-text-muted hover:text-heartline hover:bg-surface-hover transition-all focus:outline-none"
          title="Start a new chat"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <line x1="7" y1="1" x2="7" y2="13" />
            <line x1="1" y1="7" x2="13" y2="7" />
          </svg>
          New Chat
        </button>
      </div>

      {/* Backend not configured banner */}
      {!backendConfigured && (
        <div className="mx-3 mt-3 p-3 rounded-lg bg-accent-warm/10 border border-accent-warm/30 text-sm">
          <p className="text-accent-warm font-medium">No AI backend configured</p>
          <p className="text-text-secondary text-xs mt-1">
            <button
              onClick={() => setSettingsOpen(true)}
              className="text-heartline underline hover:no-underline"
            >
              Open Settings
            </button>
            {" "}to add your API key and start chatting.
          </p>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && backendConfigured && (
          <div className="flex items-center justify-center h-full">
            <p className="text-text-muted text-sm">
              Say hello to {activeCompanion?.name ?? "your companion"}!
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Streaming response - shows tokens as they arrive */}
        {isGenerating && streamingContent && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-2xl rounded-bl-md px-4 py-2.5 text-sm leading-relaxed glass border-heartline/10">
              <p className="whitespace-pre-wrap break-words overflow-hidden">{streamingContent}</p>
              <span className="inline-block w-2 h-4 bg-heartline/60 animate-pulse ml-0.5" />
            </div>
          </div>
        )}

        {/* Typing indicator - before any tokens arrive */}
        {isGenerating && !streamingContent && (
          <div className="flex items-center gap-2 px-4 py-2">
            <div className="flex gap-1">
              <span className="w-2 h-2 rounded-full bg-heartline animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-2 h-2 rounded-full bg-heartline animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-2 h-2 rounded-full bg-heartline animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
            <span className="text-xs text-text-muted">
              {activeCompanion?.name ?? "Companion"} is thinking...
            </span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="p-3 border-t border-surface-border">
        <div className="flex items-end gap-2">
          {/* Voice input button */}
          <button
            onClick={handleMicClick}
            disabled={!backendConfigured || micState === "transcribing"}
            className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center transition-all ${micState === "recording"
                ? "bg-red-500/20 text-red-400 border border-red-500/50 animate-pulse"
                : micState === "transcribing"
                  ? "glass text-heartline cursor-wait"
                  : "glass glass-hover text-text-secondary hover:text-heartline"
              }`}
            title={
              micState === "recording"
                ? `Recording... ${recordingTime}s — click to stop`
                : micState === "transcribing"
                  ? "Transcribing..."
                  : "Voice input"
            }
          >
            {micState === "transcribing" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="8" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
            )}
          </button>
          {micState === "recording" && (
            <span className="absolute -top-6 left-0 text-[10px] text-red-400 animate-pulse">
              🔴 {recordingTime}s
            </span>
          )}

          {/* Text input */}
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                backendConfigured
                  ? "Type your message..."
                  : "Configure API key in Settings first..."
              }
              rows={1}
              disabled={!backendConfigured}
              className="w-full bg-space-700/50 border border-surface-border rounded-lg px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted resize-none overflow-y-auto focus:outline-none focus:border-heartline/50 focus:glow-border-subtle transition-all disabled:opacity-50"
            />
          </div>

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={!input.trim() || isGenerating || !backendConfigured}
            className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center transition-all ${input.trim() && !isGenerating && backendConfigured
              ? "bg-heartline/20 text-heartline border border-heartline/50 hover:bg-heartline/30 glow-border-subtle"
              : "glass text-text-muted cursor-not-allowed"
              }`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 12 14-7-4 7 4 7Z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Match ***bold italic***, **bold**, *italic* — order matters (longest first)
  const regex = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Push text before the match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[2]) {
      // ***bold italic***
      parts.push(<strong key={match.index}><em>{match[2]}</em></strong>);
    } else if (match[3]) {
      // **bold**
      parts.push(<strong key={match.index}>{match[3]}</strong>);
    } else if (match[4]) {
      // *italic*
      parts.push(<em key={match.index}>{match[4]}</em>);
    }

    lastIndex = match.index + match[0].length;
  }

  // Push remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${isUser
          ? "bg-heartline/15 border border-heartline/30 text-text-primary rounded-br-md"
          : "glass border-heartline/10 text-text-primary rounded-bl-md"
          }`}
      >
        <p className="whitespace-pre-wrap break-words overflow-hidden">
          {isUser ? message.content : renderInlineMarkdown(message.content)}
        </p>
        <p className={`text-[10px] mt-1 ${isUser ? "text-heartline-dim" : "text-text-muted"}`}>
          {formatTimestamp(message.timestamp)}
        </p>
      </div>
    </div>
  );
}

function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
