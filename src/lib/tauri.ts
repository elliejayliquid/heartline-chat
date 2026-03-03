import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// --- Types matching Rust backend ---

export interface AppSettings {
  api_base_url: string;
  api_key: string;
  default_model: string;
}

export interface CompanionProfile {
  id: string;
  name: string;
  personality: string;
  status: string;
  avatar_url: string | null;
  created_at: string;
}

export interface StoredMessage {
  id: number;
  companion_id: string;
  role: string;
  content: string;
  timestamp: string;
  emotion: string | null;
}

export interface StreamChunk {
  delta: string;
  done: boolean;
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

  // Messages
  getMessages: (companionId: string, limit?: number, offset?: number) =>
    invoke<StoredMessage[]>("get_messages", {
      companionId,
      limit: limit ?? null,
      offset: offset ?? null,
    }),
  saveMessage: (companionId: string, role: string, content: string) =>
    invoke<number>("save_message", { companionId, role, content }),

  // Chat
  sendMessage: (companionId: string, userMessage: string) =>
    invoke<void>("send_message", { companionId, userMessage }),
  checkBackendStatus: () => invoke<boolean>("check_backend_status"),
};

// --- Event listeners ---

export function onStreamChunk(
  callback: (chunk: StreamChunk) => void
): Promise<UnlistenFn> {
  return listen<StreamChunk>("stream-chunk", (event) => {
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
