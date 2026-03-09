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
                className={`group w-full flex items-center gap-3 p-3 rounded-lg transition-all duration-200 text-left ${
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
                    />
                  ))}

                  {/* New Chat button inline */}
                  <button
                    onClick={() => createConversation()}
                    className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs text-text-muted hover:text-heartline hover:bg-surface-hover transition-all"
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
          className="w-full flex items-center justify-center gap-2 p-2.5 rounded-lg glass glass-hover text-text-secondary hover:text-heartline transition-all"
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
}: {
  conversation: Conversation;
  isActive: boolean;
  onSwitch: () => void;
  onDelete?: () => void;
}) {
  return (
    <button
      onClick={onSwitch}
      className={`group/conv w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-left transition-all ${
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

      <span className="flex-1 text-xs truncate">{conversation.title}</span>

      {/* Delete button (visible on hover, only if more than 1 conversation) */}
      {onDelete && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="shrink-0 w-5 h-5 rounded flex items-center justify-center opacity-0 group-hover/conv:opacity-100 hover:bg-red-500/20 text-text-muted hover:text-red-400 transition-all cursor-pointer"
          title="Delete conversation"
        >
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
        </div>
      )}
    </button>
  );
}
