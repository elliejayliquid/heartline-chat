import { create } from "zustand";
import {
  api,
  onStreamChunk,
  onStreamError,
  type CompanionProfile,
  type StoredMessage,
  type AppSettings,
} from "@/lib/tauri";
import type { UnlistenFn } from "@tauri-apps/api/event";

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  emotion?: string;
}

interface ChatState {
  // Current conversation
  messages: Message[];
  isGenerating: boolean;
  streamingContent: string;

  // Companions
  companions: CompanionProfile[];
  activeCompanionId: string | null;

  // Settings
  settings: AppSettings | null;
  backendConfigured: boolean;
  settingsOpen: boolean;

  // Initialization
  initialized: boolean;

  // Actions
  initialize: () => Promise<() => void>;
  sendMessage: (content: string) => Promise<void>;
  switchCompanion: (id: string) => Promise<void>;
  loadSettings: () => Promise<void>;
  saveSettings: (settings: AppSettings) => Promise<void>;
  setSettingsOpen: (open: boolean) => void;
}

// Guard against React StrictMode double-mounting
let listenersSetUp = false;
let unlistenChunk: UnlistenFn | null = null;
let unlistenError: UnlistenFn | null = null;

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isGenerating: false,
  streamingContent: "",
  companions: [],
  activeCompanionId: null,
  settings: null,
  backendConfigured: false,
  settingsOpen: false,
  initialized: false,

  initialize: async () => {
    if (get().initialized) return () => {};

    try {
      // Load companions from database
      const companions = await api.getCompanions();
      const activeId = companions.length > 0 ? companions[0].id : null;

      // Load messages for the active companion
      let messages: Message[] = [];
      if (activeId) {
        const stored = await api.getMessages(activeId, 100);
        messages = stored.map(storedToMessage);
      }

      // Check if backend is configured
      const backendConfigured = await api.checkBackendStatus();

      // Load settings
      const settings = await api.getSettings();

      set({
        companions,
        activeCompanionId: activeId,
        messages,
        backendConfigured,
        settings,
        initialized: true,
        settingsOpen: !backendConfigured,
      });

      // Set up streaming listeners ONCE (module-level guard against StrictMode)
      if (!listenersSetUp) {
        listenersSetUp = true;

        unlistenChunk?.();
        unlistenError?.();

        unlistenChunk = await onStreamChunk((chunk) => {
          if (chunk.done) {
            const content = get().streamingContent;
            if (content) {
              set((state) => ({
                messages: [
                  ...state.messages,
                  {
                    id: crypto.randomUUID(),
                    role: "assistant" as const,
                    content,
                    timestamp: new Date(),
                  },
                ],
                streamingContent: "",
                isGenerating: false,
              }));
            } else {
              set({ isGenerating: false });
            }
          } else {
            set((state) => ({
              streamingContent: state.streamingContent + chunk.delta,
            }));
          }
        });

        unlistenError = await onStreamError((error) => {
          console.error("Stream error:", error);
          set((state) => ({
            isGenerating: false,
            streamingContent: "",
            messages: [
              ...state.messages,
              {
                id: crypto.randomUUID(),
                role: "assistant" as const,
                content: `*Connection error: ${error}*`,
                timestamp: new Date(),
              },
            ],
          }));
        });
      }
    } catch (err) {
      console.error("Failed to initialize:", err);
    }

    // Return cleanup function
    return () => {
      unlistenChunk?.();
      unlistenError?.();
      listenersSetUp = false;
    };
  },

  sendMessage: async (content: string) => {
    const { activeCompanionId, isGenerating, backendConfigured } = get();
    if (!activeCompanionId || isGenerating) return;

    if (!backendConfigured) {
      set({ settingsOpen: true });
      return;
    }

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: new Date(),
    };

    set((state) => ({
      messages: [...state.messages, userMsg],
      isGenerating: true,
      streamingContent: "",
    }));

    try {
      await api.sendMessage(activeCompanionId, content);
    } catch (err) {
      console.error("Failed to send message:", err);
      set((state) => ({
        isGenerating: false,
        messages: [
          ...state.messages,
          {
            id: crypto.randomUUID(),
            role: "assistant" as const,
            content: `*Failed to send: ${err}*`,
            timestamp: new Date(),
          },
        ],
      }));
    }
  },

  switchCompanion: async (id: string) => {
    if (get().activeCompanionId === id) return;

    try {
      const stored = await api.getMessages(id, 100);
      const messages = stored.map(storedToMessage);

      set({
        activeCompanionId: id,
        messages,
        streamingContent: "",
        isGenerating: false,
      });
    } catch (err) {
      console.error("Failed to switch companion:", err);
    }
  },

  loadSettings: async () => {
    try {
      const settings = await api.getSettings();
      set({ settings });
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  },

  saveSettings: async (settings: AppSettings) => {
    try {
      await api.saveSettings(settings);
      const backendConfigured = await api.checkBackendStatus();
      set({ settings, backendConfigured, settingsOpen: false });
    } catch (err) {
      console.error("Failed to save settings:", err);
      throw err;
    }
  },

  setSettingsOpen: (open: boolean) => set({ settingsOpen: open }),
}));

// --- Helpers ---

function storedToMessage(msg: StoredMessage): Message {
  return {
    id: String(msg.id),
    role: msg.role as "user" | "assistant",
    content: msg.content,
    timestamp: new Date(msg.timestamp + "Z"),
    emotion: msg.emotion ?? undefined,
  };
}
