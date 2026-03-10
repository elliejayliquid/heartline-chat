mod db;
mod events;
mod inference;

use db::{AppSettings, CompanionProfile, Conversation, Database, StoredMessage};
use events::{AppEvent, EventBus};
use inference::{ApiBackendConfig, ChatMessage, GenerateRequest, InferenceManager, StreamChunk};
use serde::Serialize;

use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc;

/// Application state shared across all Tauri commands
pub struct AppState {
    pub db: Database,
    pub inference: InferenceManager,
    pub events: EventBus,
}

// ============================================================
// Tauri Commands - These are the IPC bridge between frontend and Rust
// ============================================================

// --- Settings ---

#[tauri::command]
async fn get_settings(state: State<'_, Arc<AppState>>) -> Result<AppSettings, String> {
    state.db.get_settings()
}

#[tauri::command]
async fn save_settings(
    state: State<'_, Arc<AppState>>,
    settings: AppSettings,
) -> Result<(), String> {
    // Save to database
    state.db.save_settings(&settings)?;

    // Reconfigure inference backend with new settings
    // Note: API key can be empty for local servers (Ollama, LM Studio)
    if !settings.api_base_url.is_empty() {
        let config = ApiBackendConfig {
            base_url: settings.api_base_url.clone(),
            api_key: settings.api_key.clone(),
            default_model: settings.default_model.clone(),
        };
        state.inference.configure_api_backend(config).await?;
    }

    state.events.emit(AppEvent::SettingsChanged {
        key: "api".to_string(),
        value: "updated".to_string(),
    });

    Ok(())
}

// --- Companions ---

