import { useState, useEffect, useRef } from "react";
import { onModelPullStatus } from "@/lib/tauri";

export function ModelPullToast() {
    const [message, setMessage] = useState<string | null>(null);
    const [visible, setVisible] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);
    const [isError, setIsError] = useState(false);
    const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        let unlisten: (() => void) | undefined;

        onModelPullStatus((status) => {
            // Clear any pending hide timer
            if (hideTimer.current) {
                clearTimeout(hideTimer.current);
                hideTimer.current = null;
            }

            setMessage(status);
            setIsSuccess(status.includes("✓") || status.includes("ready"));
            setIsError(status.includes("✗") || status.includes("⚠"));
            setVisible(true);

            // Auto-hide after a delay for success/completion messages
            if (
                status.includes("ready") ||
                status.includes("✓") ||
                status.includes("✗") ||
                status.includes("⚠")
            ) {
                hideTimer.current = setTimeout(() => {
                    setVisible(false);
                }, 5000);
            }
        }).then((fn) => {
            unlisten = fn;
        });

        return () => {
            unlisten?.();
            if (hideTimer.current) clearTimeout(hideTimer.current);
        };
    }, []);

    if (!visible || !message) return null;

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
          ${isError
                        ? "border-red-500/40"
                        : isSuccess
                            ? "border-emerald-500/40"
                            : "border-heartline/30"
                    }
        `}
            >
                {/* Animated icon */}
                <div className="flex-shrink-0">
                    {isSuccess ? (
                        <span className="text-emerald-400 text-base">✓</span>
                    ) : isError ? (
                        <span className="text-red-400 text-base">✗</span>
                    ) : (
                        <div className="w-4 h-4 relative">
                            <div
                                className="absolute inset-0 rounded-full border-2 border-heartline/30 border-t-heartline animate-spin"
                            />
                        </div>
                    )}
                </div>

                {/* Message */}
                <span
                    className={`text-sm font-medium ${isError
                            ? "text-red-300"
                            : isSuccess
                                ? "text-emerald-300"
                                : "text-text-primary"
                        }`}
                >
                    {message}
                </span>

                {/* Close button */}
                <button
                    onClick={() => setVisible(false)}
                    className="flex-shrink-0 ml-1 w-5 h-5 rounded flex items-center justify-center text-text-muted hover:text-text-primary transition-colors"
                >
                    <svg
                        width="8"
                        height="8"
                        viewBox="0 0 8 8"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                    >
                        <line x1="1" y1="1" x2="7" y2="7" />
                        <line x1="7" y1="1" x2="1" y2="7" />
                    </svg>
                </button>
            </div>
        </div>
    );
}
