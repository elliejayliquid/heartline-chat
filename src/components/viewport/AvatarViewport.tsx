import { useChatStore } from "@/stores/chatStore";

/**
 * Placeholder for the 3D avatar viewport.
 * Phase 4 will replace this with React Three Fiber.
 */
export function AvatarViewport() {
  const isGenerating = useChatStore((s) => s.isGenerating);

  return (
    <div className="h-full flex flex-col items-center justify-center relative overflow-hidden">
      {/* Background nebula effect */}
      <div className="absolute inset-0 bg-gradient-radial from-heartline/5 via-transparent to-transparent" />

      {/* Avatar placeholder - pulsing silhouette */}
      <div className="relative">
        <div
          className={`w-32 h-32 rounded-full border-2 flex items-center justify-center transition-all duration-1000 ${
            isGenerating
              ? "border-heartline glow-border animate-pulse"
              : "border-heartline-dim glow-border-subtle"
          }`}
        >
          {/* Simple avatar silhouette */}
          <svg
            width="64"
            height="64"
            viewBox="0 0 64 64"
            fill="none"
            className="text-heartline-dim"
          >
            <circle cx="32" cy="22" r="12" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M12 56c0-11 9-20 20-20s20 9 20 20"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </div>

        {/* Orbital ring */}
        <div
          className={`absolute inset-[-20px] rounded-full border border-heartline/10 ${
            isGenerating ? "animate-spin" : ""
          }`}
          style={{ animationDuration: "8s" }}
        />
        <div
          className={`absolute inset-[-40px] rounded-full border border-accent-purple/10 ${
            isGenerating ? "animate-spin" : ""
          }`}
          style={{ animationDuration: "12s", animationDirection: "reverse" }}
        />
      </div>

      {/* Status text */}
      <p className="mt-6 text-text-secondary text-sm">
        {isGenerating ? (
          <span className="text-heartline animate-pulse-glow">Thinking...</span>
        ) : (
          <span>3D Avatar - Coming in Phase 4</span>
        )}
      </p>

      {/* Companion name */}
      <p className="mt-2 font-display text-lg font-semibold text-heartline glow-text">
        Nova
      </p>
      <p className="text-xs text-text-muted">Online</p>
    </div>
  );
}
