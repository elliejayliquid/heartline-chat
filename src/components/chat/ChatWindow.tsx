import { useState, useRef, useEffect } from "react";
import { useChatStore } from "@/stores/chatStore";
import type { Message } from "@/stores/chatStore";

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
          {/* Voice button placeholder */}
          <button
            className="shrink-0 w-10 h-10 rounded-lg glass glass-hover flex items-center justify-center text-text-secondary hover:text-heartline transition-colors"
            title="Voice chat (Phase 5)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
          </button>

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
            className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center transition-all ${
              input.trim() && !isGenerating && backendConfigured
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

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-heartline/15 border border-heartline/30 text-text-primary rounded-br-md"
            : "glass border-heartline/10 text-text-primary rounded-bl-md"
        }`}
      >
        <p className="whitespace-pre-wrap break-words overflow-hidden">{message.content}</p>
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
