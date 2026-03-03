import { useEffect } from "react";
import { TitleBar } from "./components/layout/TitleBar";
import { PanelLayout } from "./components/layout/PanelLayout";
import { SettingsPanel } from "./components/settings/SettingsPanel";
import { useChatStore } from "./stores/chatStore";

export default function App() {
  const initialize = useChatStore((s) => s.initialize);
  const initialized = useChatStore((s) => s.initialized);

  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
    <div className="h-screen flex flex-col bg-space-900">
      {/* Starfield background */}
      <div className="starfield" />

      {/* Custom title bar */}
      <TitleBar />

      {/* Main content with panels */}
      {initialized ? (
        <PanelLayout />
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-heartline animate-pulse-glow font-display text-lg">
            Initializing...
          </div>
        </div>
      )}

      {/* Settings modal (overlays everything) */}
      <SettingsPanel />
    </div>
  );
}
