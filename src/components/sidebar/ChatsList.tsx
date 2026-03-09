import { useState, useRef, useEffect } from "react";
import { useChatStore } from "@/stores/chatStore";
import type { Conversation } from "@/lib/tauri";

export function ChatsList() {
  const companions = useChatStore((s) => s.companions);
  const activeCompanionId = useChatStore((s) => s.activeCompanionId);
  const conversations = useChatStore((s) => s.conversations);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const switchCompanion = useChatStore((s) => s.switchCompanion);
  const switchConversation = useChatStore((s) => s.switchConversation);
  const createConversation = useChatStore((s) => s.createConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const openCompanionEditor = useChatStore((s) => s.openCompanionEditor);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {companions.map((companion) => {
          const isActive = activeCompanionId === companion.id;

          return (
            <div key={companion.id}>
              {/* Companion row */}
              <button
                onClick={() => switchCompanion(companion.id)}
                className={`group w-full flex items-center gap-3 p-3 rounded-lg transition-all duration-200 text-left focus:outline-none ${
                  isActive
                    ? "glass glow-border-subtle bg-heartline-soft"
                    : "hover:bg-surface-hover"
                }`}
              >
                {/* Avatar circle */}
                <div className="relative shrink-0">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
                      isActive
                        ? "bg-heartline/20 text-heartline border border-heartline/50"
                        : "bg-space-600 text-text-secondary border border-surface-border"
                    }`}
                  >
                    {companion.name[0]}
                  </div>
                  {/* Online indicator */}
                  <div
                    className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-space-800 ${
                      companion.status === "Online"
                        ? "bg-heartline"
                        : "bg-text-muted"
                    }`}
                  />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <span
                    className={`font-medium text-sm ${
                      isActive ? "text-heartline" : "text-text-primary"
                    }`}
                  >
                    {companion.name}
                  </span>
                  {!isActive && (
                    <p className="text-xs text-text-secondary truncate mt-0.5">
                      Click to open
                    </p>
                  )}
                </div>

                {/* Edit button (visible on hover) */}
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    openCompanionEditor(companion);
                  }}
                  className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-surface-hover text-text-muted hover:text-heartline transition-all cursor-pointer"
                  title="Edit companion"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                  </svg>
                </div>
              </button>

              {/* Conversation list (expanded when companion is active) */}
              {isActive && conversations.length > 0 && (
                <div className="ml-6 mt-1 space-y-0.5">
                  {conversations.map((conv) => (
                    <ConversationRow
                      key={conv.id}
                      conversation={conv}
                      isActive={activeConversationId === conv.id}
                      onSwitch={() => switchConversation(conv.id)}
                      onDelete={
                        conversations.length > 1
                          ? () => deleteConversation(conv.id)
                          : undefined
                      }
                      onRename={(title) => renameConversation(conv.id, title)}
                    />
                  ))}

                  {/* New Chat button inline */}
                  <button
                    onClick={() => createConversation()}
                    className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs text-text-muted hover:text-heartline hover:bg-surface-hover transition-all focus:outline-none"
                  >
                    <svg
                      width="10"
                      height="10"
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
              )}
            </div>
          );
        })}
      </div>

      {/* New Companion button */}
      <div className="p-2 border-t border-surface-border">
        <button
          onClick={() => openCompanionEditor()}
          className="w-full flex items-center justify-center gap-2 p-2.5 rounded-lg glass glass-hover text-text-secondary hover:text-heartline transition-all focus:outline-none"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <line x1="7" y1="1" x2="7" y2="13" />
            <line x1="1" y1="7" x2="13" y2="7" />
          </svg>
          <span className="text-xs">New Companion</span>
        </button>
      </div>
    </div>
  );
}

function ConversationRow({
  conversation,
  isActive,
  onSwitch,
  onDelete,
  onRename,
}: {
  conversation: Conversation;
  isActive: boolean;
  onSwitch: () => void;
  onDelete?: () => void;
  onRename: (title: string) => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(conversation.title);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-clear delete confirmation after 3 seconds
  useEffect(() => {
    if (!confirmingDelete) return;
    const timer = setTimeout(() => setConfirmingDelete(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmingDelete]);

  // Focus input when entering rename mode
  useEffect(() => {
    if (isRenaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isRenaming]);

  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== conversation.title) {
      onRename(trimmed);
    }
    setIsRenaming(false);
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmingDelete) {
      onDelete?.();
      setConfirmingDelete(false);
    } else {
      setConfirmingDelete(true);
    }
  };

  return (
    <button
      onClick={onSwitch}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setRenameValue(conversation.title);
        setIsRenaming(true);
      }}
      className={`group/conv w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-left transition-all focus:outline-none ${
        isActive
          ? "bg-heartline/10 text-heartline"
          : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
      }`}
    >
      {/* Chat icon */}
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>

      {/* Title — inline rename on double-click */}
      {isRenaming ? (
        <input
          ref={inputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={handleRenameSubmit}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRenameSubmit();
            if (e.key === "Escape") {
              setRenameValue(conversation.title);
              setIsRenaming(false);
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 text-xs bg-space-700 border border-heartline/30 rounded px-1.5 py-0.5 text-text-primary focus:outline-none focus:border-heartline/60 min-w-0"
        />
      ) : (
        <span className="flex-1 text-xs truncate">{conversation.title}</span>
      )}

      {/* Delete button with confirmation */}
      {onDelete && !isRenaming && (
        <div
          onClick={handleDeleteClick}
          className={`shrink-0 rounded flex items-center justify-center transition-all cursor-pointer ${
            confirmingDelete
              ? "opacity-100 px-1.5 py-0.5 bg-red-500/20 text-red-400 text-[10px]"
              : "w-5 h-5 opacity-0 group-hover/conv:opacity-100 hover:bg-red-500/20 text-text-muted hover:text-red-400"
          }`}
          title={confirmingDelete ? "Click again to confirm" : "Delete conversation"}
        >
          {confirmingDelete ? (
            "Delete?"
          ) : (
            <svg
              width="10"
              height="10"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <line x1="1" y1="1" x2="13" y2="13" />
              <line x1="13" y1="1" x2="1" y2="13" />
            </svg>
          )}
        </div>
      )}
    </button>
  );
}