#[tauri::command]
async fn get_companions(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<CompanionProfile>, String> {
    state.db.get_companions()
}

#[tauri::command]
async fn get_companion(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<Option<CompanionProfile>, String> {
    state.db.get_companion(&id)
}

#[tauri::command]
async fn create_companion(
    state: State<'_, Arc<AppState>>,
    profile: CompanionProfile,
) -> Result<(), String> {
    state.db.create_companion(&profile)
}

#[tauri::command]
async fn update_companion(
    state: State<'_, Arc<AppState>>,
    profile: CompanionProfile,
) -> Result<(), String> {
    state.db.update_companion(&profile)
}

// --- Conversations ---

#[tauri::command]
async fn get_conversations(
    state: State<'_, Arc<AppState>>,
    companion_id: String,
) -> Result<Vec<Conversation>, String> {
    state.db.get_conversations(&companion_id)
}

#[tauri::command]
async fn create_conversation(
    state: State<'_, Arc<AppState>>,
    id: String,
    companion_id: String,
    title: String,
) -> Result<(), String> {
    state.db.create_conversation(&id, &companion_id, &title)
}

#[tauri::command]
async fn rename_conversation(
    state: State<'_, Arc<AppState>>,
    id: String,
    title: String,
) -> Result<(), String> {
    state.db.rename_conversation(&id, &title)
}

#[tauri::command]
async fn delete_conversation(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), String> {
    state.db.delete_conversation(&id)
}

// --- Messages ---

#[tauri::command]
async fn get_messages(
    state: State<'_, Arc<AppState>>,
    conversation_id: String,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<StoredMessage>, String> {
    state
        .db
        .get_messages(&conversation_id, limit.unwrap_or(100), offset.unwrap_or(0))
}

#[tauri::command]
async fn save_message(
    state: State<'_, Arc<AppState>>,
    companion_id: String,
    conversation_id: String,
    role: String,
    content: String,
) -> Result<i64, String> {
    state.db.save_message(&companion_id, &conversation_id, &role, &content)
}

// --- Chat / Inference ---

#[tauri::command]
async fn send_message(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    companion_id: String,
    conversation_id: String,
    user_message: String,
) -> Result<(), String> {
    // 1. Save user message
    state
        .db
        .save_message(&companion_id, &conversation_id, "user", &user_message)?;

    // Touch conversation's updated_at
    state.db.touch_conversation(&conversation_id)?;

    state.events.emit(AppEvent::MessageReceived {
        companion_id: companion_id.clone(),
        content: user_message.clone(),
    });

    // 2. Get companion profile for system prompt
    let companion = state
        .db
        .get_companion(&companion_id)?
        .ok_or_else(|| "Companion not found".to_string())?;

    // 3. Load settings for generation parameters
    let settings = state.db.get_settings()?;

    // 4. Build message history for context (scoped to this conversation)
    let history = state
        .db
        .get_messages(&conversation_id, settings.context_messages_limit, 0)?;

    let mut messages = Vec::new();

    // System prompt
    messages.push(ChatMessage {
        role: "system".to_string(),
        content: companion.personality.clone(),
    });

    // Inject rolling summary (if one exists) as context between system prompt and history
    if let Ok(Some(summary)) = state.db.get_latest_summary(&conversation_id) {
        messages.push(ChatMessage {
            role: "system".to_string(),
            content: format!(
                "[Context: summary of earlier messages in this conversation. \
                Use this to remember what was discussed, but continue speaking \
                naturally in second person — address the user as \"you\", never \
                refer to them in third person.]\n{}",
                summary.summary
            ),
        });
    }

    // Recent history (already includes the user message we just saved)
    for msg in &history {
        messages.push(ChatMessage {
            role: msg.role.clone(),
            content: msg.content.clone(),
        });
    }

    // 5. Token-aware context trimming
    let system_tokens = estimate_tokens(&companion.personality);
    let summary_tokens = messages.get(1)
        .filter(|m| m.content.starts_with("[Earlier in this conversation"))
        .map(|m| estimate_tokens(&m.content))
        .unwrap_or(0);
    let available = settings
        .context_window_size
        .saturating_sub(settings.max_tokens)
        .saturating_sub(system_tokens)
        .saturating_sub(summary_tokens);

    // Walk backward from newest, keeping as many messages as fit
    let mut total: u32 = 0;
    let mut keep_from = messages.len();
    for i in (1..messages.len()).rev() {
        let msg_tokens = estimate_tokens(&messages[i].content);
        if total + msg_tokens > available {
            break;
        }
        total += msg_tokens;
        keep_from = i;
    }

    // Trim: keep system prompt (index 0) + messages that fit
    if keep_from > 1 {
        let system = messages[0].clone();
        messages = std::iter::once(system)
            .chain(messages[keep_from..].iter().cloned())
            .collect();
    }

    // 6. Generate streaming response
    let (tx, mut rx) = mpsc::channel::<StreamChunk>(128);

    let request = GenerateRequest {
        messages,
        model: None, // Use default from backend config
        temperature: Some(settings.temperature),
        max_tokens: Some(settings.max_tokens),
        stream: true,
    };

    // Spawn the generation task
    let state_clone = state.inner().clone();
    let events_handle = app.clone();

    tokio::spawn(async move {
        let result = state_clone.inference.generate(request, tx).await;
        if let Err(e) = result {
            let _ = events_handle.emit("stream-error", e);
        }
    });

    // 5. Forward stream chunks to frontend via Tauri events
    let app_clone = app.clone();
    let state_for_save = state.inner().clone();
    let companion_id_for_save = companion_id.clone();
    let conversation_id_for_save = conversation_id.clone();

    tokio::spawn(async move {
        let mut full_response = String::new();

        while let Some(chunk) = rx.recv().await {
            if !chunk.delta.is_empty() {
                full_response.push_str(&chunk.delta);
            }

            // Emit to frontend
            let _ = app_clone.emit("stream-chunk", &chunk);

            if chunk.done {
                // Save the complete response
                if !full_response.is_empty() {
                    let _ = state_for_save.db.save_message(
                        &companion_id_for_save,
                        &conversation_id_for_save,
                        "assistant",
                        &full_response,
                    );

                    state_for_save.events.emit(AppEvent::MessageGenerated {
                        companion_id: companion_id_for_save,
                        content: full_response,
                    });
                }
                break;
            }
        }
    });

    Ok(())
}

// --- Rolling Summaries (Adaptive) ---

/// Rough token estimate: 1 token ≈ 4 characters
fn estimate_tokens(s: &str) -> u32 {
    (s.len() as u32) / 4
}

/// Compute the available token budget for conversation messages.
/// Reserves space for: system prompt, summary slot, and model response generation.
fn available_context_tokens(settings: &AppSettings) -> u32 {
    // Overhead: system prompt (~200 tok) + summary text (~300 tok) + safety margin
    let overhead: u32 = 600;
    settings
        .context_window_size
        .saturating_sub(settings.max_tokens) // reserve space for the response
        .saturating_sub(overhead)
}

/// Summary budget ratios (derived from context window, no magic numbers).
///
/// Example scenarios (assuming ~100 tokens/message average):
///   4k context  → trigger after ~14 exchanges, keep ~7 raw, summarize ~7 per cycle
///   8k context  → trigger after ~28 exchanges, keep ~14 raw, summarize ~14 per cycle
///   32k context → trigger after ~110 exchanges, keep ~55 raw, summarize ~55 per cycle
///   128k context → trigger after ~470 exchanges, keep ~235 raw, summarize ~235 per cycle
const SUMMARY_TRIGGER_RATIO: u32 = 60;  // % of available: trigger when unsummarized exceeds this
const SUMMARY_KEEP_RATIO: u32 = 30;     // % of available: keep this much recent context raw

/// Result returned to frontend when checking summary status
#[derive(Serialize, Clone)]
struct SummaryStatus {
    needs_summary: bool,
    unsummarized_tokens: u32,
    trigger_threshold: u32,
}

#[tauri::command]
async fn check_summary_needed(
    state: State<'_, Arc<AppState>>,
    conversation_id: String,
) -> Result<SummaryStatus, String> {
    let settings = state.db.get_settings()?;
    let available = available_context_tokens(&settings);

    // Trigger when unsummarized content exceeds SUMMARY_TRIGGER_RATIO% of available context.
    // At that point the trimmer is starting to drop messages, and we risk
    // losing information that hasn't been summarized yet.
    let trigger_threshold = available * SUMMARY_TRIGGER_RATIO / 100;

    // Efficient check: get total character length via SQL, convert to tokens
    let content_length = state.db.get_unsummarized_content_length(&conversation_id)?;
    let unsummarized_tokens = (content_length as u32) / 4;

    Ok(SummaryStatus {
        needs_summary: unsummarized_tokens >= trigger_threshold,
        unsummarized_tokens,
        trigger_threshold,
    })
}

#[tauri::command]
async fn generate_summary(
    state: State<'_, Arc<AppState>>,
    conversation_id: String,
) -> Result<bool, String> {
    let settings = state.db.get_settings()?;
    let available = available_context_tokens(&settings);

    // Keep enough recent messages to fill SUMMARY_KEEP_RATIO% of available context.
    // Everything older gets summarized. The gap between trigger and keep
    // (60% - 30% = 30% of available) is the batch size per summarization cycle.
    let keep_recent_budget = available * SUMMARY_KEEP_RATIO / 100;

    // 1. Get ALL unsummarized messages
    let all_unsummarized = state.db.get_unsummarized_messages(&conversation_id)?;

    if all_unsummarized.is_empty() {
        return Ok(false);
    }

    // 2. Walk backward from newest, find the split point based on token budget
    let mut recent_tokens: u32 = 0;
    let mut split_index = all_unsummarized.len(); // default: nothing to summarize

    for i in (0..all_unsummarized.len()).rev() {
        let msg_tokens = estimate_tokens(&all_unsummarized[i].content);
        if recent_tokens + msg_tokens > keep_recent_budget {
            split_index = i + 1; // keep from here onward as recent
            break;
        }
        recent_tokens += msg_tokens;
        if i == 0 {
            split_index = 0; // all messages fit in the recent budget
        }
    }

    // Messages before split_index get summarized
    let to_summarize = &all_unsummarized[..split_index];

    if to_summarize.is_empty() {
        return Ok(false); // Everything fits in the recent budget, nothing to compress
    }

    // 3. Get the previous summary (if any) to build on
    let previous_summary = state.db.get_latest_summary(&conversation_id)?;

    // 4. Build the summarization prompt
    // The summary is written FROM the companion's perspective, referring to the
    // human as "the user" — but the injection wrapper (above) instructs the
    // companion to translate back to "you" when speaking.
    let mut prompt = String::from(
        "You are summarizing a conversation between an AI companion and a user. \
        Write a concise summary that captures:\n\
        - Key topics discussed\n\
        - Important facts, preferences, or personal details the user shared \
        (name, interests, life situation, etc.)\n\
        - Emotional tone and how the relationship is developing\n\
        - Any plans, promises, or things to follow up on\n\n\
        Refer to the human as \"the user\" and the AI as \"the companion\".\n\n",
    );

    if let Some(ref prev) = previous_summary {
        prompt.push_str("Previous summary to build on:\n");
        prompt.push_str(&prev.summary);
        prompt.push_str("\n\n");
    }

    prompt.push_str("New messages to incorporate:\n\n");

    for msg in to_summarize {
        let role_label = if msg.role == "user" { "User" } else { "Companion" };
        prompt.push_str(&format!("{}: {}\n", role_label, msg.content));
    }

    prompt.push_str(
        "\nWrite an updated summary (2-4 paragraphs) that merges any previous summary \
        with these new messages. Focus on what the companion needs to remember \
        to continue the conversation naturally. Be concise but preserve specific \
        details (names, preferences, facts).",
    );

    // 5. Generate summary via inference (non-streaming)
    let request = GenerateRequest {
        messages: vec![ChatMessage {
            role: "user".to_string(),
            content: prompt,
        }],
        model: None,
        temperature: Some(0.3), // Low temp for factual summarization
        max_tokens: Some(512),
        stream: true, // generate_complete still uses streaming internally
    };

    let summary_text = state.inference.generate_complete(request).await?;

    // 6. Save to database
    let start_id = to_summarize.first().unwrap().id;
    let end_id = to_summarize.last().unwrap().id;
    let count = to_summarize.len() as u32;

    state.db.save_rolling_summary(
        &conversation_id,
        &summary_text,
        start_id,
        end_id,
        count,
    )?;

    Ok(true)
}

#[tauri::command]
async fn check_backend_status(
    state: State<'_, Arc<AppState>>,
) -> Result<bool, String> {
    // If already configured, just confirm
    if state.inference.is_configured().await {
        return Ok(true);
    }

    // Not configured — try to connect from saved settings (auto-reconnect)
    if let Ok(settings) = state.db.get_settings() {
        if !settings.api_base_url.is_empty() {
            let config = ApiBackendConfig {
                base_url: settings.api_base_url,
                api_key: settings.api_key,
                default_model: settings.default_model,
            };
            if state.inference.configure_api_backend(config).await.is_ok() {
                return Ok(true);
            }
        }
    }

    Ok(false)
}

// ============================================================
// App Setup
// ============================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Determine database path
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");
            std::fs::create_dir_all(&app_data_dir)
                .expect("Failed to create app data directory");

            let db_path = app_data_dir.join("heartline.db");

            // Initialize application state
            let db = Database::open(&db_path)
                .expect("Failed to initialize database");
            let inference = InferenceManager::new();
            let events = EventBus::new();

            let state = Arc::new(AppState {
                db,
                inference,
                events,
            });

            // Auto-start Ollama if settings point to it
            if let Ok(settings) = state.db.get_settings() {
                if settings.api_base_url.contains("127.0.0.1:11434")
                    || settings.api_base_url.contains("localhost:11434")
                {
                    // Spawn "ollama serve" in background — harmlessly fails if already running
                    let _ = std::process::Command::new("ollama")
                        .arg("serve")
                        .stdout(std::process::Stdio::null())
                        .stderr(std::process::Stdio::null())
                        .spawn();
                }
            }

            // Try to configure backend from saved settings
            let state_clone = state.clone();
            tauri::async_runtime::spawn(async move {
                if let Ok(settings) = state_clone.db.get_settings() {
                    if !settings.api_base_url.is_empty() {
                        let config = ApiBackendConfig {
                            base_url: settings.api_base_url,
                            api_key: settings.api_key,
                            default_model: settings.default_model,
                        };
                        let _ = state_clone.inference.configure_api_backend(config).await;
                    }
                }
            });

            app.manage(state);

            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            get_companions,
            get_companion,
            create_companion,
            update_companion,
            get_conversations,
            create_conversation,
            rename_conversation,
            delete_conversation,
            get_messages,
            save_message,
            send_message,
            check_summary_needed,
            generate_summary,
            check_backend_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Heartline");
}
