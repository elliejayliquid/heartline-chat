use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

/// Application-wide event bus.
/// This is the foundation for plugin hooks and scheduler triggers.
/// Any subsystem can emit events, and any listener (plugin, scheduler, UI) can subscribe.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum AppEvent {
    /// A user message was received
    MessageReceived {
        companion_id: String,
        content: String,
    },

    /// The AI finished generating a response
    MessageGenerated {
        companion_id: String,
        content: String,
    },

    /// Streaming token received (for real-time UI updates)
    StreamToken {
        companion_id: String,
        token: String,
        done: bool,
    },

    /// A companion was switched to
    CompanionChanged {
        companion_id: String,
    },

    /// Settings were updated
    SettingsChanged {
        key: String,
        value: String,
    },

    /// App lifecycle
    AppStarted,
    AppFocused,
    AppBlurred,
}

/// The event bus - clone the sender to emit, subscribe via the receiver
pub struct EventBus {
    sender: broadcast::Sender<AppEvent>,
}

impl EventBus {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(256);
        Self { sender }
    }

    /// Emit an event to all listeners
    pub fn emit(&self, event: AppEvent) {
        // It's ok if nobody is listening
        let _ = self.sender.send(event);
    }

    /// Subscribe to events
    pub fn subscribe(&self) -> broadcast::Receiver<AppEvent> {
        self.sender.subscribe()
    }
}
