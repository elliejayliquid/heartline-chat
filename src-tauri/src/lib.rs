mod db;
mod events;
mod inference;

use db::{AppSettings, CompanionProfile, Conversation, Database, StoredMessage};
use events::{AppEvent, EventBus};
use inference::{ApiBackendConfig, ChatMessage, GenerateRequest, InferenceManager, StreamChunk};
use serde::{Deserialize, Serialize};

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
// Helpers — Ollama model auto-pull
// ============================================================

/// Check if the API URL points to a local Ollama instance
fn is_ollama_url(url: &str) -> bool {
    url.contains("localhost:11434") || url.contains("127.0.0.1:11434")
}

/// Pull a model from Ollama using its native /api/pull endpoint.
/// Streams progress so we don't hit request timeouts on large models.
async fn pull_ollama_model(base_url: &str, model_name: &str) -> Result<(), String> {
    eprintln!("[Pull] Pulling model '{}' from {}...", model_name, base_url);

    let base = base_url.trim_end_matches('/');
    let ollama_base = base.strip_suffix("/v1").unwrap_or(base);
    let url = format!("{}/api/pull", ollama_base);

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        // No overall timeout — model pulls can take minutes for large models
        .build()
        .map_err(|e| format!("Client error: {}", e))?;

    let mut response = client
        .post(&url)
        .json(&serde_json::json!({"name": model_name, "stream": true}))
        .send()
        .await
        .map_err(|e| format!("Pull request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Pull failed (HTTP {}): {}", status, body));
    }

    // Consume streaming progress and check for errors in the response.
    // Ollama streams JSON lines like: {"status":"pulling ...","digest":"...","total":123,"completed":45}
    // The final line on success contains: {"status":"success"}
    // On error, a line may contain: {"error":"..."}
    let mut last_line = String::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Pull stream error: {}", e))?
    {
        if let Ok(text) = std::str::from_utf8(&chunk) {
            // Each chunk may contain multiple JSON lines
            for line in text.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                // Check for error in any line
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) {
                    if let Some(error) = parsed.get("error").and_then(|v| v.as_str()) {
                        eprintln!("[Pull] ✗ Model '{}' error from Ollama: {}", model_name, error);
                        return Err(format!("Ollama pull error: {}", error));
                    }
                }

                last_line = trimmed.to_string();
            }
        }
    }

    // Verify the final status was "success"
    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&last_line) {
        if parsed.get("status").and_then(|v| v.as_str()) == Some("success") {
            eprintln!("[Pull] ✓ Model '{}' ready", model_name);
            return Ok(());
        }
    }

    // If we got here, the stream ended without a clear success
    eprintln!("[Pull] ⚠ Model '{}' pull finished but last status unclear: {}", model_name, last_line);
    Ok(()) // Benefit of the doubt — Ollama may just not report "success" on cached pulls
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
    app: AppHandle,
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

    // Auto-pull memory models when enabled with Ollama
    if settings.memory_enabled && is_ollama_url(&settings.api_base_url) {
        let base_url = settings.api_base_url.clone();
        let sidecar_model = settings.sidecar_model.clone();
        let embedding_model = settings.embedding_model.clone();
        let app_handle = app.clone();

        tokio::spawn(async move {
            // Pull embedding model first (smaller, ~90MB)
            let _ = app_handle.emit(
                "model-pull-status",
                format!("Pulling {}...", embedding_model),
            );
            match pull_ollama_model(&base_url, &embedding_model).await {
                Ok(_) => {
                    let _ = app_handle.emit(
                        "model-pull-status",
                        format!("✓ {} ready", embedding_model),
                    );
                }
                Err(e) => {
                    let _ = app_handle.emit(
                        "model-pull-status",
                        format!("✗ {}: {}", embedding_model, e),
                    );
                }
            }

            // Pull sidecar model (~2GB)
            let _ = app_handle.emit(
                "model-pull-status",
                format!("Pulling {}...", sidecar_model),
            );
            match pull_ollama_model(&base_url, &sidecar_model).await {
                Ok(_) => {
                    let _ = app_handle.emit(
                        "model-pull-status",
                        format!("✓ {} ready", sidecar_model),
                    );
                }
                Err(e) => {
                    let _ = app_handle.emit(
                        "model-pull-status",
                        format!("✗ {}: {}", sidecar_model, e),
                    );
                }
            }

            let _ = app_handle.emit("model-pull-status", "Memory models ready");
        });
    }

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

    // Inject relevant memories (if enabled and we have an embedding model)
    let mut memory_tokens: u32 = 0;
    if settings.memory_enabled {
        if let Ok(query_embedding) = state
            .inference
            .embed_text(&user_message, Some(settings.embedding_model.clone()))
            .await
        {
            if let Ok(memories) = state
                .db
                .search_memories_by_embedding(&companion_id, &query_embedding, 5)
            {
                if !memories.is_empty() {
                    // Touch retrieved memories (update retrieval_count)
                    let ids: Vec<i64> = memories.iter().map(|m| m.id).collect();
                    let _ = state.db.touch_memories(&ids);

                    let mut memory_block = String::from(
                        "[Memories about the user — reference these naturally when relevant, \
                        don't force them into conversation]\n",
                    );
                    for mem in &memories {
                        memory_block.push_str(&format!(
                            "- {} ({} confidence, {})\n",
                            mem.content, mem.confidence, mem.memory_type
                        ));
                    }

                    memory_tokens = estimate_tokens(&memory_block);
                    messages.push(ChatMessage {
                        role: "system".to_string(),
                        content: memory_block,
                    });
                }
            }
        }
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
        .filter(|m| m.content.starts_with("[Context: summary of earlier messages"))
        .map(|m| estimate_tokens(&m.content))
        .unwrap_or(0);
    let available = settings
        .context_window_size
        .saturating_sub(settings.max_tokens)
        .saturating_sub(system_tokens)
        .saturating_sub(summary_tokens)
        .saturating_sub(memory_tokens);

    // How many preamble messages to always keep (system prompt + optional summary + optional memories)
    let preamble_count: usize = 1
        + if summary_tokens > 0 { 1 } else { 0 }
        + if memory_tokens > 0 { 1 } else { 0 };

    // Walk backward from newest history messages, keeping as many as fit
    let mut total: u32 = 0;
    let mut keep_from = messages.len();
    for i in (preamble_count..messages.len()).rev() {
        let msg_tokens = estimate_tokens(&messages[i].content);
        if total + msg_tokens > available {
            break;
        }
        total += msg_tokens;
        keep_from = i;
    }

    // Trim: keep all preamble messages + history messages that fit
    if keep_from > preamble_count {
        let preamble: Vec<ChatMessage> = messages[..preamble_count].to_vec();
        messages = preamble
            .into_iter()
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

// --- Memory Extraction Sidecar ---

#[tauri::command]
async fn extract_memories(
    state: State<'_, Arc<AppState>>,
    conversation_id: String,
    companion_id: String,
) -> Result<u32, String> {
    eprintln!("[Memory] extract_memories called: conversation={}, companion={}", conversation_id, companion_id);

    let settings = state.db.get_settings()?;

    // Bail if memory extraction is disabled
    if !settings.memory_enabled {
        eprintln!("[Memory] Skipping — memory_enabled is false");
        return Ok(0);
    }

    eprintln!("[Memory] Using sidecar_model={}, embedding_model={}", settings.sidecar_model, settings.embedding_model);

    // Get last 12 messages for context; need at least 2 (a user+assistant pair)
    let all_messages = state.db.get_last_messages(&conversation_id, 12)?;
    if all_messages.len() < 2 {
        eprintln!("[Memory] Skipping — only {} messages (need 2)", all_messages.len());
        return Ok(0);
    }

    // Split into context window (older turns) and newest exchange (last 2)
    let newest_exchange = &all_messages[all_messages.len().saturating_sub(2)..];
    let context_window = &all_messages[..all_messages.len().saturating_sub(2)];

    // Build context window block
    let mut context_block = String::new();
    for msg in context_window {
        let role_label = if msg.role == "user" { "User" } else { "Companion" };
        context_block.push_str(&format!("{}: {}\n", role_label, msg.content));
    }

    // Build newest exchange block
    let mut exchange_block = String::new();
    for msg in newest_exchange {
        let role_label = if msg.role == "user" { "User" } else { "Companion" };
        exchange_block.push_str(&format!("{}: {}\n", role_label, msg.content));
    }

    // Fetch session summary if available
    let summary_block = match state.db.get_latest_summary(&conversation_id)? {
        Some(s) => format!("\nSession summary so far:\n{}\n", s.summary),
        None => String::new(),
    };

    // Fetch existing memories as update candidates (top 10 most recent)
    let existing_memories_block = {
        let mems = state.db.get_companion_memories(&companion_id).unwrap_or_default();
        if mems.is_empty() {
            String::new()
        } else {
            let mut block = String::from("\nExisting memories (prefer updating over creating duplicates):\n");
            for m in mems.iter().take(10) {
                block.push_str(&format!("- [{}] {}\n", m.memory_type, m.content));
            }
            block
        }
    };

    let prompt = format!(
        r#"You are a memory extraction agent. Your job is to decide what, if anything, from the newest exchange is worth remembering long-term about the user.

You have access to recent conversation context, a session summary, and existing memories.

EXTRACT only:
- Durable facts the user shared about themselves (name, job, hobbies, relationships, life events)
- Stable preferences or opinions that would be useful in future conversations
- Meaningful relationship moments (emotional breakthroughs, commitments, recurring themes)

DO NOT EXTRACT:
- Jokes, casual banter, or one-off comments unless clearly reinforced
- Greetings, small talk, or mood that is obviously momentary
- Generic observations or paraphrasing without added meaning
- Anything about how the companion behaves or speaks
- Characterizations or descriptions the companion made about the user — only extract what the USER explicitly stated about themselves
- Inferred emotional states or vibes; only save if the user directly stated it as a persistent trait (e.g. "I'm always anxious", "I love mornings")

CRITICAL: If a memory you are about to write is already captured in the existing memories list — same fact, same person, even if worded differently — output {{"memories": [], "nothing_notable": true}} instead of duplicating it.
CRITICAL: Extract ONLY from the [NEWEST EXCHANGE] section. The recent context is provided so you understand the conversation — do NOT extract memories from it, only use it as background.
PREFER updating an existing memory over creating a new one.
When in doubt, output nothing. Most exchanges have nothing worth saving.
{summary_block}{existing_memories_block}
Recent context (background only — do NOT extract from this):
{context_block}
[NEWEST EXCHANGE — extract only from here]
{exchange_block}
Output ONLY raw JSON. Pick ONE memory_type per memory.
If nothing notable: {{"memories": [], "nothing_notable": true}}
Example: {{"memories": [{{"content": "User's name is Alex", "memory_type": "personal_fact", "source": "stated", "confidence": "high", "importance": 7, "tags": ["name"]}}], "nothing_notable": false}}"#
    );

    let request = GenerateRequest {
        messages: vec![ChatMessage {
            role: "user".to_string(),
            content: prompt,
        }],
        model: Some(settings.sidecar_model.clone()),
        temperature: Some(0.1), // Very low temp for structured extraction
        max_tokens: Some(512),
        stream: true,
    };

    eprintln!("[Memory] Sending extraction request to {}...", settings.sidecar_model);
    let response = match state.inference.generate_complete(request).await {
        Ok(r) => {
            eprintln!("[Memory] Raw sidecar response ({} chars): {}", r.len(), &r[..r.len().min(500)]);
            r
        }
        Err(e) => {
            eprintln!("[Memory] ✗ Sidecar generation failed: {}", e);
            return Err(e);
        }
    };

    // Parse the JSON response — be lenient with formatting
    let mut json_str = response.trim();

    // Strip <think>...</think> blocks (reasoning models like SmolLM3)
    if let Some(think_end) = json_str.find("</think>") {
        json_str = json_str[think_end + 8..].trim();
        eprintln!("[Memory] Stripped <think> block from response");
    }

    // Try to extract JSON if wrapped in markdown code blocks
    let json_str = json_str
        .strip_prefix("```json")
        .or_else(|| json_str.strip_prefix("```"))
        .unwrap_or(json_str);
    let json_str = json_str.strip_suffix("```").unwrap_or(json_str).trim();

    // Handle trailing garbage (e.g. model outputs `{...}{"nothing_notable": false}`)
    // Find the end of the first complete JSON object by counting braces
    let json_str = {
        let mut depth = 0i32;
        let mut end_pos = json_str.len();
        for (i, ch) in json_str.char_indices() {
            match ch {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        end_pos = i + 1;
                        break;
                    }
                }
                _ => {}
            }
        }
        &json_str[..end_pos]
    };

    #[derive(Deserialize)]
    struct ExtractedMemory {
        content: String,
        memory_type: Option<String>,
        source: Option<String>,
        confidence: Option<String>,
        importance: Option<u32>,
        tags: Option<Vec<String>>,
    }

    #[derive(Deserialize)]
    struct ExtractionResult {
        memories: Vec<ExtractedMemory>,
        #[serde(default)]
        nothing_notable: bool,
    }

    let parsed: ExtractionResult = match serde_json::from_str(json_str) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[Memory] ✗ JSON parse failed: {} — cleaned input: {}", e, json_str);
            return Err(format!("Failed to parse extraction response: {} — raw: {}", e, json_str));
        }
    };

    if parsed.nothing_notable || parsed.memories.is_empty() {
        eprintln!("[Memory] Nothing notable in this exchange.");
        return Ok(0);
    }

    eprintln!("[Memory] Found {} memories to save", parsed.memories.len());

    // Embed and save each memory
    let mut count: u32 = 0;
    for mem in &parsed.memories {
        // Generate embedding for this memory
        let embedding = state
            .inference
            .embed_text(&mem.content, Some(settings.embedding_model.clone()))
            .await
            .ok(); // Non-fatal if embedding fails

        // Semantic dedup: if a very similar memory already exists, reinforce it instead of inserting
        if let Some(ref emb) = embedding {
            match state.db.find_similar_memory(&companion_id, emb, 0.85) {
                Ok(Some(existing)) => {
                    eprintln!(
                        "[Memory] Near-duplicate detected (≥0.85), reinforcing existing #{}: \"{}\"",
                        existing.id, existing.content
                    );
                    let _ = state.db.reinforce_memory(existing.id);
                    continue;
                }
                Ok(None) => {}
                Err(e) => eprintln!("[Memory] Similarity check failed (non-fatal): {}", e),
            }
        }

        let tags_json = serde_json::to_string(
            &mem.tags.clone().unwrap_or_default()
        ).unwrap_or_else(|_| "[]".to_string());

        state.db.save_memory(
            &companion_id,
            Some(&conversation_id),
            &mem.content,
            mem.memory_type.as_deref().unwrap_or("personal_fact"),
            mem.source.as_deref().unwrap_or("observed"),
            mem.confidence.as_deref().unwrap_or("medium"),
            mem.importance.unwrap_or(5),
            &tags_json,
            embedding.as_deref(),
        )?;

        count += 1;
    }

    eprintln!("[Memory] ✓ Saved {} memories for companion={}", count, companion_id);
    Ok(count)
}

