import { useState, useEffect, useRef } from "react";

export interface MemorySaveEvent {
  type: "memory";
  companion_id: string;
  count: number;
}

export interface JournalSaveEvent {
  type: "journal";
  companion_id: string;
  count: number;
}

export function MemorySaveToast() {
  const [event, setEvent] = useState<MemorySaveEvent | JournalSaveEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const showToast = (evt: MemorySaveEvent | JournalSaveEvent) => {
      // Clear any pending hide timer
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }

      setEvent(evt);
      setVisible(true);

      // Auto-hide after 4 seconds
      hideTimer.current = setTimeout(() => {
        setVisible(false);
        setEvent(null);
        hideTimer.current = null;
      }, 4000);
    };

    // Listen for CustomEvents from chatStore
    const handleCustomEvent = (e: any) => {
      console.log("[Toast] CustomEvent received:", e.detail);
      showToast(e.detail);
    };

    window.addEventListener("memory-saved", handleCustomEvent);
    window.addEventListener("journal-saved", handleCustomEvent);

    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      window.removeEventListener("memory-saved", handleCustomEvent);
      window.removeEventListener("journal-saved", handleCustomEvent);
    };
  }, []);

  if (!visible || !event) return null;

  return (
    <div
      className={`
        fixed bottom-6 left-1/2 -translate-x-1/2 z-[100]
        animate-toast-in
      `}
    >
      <div
        className={`
          flex items-center gap-3 px-5 py-3 rounded-xl
          glass glow-border-subtle backdrop-blur-xl
          shadow-lg shadow-black/30
          border transition-colors duration-300
          ${event.type === "memory"
            ? "border-emerald-500/40"
            : "border-amber-500/40"
          }
        `}
      >
        {/* Icon */}
        <div className="flex-shrink-0">
          {event.type === "memory" ? (
            <span className="text-emerald-400 text-base">✓</span>
          ) : (
            <span className="text-amber-400 text-base">★</span>
          )}
        </div>

        {/* Message */}
        <span
          className={`text-sm font-medium ${
            event.type === "memory" ? "text-emerald-300" : "text-amber-300"
          }`}
        >
          {event.type === "memory" ? "Memory added" : "Journal entry saved"}
        </span>

        {/* Count badge */}
        <span
          className={`
            flex-shrink-0 ml-2 text-xs font-mono px-2 py-1 rounded-full
            ${event.type === "memory"
              ? "bg-emerald-500/20 text-emerald-300"
              : "bg-amber-500/20 text-amber-300"
            }
          `}
        >
          {event.count}
        </span>
      </div>
    </div>
  );
}
