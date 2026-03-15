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
  // Speech-to-Text
  stt_model: string;
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

export interface Memory {
  id: number;
  companion_id: string;
  memory_type: string;
  content: string;
  source: string;
  confidence: string;
  importance: number;
  tags: string;
  source_message_id: number | null;
  supersedes: number | null;
  created_at: string;
  last_confirmed: string | null;
  retrieval_count: number;
  last_accessed: string | null;
}

export interface JournalEntry {
  id: number;
  companion_id: string;
  entry_type: string;  // event, user_preference, topic, tone, open_thread, follow_up_candidate
  mode: string;        // shared_mindspace, practical, reflective, flirtatious, narrative, support
  content: string;
  why_it_mattered: string;
  emotional_tone: string | null;
  confidence: string;
  stability: string;
  tags: string;        // JSON array
  source_excerpt: string | null;
  resolved_at: string | null;
  created_at: string;
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
  deleteMessage: (id: number) =>
    invoke<void>("delete_message", { id }),
  deleteMessagesAfter: (conversationId: string, afterMessageId: number) =>
    invoke<number>("delete_messages_after", { conversationId, afterMessageId }),
  updateMessageContent: (id: number, content: string) =>
    invoke<void>("update_message_content", { id, content }),

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

  // Memory Management
  getCompanionMemories: (companionId: string) =>
    invoke<Memory[]>("get_companion_memories", { companionId }),
  deleteMemory: (id: number) =>
    invoke<void>("delete_memory", { id }),
  addManualMemory: (companionId: string, content: string, memoryType: string, tags?: string, createdAt?: string) =>
    invoke<number>("add_manual_memory", { companionId, content, memoryType, tags: tags ?? null, createdAt: createdAt ?? null }),
  updateMemory: (id: number, content: string, memoryType: string, tags?: string) =>
    invoke<void>("update_memory", { id, content, memoryType, tags: tags ?? null }),

  // Journal
  extractJournal: (conversationId: string, companionId: string) =>
    invoke<number>("extract_journal", { conversationId, companionId }),
  getJournalEntries: (companionId: string) =>
    invoke<JournalEntry[]>("get_journal_entries", { companionId }),
  deleteJournalEntry: (id: number) =>
    invoke<void>("delete_journal_entry", { id }),
  resolveJournalEntry: (id: number) =>
    invoke<void>("resolve_journal_entry", { id }),

  // Identity
  synthesizeIdentity: (companionId: string) =>
    invoke<boolean>("synthesize_identity", { companionId }),
  getIdentitySummary: (companionId: string) =>
    invoke<string | null>("get_identity_summary", { companionId }),

  // Whisper STT
  initWhisper: () => invoke<boolean>("init_whisper"),
  transcribeAudio: (audioData: number[]) =>
    invoke<string>("transcribe_audio", { audioData }),
};

// --- Event listeners ---

export type { UnlistenFn };

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