#[tauri::command]
async fn get_companion_memories(
    state: State<'_, Arc<AppState>>,
    companion_id: String,
) -> Result<Vec<db::Memory>, String> {
    state.db.get_companion_memories(&companion_id)
}

#[tauri::command]
async fn delete_memory(
    state: State<'_, Arc<AppState>>,
    id: i64,
) -> Result<(), String> {
    state.db.delete_memory(id)
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
                if is_ollama_url(&settings.api_base_url) {
                    // Spawn "ollama serve" in background — harmlessly fails if already running
                    let _ = std::process::Command::new("ollama")
                        .arg("serve")
                        .stdout(std::process::Stdio::null())
                        .stderr(std::process::Stdio::null())
                        .spawn();
                }
            }

            // Try to configure backend from saved settings + auto-pull memory models
            let state_clone = state.clone();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Ok(settings) = state_clone.db.get_settings() {
                    if !settings.api_base_url.is_empty() {
                        let config = ApiBackendConfig {
                            base_url: settings.api_base_url.clone(),
                            api_key: settings.api_key.clone(),
                            default_model: settings.default_model.clone(),
                        };
                        let _ = state_clone.inference.configure_api_backend(config).await;
                    }

                    // Auto-pull memory models on startup if enabled + Ollama
                    if settings.memory_enabled && is_ollama_url(&settings.api_base_url) {
                        // Small delay — let Ollama finish starting up
                        tokio::time::sleep(std::time::Duration::from_secs(3)).await;

                        let _ = app_handle.emit(
                            "model-pull-status",
                            "Ensuring memory models are available...",
                        );

                        let mut pull_ok = true;

                        if let Err(e) = pull_ollama_model(
                            &settings.api_base_url, &settings.embedding_model
                        ).await {
                            eprintln!("[Memory] ✗ Embedding model pull failed: {}", e);
                            let _ = app_handle.emit(
                                "model-pull-status",
                                format!("✗ Embedding model ({}): {}", settings.embedding_model, e),
                            );
                            pull_ok = false;
                        }

                        if let Err(e) = pull_ollama_model(
                            &settings.api_base_url, &settings.sidecar_model
                        ).await {
                            eprintln!("[Memory] ✗ Sidecar model pull failed: {}", e);
                            let _ = app_handle.emit(
                                "model-pull-status",
                                format!("✗ Sidecar model ({}): {}", settings.sidecar_model, e),
                            );
                            pull_ok = false;
                        }

                        if pull_ok {
                            let _ = app_handle.emit("model-pull-status", "Memory models ready");
                        } else {
                            let _ = app_handle.emit(
                                "model-pull-status",
                                "⚠ Some memory models failed to pull — check Ollama",
                            );
                        }
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
            extract_memories,
            get_companion_memories,
            delete_memory,
            check_backend_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Heartline");
}
