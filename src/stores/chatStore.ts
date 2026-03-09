import { create } from "zustand";
import {
  api,
  onStreamChunk,
  onStreamError,
  type CompanionProfile,
  type Conversation,
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

  // Conversations
  conversations: Conversation[];
  activeConversationId: string | null;

  // Settings
  settings: AppSettings | null;
  backendConfigured: boolean;
  settingsOpen: boolean;

  // Companion editor
  companionEditorOpen: boolean;
  editingCompanion: CompanionProfile | null;

  // Initialization
  initialized: boolean;

  // Actions
  initialize: () => Promise<() => void>;
  sendMessage: (content: string) => Promise<void>;
  switchCompanion: (id: string) => Promise<void>;
  switchConversation: (id: string) => Promise<void>;
  createConversation: (companionId?: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  loadSettings: () => Promise<void>;
  saveSettings: (settings: AppSettings) => Promise<void>;
  setSettingsOpen: (open: boolean) => void;

  // Companion CRUD
  openCompanionEditor: (companion?: CompanionProfile) => void;
  closeCompanionEditor: () => void;
  createCompanion: (profile: CompanionProfile) => Promise<void>;
  updateCompanion: (profile: CompanionProfile) => Promise<void>;
}

// Guard against React StrictMode double-mounting
let listenersSetUp = false;
let unlistenChunk: UnlistenFn | null = null;
let unlistenError: UnlistenFn | null = null;
let reconnectInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Ensure a companion has at least one conversation.
 * If none exist, creates a default "New Chat" conversation.
 * Returns the conversations list and the active conversation id.
 */
async function ensureConversation(
  companionId: string
): Promise<{ conversations: Conversation[]; activeConversationId: string }> {
  let conversations = await api.getConversations(companionId);

  if (conversations.length === 0) {
    const newId = crypto.randomUUID();
    await api.createConversation(newId, companionId, "New Chat");
    conversations = await api.getConversations(companionId);
  }

  // Most recently updated conversation first (backend sorts by updated_at DESC)
  return {
    conversations,
    activeConversationId: conversations[0].id,
  };
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isGenerating: false,
  streamingContent: "",
  companions: [],
  activeCompanionId: null,
  conversations: [],
  activeConversationId: null,
  settings: null,
  backendConfigured: false,
  settingsOpen: false,
  companionEditorOpen: false,
  editingCompanion: null,
  initialized: false,

  initialize: async () => {
    if (get().initialized) return () => {};

    try {
      // Load companions from database
      const companions = await api.getCompanions();
      const activeCompanionId =
        companions.length > 0 ? companions[0].id : null;

      // Load conversations + messages for the active companion
      let conversations: Conversation[] = [];
      let activeConversationId: string | null = null;
      let messages: Message[] = [];

      if (activeCompanionId) {
        const result = await ensureConversation(activeCompanionId);
        conversations = result.conversations;
        activeConversationId = result.activeConversationId;

        const stored = await api.getMessages(activeConversationId, 100);
        messages = stored.map(storedToMessage);
      }

      // Check if backend is configured
      const backendConfigured = await api.checkBackendStatus();

      // Load settings
      const settings = await api.getSettings();

      set({
        companions,
        activeCompanionId,
        conversations,
        activeConversationId,
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
          // Mark as disconnected so auto-reconnect kicks in
          set((state) => ({
            isGenerating: false,
            streamingContent: "",
            backendConfigured: false,
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

      // Auto-reconnect: poll every 5s when backend isn't connected
      if (reconnectInterval) clearInterval(reconnectInterval);
      reconnectInterval = setInterval(async () => {
        const { backendConfigured } = get();
        if (backendConfigured) return; // Already connected, skip

        try {
          const connected = await api.checkBackendStatus();
          if (connected) {
            set({ backendConfigured: true });
          }
        } catch {
          // Silently ignore — will retry next interval
        }
      }, 5000);
    } catch (err) {
      console.error("Failed to initialize:", err);
    }

    // Return cleanup function
    return () => {
      unlistenChunk?.();
      unlistenError?.();
      listenersSetUp = false;
      if (reconnectInterval) {
        clearInterval(reconnectInterval);
        reconnectInterval = null;
      }
    };
  },

  sendMessage: async (content: string) => {
    const {
      activeCompanionId,
      activeConversationId,
      isGenerating,
      backendConfigured,
    } = get();
    if (!activeCompanionId || !activeConversationId || isGenerating) return;

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
      await api.sendMessage(activeCompanionId, activeConversationId, content);

      // Auto-title: if the conversation title is "New Chat" and this is the first user message,
      // rename it to a snippet of the first message
      const { conversations } = get();
      const conv = conversations.find((c) => c.id === activeConversationId);
      if (conv && conv.title === "New Chat") {
        const title =
          content.length > 40 ? content.slice(0, 40) + "..." : content;
        try {
          await api.renameConversation(activeConversationId, title);
          // Refresh conversation list to pick up the new title
          const updated = await api.getConversations(activeCompanionId);
          set({ conversations: updated });
        } catch {
          // Non-critical, ignore
        }
      }
    } catch (err) {
      console.error("Failed to send message:", err);
      // Mark as disconnected so auto-reconnect kicks in
      set((state) => ({
        isGenerating: false,
        backendConfigured: false,
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
      const { conversations, activeConversationId } =
        await ensureConversation(id);

      const stored = await api.getMessages(activeConversationId, 100);
      const messages = stored.map(storedToMessage);

      set({
        activeCompanionId: id,
        conversations,
        activeConversationId,
        messages,
        streamingContent: "",
        isGenerating: false,
      });
    } catch (err) {
      console.error("Failed to switch companion:", err);
    }
  },

  switchConversation: async (id: string) => {
    if (get().activeConversationId === id) return;

    try {
      const stored = await api.getMessages(id, 100);
      const messages = stored.map(storedToMessage);

      set({
        activeConversationId: id,
        messages,
        streamingContent: "",
        isGenerating: false,
      });
    } catch (err) {
      console.error("Failed to switch conversation:", err);
    }
  },

  createConversation: async (companionId?: string) => {
    const cid = companionId ?? get().activeCompanionId;
    if (!cid) return;

    try {
      const newId = crypto.randomUUID();
      await api.createConversation(newId, cid, "New Chat");

      const conversations = await api.getConversations(cid);

      set({
        activeCompanionId: cid,
        conversations,
        activeConversationId: newId,
        messages: [], // New conversation has no messages
        streamingContent: "",
        isGenerating: false,
      });
    } catch (err) {
      console.error("Failed to create conversation:", err);
    }
  },

  deleteConversation: async (id: string) => {
    const { activeCompanionId, activeConversationId } = get();
    if (!activeCompanionId) return;

    try {
      await api.deleteConversation(id);

      // Re-fetch conversations
      const result = await ensureConversation(activeCompanionId);

      // If we deleted the active conversation, switch to the latest one
      let newActiveId = activeConversationId;
      let messages = get().messages;

      if (id === activeConversationId) {
        newActiveId = result.activeConversationId;
        const stored = await api.getMessages(newActiveId, 100);
        messages = stored.map(storedToMessage);
      }

      set({
        conversations: result.conversations,
        activeConversationId: newActiveId,
        messages,
        streamingContent: "",
        isGenerating: false,
      });
    } catch (err) {
      console.error("Failed to delete conversation:", err);
    }
  },

  renameConversation: async (id: string, title: string) => {
    const { activeCompanionId } = get();
    if (!activeCompanionId) return;

    try {
      await api.renameConversation(id, title);
      const conversations = await api.getConversations(activeCompanionId);
      set({ conversations });
    } catch (err) {
      console.error("Failed to rename conversation:", err);
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

  // --- Companion CRUD ---

  openCompanionEditor: (companion?: CompanionProfile) => {
    set({
      companionEditorOpen: true,
      editingCompanion: companion ?? null,
    });
  },

  closeCompanionEditor: () => {
    set({ companionEditorOpen: false, editingCompanion: null });
  },

  createCompanion: async (profile: CompanionProfile) => {
    try {
      await api.createCompanion(profile);
      const companions = await api.getCompanions();

      // Create a default conversation for the new companion
      const newConvId = crypto.randomUUID();
      await api.createConversation(newConvId, profile.id, "New Chat");
      const conversations = await api.getConversations(profile.id);

      set({
        companions,
        companionEditorOpen: false,
        editingCompanion: null,
        activeCompanionId: profile.id,
        conversations,
        activeConversationId: newConvId,
        messages: [],
        streamingContent: "",
        isGenerating: false,
      });
    } catch (err) {
      console.error("Failed to create companion:", err);
      throw err;
    }
  },

  updateCompanion: async (profile: CompanionProfile) => {
    try {
      await api.updateCompanion(profile);
      const companions = await api.getCompanions();
      set({
        companions,
        companionEditorOpen: false,
        editingCompanion: null,
      });
    } catch (err) {
      console.error("Failed to update companion:", err);
      throw err;
    }
  },
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
