import { create } from "zustand";
import {
  api,
  onStreamChunk,
  onStreamError,
  type CompanionProfile,
  type StoredMessage,
  type AppSettings,
} from "@/lib/tauri";

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
  streamingContent: string; // Content being streamed in real-time

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
  initialize: () => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  switchCompanion: (id: string) => Promise<void>;
  loadSettings: () => Promise<void>;
  saveSettings: (settings: AppSettings) => Promise<void>;
  setSettingsOpen: (open: boolean) => void;
}

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
    if (get().initialized) return;

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
        // Auto-open settings if no API key configured
        settingsOpen: !backendConfigured,
      });

      // Set up streaming listener
      onStreamChunk((chunk) => {
        if (chunk.done) {
          // Streaming complete - finalize the assistant message
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

            // Update companion's last message in the list
            updateCompanionPreview(get, set);
          } else {
            set({ isGenerating: false });
          }
        } else {
          // Append streaming token
          set((state) => ({
            streamingContent: state.streamingContent + chunk.delta,
          }));
        }
      });

      onStreamError((error) => {
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
    } catch (err) {
      console.error("Failed to initialize:", err);
    }
  },

  sendMessage: async (content: string) => {
    const { activeCompanionId, isGenerating, backendConfigured } = get();
    if (!activeCompanionId || isGenerating) return;

    if (!backendConfigured) {
      set({ settingsOpen: true });
      return;
    }

    // Add user message to UI immediately
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
      // Send to backend - streaming will come via events
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

function updateCompanionPreview(
  get: () => ChatState,
  set: (partial: Partial<ChatState>) => void
) {
  const { activeCompanionId, companions, messages } = get();
  if (!activeCompanionId) return;

  const lastMsg = messages[messages.length - 1];
  if (!lastMsg) return;

  // We don't modify the CompanionProfile from DB here,
  // but the UI can derive the preview from store state
}
