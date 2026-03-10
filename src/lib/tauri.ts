import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// --- Types matching Rust backend ---

export interface AppSettings {
  api_base_url: string;
  api_key: string;
  default_model: string;
  // Generation parameters
  temperature: number;
  max_tokens: number;
  // Context management
  context_window_size: number;
  context_messages_limit: number;
  // Memory sidecar
  memory_enabled: boolean;
  sidecar_model: string;
  embedding_model: string;
}

export interface CompanionProfile {
  id: string;
  name: string;
  personality: string;
  status: string;
  avatar_url: string | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  companion_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface StoredMessage {
  id: number;
  companion_id: string;
  conversation_id: string;
  role: string;
  content: string;
  timestamp: string;
  emotion: string | null;
}

export interface StreamChunk {
  delta: string;
  done: boolean;
}

export interface SummaryStatus {
  needs_summary: boolean;
  unsummarized_tokens: number;
  trigger_threshold: number;
}

// --- API calls to Rust backend ---

export const api = {
  // Settings
  getSettings: () => invoke<AppSettings>("get_settings"),
  saveSettings: (settings: AppSettings) =>
    invoke<void>("save_settings", { settings }),

  // Companions
  getCompanions: () => invoke<CompanionProfile[]>("get_companions"),
  getCompanion: (id: string) =>
    invoke<CompanionProfile | null>("get_companion", { id }),
  createCompanion: (profile: CompanionProfile) =>
    invoke<void>("create_companion", { profile }),
  updateCompanion: (profile: CompanionProfile) =>
    invoke<void>("update_companion", { profile }),

  // Conversations
  getConversations: (companionId: string) =>
    invoke<Conversation[]>("get_conversations", { companionId }),
  createConversation: (id: string, companionId: string, title: string) =>
    invoke<void>("create_conversation", { id, companionId, title }),
  renameConversation: (id: string, title: string) =>
    invoke<void>("rename_conversation", { id, title }),
  deleteConversation: (id: string) =>
    invoke<void>("delete_conversation", { id }),

  // Messages
  getMessages: (conversationId: string, limit?: number, offset?: number) =>
    invoke<StoredMessage[]>("get_messages", {
      conversationId,
      limit: limit ?? null,
      offset: offset ?? null,
    }),
  saveMessage: (companionId: string, conversationId: string, role: string, content: string) =>
    invoke<number>("save_message", { companionId, conversationId, role, content }),

  // Chat
  sendMessage: (companionId: string, conversationId: string, userMessage: string) =>
    invoke<void>("send_message", { companionId, conversationId, userMessage }),
  checkBackendStatus: () => invoke<boolean>("check_backend_status"),

  // Rolling Summaries
  checkSummaryNeeded: (conversationId: string) =>
    invoke<SummaryStatus>("check_summary_needed", { conversationId }),
  generateSummary: (conversationId: string) =>
    invoke<boolean>("generate_summary", { conversationId }),

  // Memory Extraction
  extractMemories: (conversationId: string, companionId: string) =>
    invoke<number>("extract_memories", { conversationId, companionId }),
};

// --- Event listeners ---

export function onStreamChunk(
  callback: (chunk: StreamChunk) => void
): Promise<UnlistenFn> {
  return listen<StreamChunk>("stream-chunk", (event) => {
    callback(event.payload);
  });
}

export function onModelPullStatus(
  callback: (status: string) => void
): Promise<UnlistenFn> {
  return listen<string>("model-pull-status", (event) => {
    callback(event.payload);
  });
}

export function onStreamError(
  callback: (error: string) => void
): Promise<UnlistenFn> {
  return listen<string>("stream-error", (event) => {
    callback(event.payload);
  });
}
