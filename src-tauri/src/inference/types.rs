use serde::{Deserialize, Serialize};

/// A single message in a conversation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,    // "system", "user", "assistant"
    pub content: String,
}

/// Request to generate a completion
#[derive(Debug, Clone)]
pub struct GenerateRequest {
    pub messages: Vec<ChatMessage>,
    pub model: Option<String>,
    pub temperature: Option<f64>,
    pub max_tokens: Option<u32>,
    pub stream: bool,
}

/// A single token/chunk from a streaming response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamChunk {
    pub delta: String,
    pub done: bool,
}

/// Backend capabilities (what this backend supports)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendCapabilities {
    pub name: String,
    pub supports_streaming: bool,
    pub supports_system_prompt: bool,
    pub available_models: Vec<String>,
}

/// Configuration for an API backend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiBackendConfig {
    pub base_url: String,
    pub api_key: String,
    pub default_model: String,
}

/// Request to generate a text embedding
#[derive(Debug, Clone)]
pub struct EmbedRequest {
    pub input: String,
    pub model: Option<String>,
}

/// The trait every inference backend must implement.
/// This is the plugin boundary - community plugins implement this trait.
#[async_trait::async_trait]
pub trait InferenceBackend: Send + Sync {
    /// Generate a streaming response
    async fn generate(
        &self,
        request: GenerateRequest,
        sender: tokio::sync::mpsc::Sender<StreamChunk>,
    ) -> Result<(), String>;

    /// Generate a text embedding vector
    async fn embed(&self, request: EmbedRequest) -> Result<Vec<f32>, String>;

    /// Get this backend's capabilities
    fn capabilities(&self) -> BackendCapabilities;

    /// Test the connection
    async fn health_check(&self) -> Result<(), String>;
}
