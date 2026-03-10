use super::api::ApiBackend;
use super::types::*;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};

/// Manages the active inference backend.
/// Supports hot-swapping backends at runtime (e.g., switching from API to local).
pub struct InferenceManager {
    backend: Arc<RwLock<Option<Arc<dyn InferenceBackend>>>>,
}

impl InferenceManager {
    pub fn new() -> Self {
        Self {
            backend: Arc::new(RwLock::new(None)),
        }
    }

    /// Set up an OpenAI-compatible API backend
    pub async fn configure_api_backend(&self, config: ApiBackendConfig) -> Result<(), String> {
        let backend = ApiBackend::new(config);
        backend.health_check().await.ok(); // Non-fatal: some servers don't have /models
        let mut lock = self.backend.write().await;
        *lock = Some(Arc::new(backend));
        Ok(())
    }

    /// Generate a streaming response using the active backend
    pub async fn generate(
        &self,
        request: GenerateRequest,
        sender: mpsc::Sender<StreamChunk>,
    ) -> Result<(), String> {
        let lock = self.backend.read().await;
        let backend = lock
            .as_ref()
            .ok_or_else(|| "No inference backend configured. Please set up an API key in Settings.".to_string())?;

        backend.generate(request, sender).await
    }

    /// Generate a non-streaming (complete) response.
    /// Internally uses the streaming API but collects all chunks.
    /// Useful for background tasks like rolling summaries.
    pub async fn generate_complete(
        &self,
        request: GenerateRequest,
    ) -> Result<String, String> {
        let (tx, mut rx) = mpsc::channel::<StreamChunk>(128);

        // Spawn the generation in a separate task
        let lock = self.backend.read().await;
        let backend = lock
            .as_ref()
            .ok_or_else(|| "No inference backend configured.".to_string())?
            .clone();
        drop(lock); // Release lock before spawning

        tokio::spawn(async move {
            let _ = backend.generate(request, tx).await;
        });

        // Collect all chunks
        let mut full_text = String::new();
        while let Some(chunk) = rx.recv().await {
            if !chunk.delta.is_empty() {
                full_text.push_str(&chunk.delta);
            }
            if chunk.done {
                break;
            }
        }

        if full_text.is_empty() {
            return Err("Summary generation returned empty response".to_string());
        }

        Ok(full_text)
    }

    /// Check if a backend is configured
    pub async fn is_configured(&self) -> bool {
        self.backend.read().await.is_some()
    }

    /// Get the active backend's capabilities
    pub async fn capabilities(&self) -> Option<BackendCapabilities> {
        let lock = self.backend.read().await;
        lock.as_ref().map(|b| b.capabilities())
    }
}
