import { useChatStore } from "@/stores/chatStore";

export function ChatsList() {
  const companions = useChatStore((s) => s.companions);
  const activeId = useChatStore((s) => s.activeCompanionId);
  const switchCompanion = useChatStore((s) => s.switchCompanion);
  const messages = useChatStore((s) => s.messages);
  const openCompanionEditor = useChatStore((s) => s.openCompanionEditor);

  // Get last message for the active companion (we only have messages for the active one loaded)
  const getPreview = (companionId: string) => {
    if (companionId === activeId && messages.length > 0) {
      const last = messages[messages.length - 1];
      return {
        text: last.content.slice(0, 50) + (last.content.length > 50 ? "..." : ""),
        time: last.timestamp,
      };
    }
    return { text: "Click to open chat", time: null };
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {companions.map((companion) => {
          const preview = getPreview(companion.id);
          return (
            <button
              key={companion.id}
              onClick={() => switchCompanion(companion.id)}
              className={`group w-full flex items-center gap-3 p-3 rounded-lg transition-all duration-200 text-left ${
                activeId === companion.id
                  ? "glass glow-border-subtle bg-heartline-soft"
                  : "hover:bg-surface-hover"
              }`}
            >
              {/* Avatar circle */}
              <div className="relative shrink-0">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
                    activeId === companion.id
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
                <div className="flex items-center justify-between">
                  <span
                    className={`font-medium text-sm ${
                      activeId === companion.id
                        ? "text-heartline"
                        : "text-text-primary"
                    }`}
                  >
                    {companion.name}
                  </span>
                  <span className="text-xs text-text-muted">
                    {preview.time ? formatTime(preview.time) : ""}
                  </span>
                </div>
                <p className="text-xs text-text-secondary truncate mt-0.5">
                  {preview.text}
                </p>
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

function formatTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const hours = diff / (1000 * 60 * 60);

  if (hours < 1) return "Now";
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
