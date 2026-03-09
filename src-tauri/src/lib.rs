mod db;
mod events;
mod inference;

use db::{AppSettings, CompanionProfile, Conversation, Database, StoredMessage};
use events::{AppEvent, EventBus};
use inference::{ApiBackendConfig, ChatMessage, GenerateRequest, InferenceManager, StreamChunk};

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

    // Recent history (already includes the user message we just saved)
    for msg in &history {
        messages.push(ChatMessage {
            role: msg.role.clone(),
            content: msg.content.clone(),
        });
    }

    // 5. Token-aware context trimming (rough estimate: 1 token ≈ 4 chars)
    let estimate_tokens = |s: &str| -> u32 { (s.len() as u32) / 4 };

    let system_tokens = estimate_tokens(&companion.personality);
    let available = settings
        .context_window_size
        .saturating_sub(settings.max_tokens)
        .saturating_sub(system_tokens);

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
            check_backend_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Heartline");
}
