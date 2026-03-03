import { getCurrentWindow } from "@tauri-apps/api/window";
import { useChatStore } from "@/stores/chatStore";

export function TitleBar() {
  const appWindow = getCurrentWindow();
  const backendConfigured = useChatStore((s) => s.backendConfigured);
  const setSettingsOpen = useChatStore((s) => s.setSettingsOpen);

  return (
    <div className="titlebar h-10 flex items-center justify-between px-4 glass border-b border-surface-border bg-space-900/90 relative z-50">
      {/* Logo and heartline */}
      <div className="titlebar-drag flex items-center gap-3 flex-1">
        <HeartlineLogo />
        <span className={`text-xs tracking-widest uppercase ${backendConfigured ? "text-text-secondary" : "text-accent-warm"}`}>
          {backendConfigured ? "Signal: Connected" : "Signal: Not Configured"}
        </span>
      </div>

      {/* Window controls */}
      <div className="titlebar-nodrag flex items-center gap-1">
        {/* Settings button */}
        <button
          onClick={() => setSettingsOpen(true)}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-surface-hover text-text-secondary hover:text-heartline transition-colors"
          title="Settings"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
        <div className="w-px h-4 bg-surface-border mx-1" />
        <button
          onClick={() => appWindow.minimize()}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-surface-hover text-text-secondary hover:text-text-primary transition-colors"
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
            <rect width="10" height="1" />
          </svg>
        </button>
        <button
          onClick={() => appWindow.toggleMaximize()}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-surface-hover text-text-secondary hover:text-text-primary transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="0.5" y="0.5" width="9" height="9" />
          </svg>
        </button>
        <button
          onClick={() => appWindow.close()}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-red-500/30 text-text-secondary hover:text-red-400 transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
            <line x1="1" y1="1" x2="9" y2="9" />
            <line x1="9" y1="1" x2="1" y2="9" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function HeartlineLogo() {
  return (
    <div className="flex items-center gap-2">
      {/* Heart icon */}
      <svg width="20" height="20" viewBox="0 0 32 32" fill="none" className="text-heartline">
        <path
          d="M16 28S3 20 3 12a6.5 6.5 0 0 1 13-1 6.5 6.5 0 0 1 13 1c0 8-13 16-13 16z"
          fill="currentColor"
          opacity="0.2"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M6 16h5l2-4 3 8 2-6 2 3h6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
      <span className="font-display font-bold text-lg tracking-wider text-heartline glow-text">
        HEARTLINE
      </span>
    </div>
  );
}
