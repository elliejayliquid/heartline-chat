import { useEffect } from "react";
import { TitleBar } from "./components/layout/TitleBar";
import { PanelLayout } from "./components/layout/PanelLayout";
import { ModelPullToast } from "./components/layout/ModelPullToast";
import { SettingsPanel } from "./components/settings/SettingsPanel";
import { CompanionEditor } from "./components/companions/CompanionEditor";
import { useChatStore } from "./stores/chatStore";

export default function App() {
  const initialize = useChatStore((s) => s.initialize);
  const initialized = useChatStore((s) => s.initialized);

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    initialize().then((cleanupFn) => {
      cleanup = cleanupFn;
    });

    return () => {
      cleanup?.();
    };
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

      {/* Modals (overlay everything) */}
      <SettingsPanel />
      <CompanionEditor />

      {/* Toast notifications */}
      <ModelPullToast />
    </div>
  );
}
