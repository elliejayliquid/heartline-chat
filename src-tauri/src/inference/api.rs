use super::types::*;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

/// OpenAI-compatible API backend.
/// Works with OpenAI, Anthropic (via proxy), Ollama, LM Studio, etc.
pub struct ApiBackend {
    client: Client,
    config: ApiBackendConfig,
}

// --- OpenAI API types ---

#[derive(Serialize)]
struct ApiRequest {
    model: String,
    messages: Vec<ApiMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    stream: bool,
}

#[derive(Serialize)]
struct ApiMessage {
    role: String,
    content: String,
}

// --- Embedding API types ---

#[derive(Serialize)]
struct EmbedApiRequest {
    model: String,
    input: String,
}

#[derive(Deserialize)]
struct EmbedApiResponse {
    data: Vec<EmbedApiData>,
}

#[derive(Deserialize)]
struct EmbedApiData {
    embedding: Vec<f32>,
}

// --- Chat completion API types ---

#[derive(Deserialize)]
struct ApiStreamResponse {
    choices: Vec<ApiStreamChoice>,
}

#[derive(Deserialize)]
struct ApiStreamChoice {
    delta: ApiDelta,
    finish_reason: Option<String>,
}

#[derive(Deserialize)]
struct ApiDelta {
    content: Option<String>,
}

// --- Implementation ---

impl ApiBackend {
    pub fn new(config: ApiBackendConfig) -> Self {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .expect("Failed to create HTTP client");

        Self { client, config }
    }
}

#[async_trait::async_trait]
impl InferenceBackend for ApiBackend {
    async fn generate(
        &self,
        request: GenerateRequest,
        sender: mpsc::Sender<StreamChunk>,
    ) -> Result<(), String> {
        let model = request
            .model
            .unwrap_or_else(|| self.config.default_model.clone());

        let api_messages: Vec<ApiMessage> = request
            .messages
            .iter()
            .map(|m| ApiMessage {
                role: m.role.clone(),
                content: m.content.clone(),
            })
            .collect();

        let api_request = ApiRequest {
            model,
            messages: api_messages,
            temperature: request.temperature,
            max_tokens: request.max_tokens,
            stream: true,
        };

        let url = format!("{}/chat/completions", self.config.base_url.trim_end_matches('/'));

        let mut response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.config.api_key))
            .header("Content-Type", "application/json")
            .json(&api_request)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Failed to read error body".to_string());
            return Err(format!("API error {}: {}", status, body));
        }

        // Parse SSE stream
        let mut buffer = String::new();

        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| format!("Stream error: {}", e))?
        {
            let text = String::from_utf8_lossy(&chunk);
            buffer.push_str(&text);

            // Process complete SSE lines
            while let Some(pos) = buffer.find('\n') {
                let line = buffer[..pos].trim().to_string();
                buffer = buffer[pos + 1..].to_string();

                if line.is_empty() || line.starts_with(':') {
                    continue;
                }

                if let Some(data) = line.strip_prefix("data: ") {
                    if data.trim() == "[DONE]" {
                        let _ = sender
                            .send(StreamChunk {
                                delta: String::new(),
                                done: true,
                            })
                            .await;
                        return Ok(());
                    }

                    if let Ok(parsed) = serde_json::from_str::<ApiStreamResponse>(data) {
                        if let Some(choice) = parsed.choices.first() {
                            if let Some(content) = &choice.delta.content {
                                if !content.is_empty() {
                                    let _ = sender
                                        .send(StreamChunk {
                                            delta: content.clone(),
                                            done: false,
                                        })
                                        .await;
                                }
                            }

                            if choice.finish_reason.is_some() {
                                let _ = sender
                                    .send(StreamChunk {
                                        delta: String::new(),
                                        done: true,
                                    })
                                    .await;
                                return Ok(());
                            }
                        }
                    }
                }
            }
        }

        // Stream ended without [DONE]
        let _ = sender
            .send(StreamChunk {
                delta: String::new(),
                done: true,
            })
            .await;

        Ok(())
    }

    async fn embed(&self, request: EmbedRequest) -> Result<Vec<f32>, String> {
        let model = request
            .model
            .unwrap_or_else(|| "all-minilm".to_string());

        let api_request = EmbedApiRequest {
            model,
            input: request.input,
        };

        let url = format!("{}/embeddings", self.config.base_url.trim_end_matches('/'));

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.config.api_key))
            .header("Content-Type", "application/json")
            .json(&api_request)
            .send()
            .await
            .map_err(|e| format!("Embedding request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Failed to read error body".to_string());
            return Err(format!("Embedding API error {}: {}", status, body));
        }

        let parsed: EmbedApiResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse embedding response: {}", e))?;

        parsed
            .data
            .into_iter()
            .next()
            .map(|d| d.embedding)
            .ok_or_else(|| "Embedding response contained no data".to_string())
    }

    fn capabilities(&self) -> BackendCapabilities {
        BackendCapabilities {
            name: format!("OpenAI-compatible ({})", self.config.base_url),
            supports_streaming: true,
            supports_system_prompt: true,
            available_models: vec![self.config.default_model.clone()],
        }
    }

    async fn health_check(&self) -> Result<(), String> {
        let url = format!("{}/models", self.config.base_url.trim_end_matches('/'));

        self.client
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.config.api_key))
            .send()
            .await
            .map_err(|e| format!("Health check failed: {}", e))?;

        Ok(())
    }
}
