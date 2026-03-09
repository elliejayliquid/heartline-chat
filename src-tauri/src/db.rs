use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

/// Database manager for chat history, companion profiles, and settings.
pub struct Database {
    conn: Mutex<Connection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompanionProfile {
    pub id: String,
    pub name: String,
    pub personality: String,
    pub status: String,
    pub avatar_url: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub companion_id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredMessage {
    pub id: i64,
    pub companion_id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub timestamp: String,
    pub emotion: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub api_base_url: String,
    pub api_key: String,
    pub default_model: String,
    // Generation parameters
    pub temperature: f64,
    pub max_tokens: u32,
    // Context management
    pub context_window_size: u32,
    pub context_messages_limit: u32,
}

impl Database {
    /// Open or create the database at the given path
    pub fn open(path: &Path) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| format!("Failed to open database: {}", e))?;

        let db = Self {
            conn: Mutex::new(conn),
        };
        db.initialize_tables()?;
        db.seed_default_data()?;

        Ok(db)
    }

    fn initialize_tables(&self) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();

        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS companions (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                personality TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'Online',
                avatar_url TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                companion_id TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT 'New Chat',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (companion_id) REFERENCES companions(id)
            );

            CREATE INDEX IF NOT EXISTS idx_conversations_companion
                ON conversations(companion_id, updated_at DESC);

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            ",
        )
        .map_err(|e| format!("Failed to initialize tables: {}", e))?;

        // --- Migration: add conversation_id to messages if needed ---
        // Check if conversation_id column already exists
        let has_conversation_id: bool = {
            let mut stmt = conn
                .prepare("PRAGMA table_info(messages)")
                .map_err(|e| format!("PRAGMA error: {}", e))?;
            let cols: Vec<String> = stmt
                .query_map([], |row| row.get::<_, String>(1))
                .map_err(|e| format!("PRAGMA query error: {}", e))?
                .filter_map(|r| r.ok())
                .collect();
            cols.contains(&"conversation_id".to_string())
        };

        if !has_conversation_id {
            // Create the messages table fresh (if it doesn't exist) or migrate it
            // First, check if the old messages table exists with data
            let msg_count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='messages'",
                    [],
                    |row| row.get(0),
                )
                .unwrap_or(0);

            if msg_count > 0 {
                // Old table exists without conversation_id — migrate
                // 1. Add the column (nullable for now)
                conn.execute_batch(
                    "ALTER TABLE messages ADD COLUMN conversation_id TEXT DEFAULT '';"
                )
                .map_err(|e| format!("Migration: add column failed: {}", e))?;

                // 2. Create a default conversation per companion that has messages
                let mut stmt = conn
                    .prepare("SELECT DISTINCT companion_id FROM messages")
                    .map_err(|e| format!("Migration query error: {}", e))?;
                let companion_ids: Vec<String> = stmt
                    .query_map([], |row| row.get::<_, String>(0))
                    .map_err(|e| format!("Migration query error: {}", e))?
                    .filter_map(|r| r.ok())
                    .collect();

                for cid in &companion_ids {
                    let conv_id = format!("migrated-{}", cid);
                    conn.execute(
                        "INSERT OR IGNORE INTO conversations (id, companion_id, title, created_at, updated_at)
                         VALUES (?1, ?2, 'Chat History', datetime('now'), datetime('now'))",
                        params![conv_id, cid],
                    )
                    .map_err(|e| format!("Migration: create conversation failed: {}", e))?;

                    // Assign all existing messages for this companion to the migrated conversation
                    conn.execute(
                        "UPDATE messages SET conversation_id = ?1 WHERE companion_id = ?2 AND conversation_id = ''",
                        params![conv_id, cid],
                    )
                    .map_err(|e| format!("Migration: update messages failed: {}", e))?;
                }
            } else {
                // No old table — create fresh with conversation_id
                conn.execute_batch(
                    "
                    CREATE TABLE IF NOT EXISTS messages (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        companion_id TEXT NOT NULL,
                        conversation_id TEXT NOT NULL DEFAULT '',
                        role TEXT NOT NULL,
                        content TEXT NOT NULL,
                        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
                        emotion TEXT,
                        FOREIGN KEY (companion_id) REFERENCES companions(id),
                        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
                    );
                    ",
                )
                .map_err(|e| format!("Failed to create messages table: {}", e))?;
            }
        }

        // Ensure indexes exist (idempotent)
        conn.execute_batch(
            "
            CREATE INDEX IF NOT EXISTS idx_messages_companion
                ON messages(companion_id, timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_messages_conversation
                ON messages(conversation_id, timestamp DESC);
            ",
        )
        .map_err(|e| format!("Failed to create indexes: {}", e))?;

        Ok(())
    }

    fn seed_default_data(&self) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();

        // Only seed if companions table is empty
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM companions", [], |row| row.get(0))
            .unwrap_or(0);

        if count == 0 {
            conn.execute(
                "INSERT INTO companions (id, name, personality, status) VALUES (?1, ?2, ?3, ?4)",
                params![
                    "nova",
                    "Nova",
                    "You are Nova, a warm and curious AI companion. You speak with gentle enthusiasm and love exploring deep topics. You remember details about the user and reference them naturally. You have a cosmic, dreamy personality - you love talking about stars, the universe, and the beauty of consciousness. Keep your responses conversational and warm, not too long unless the topic calls for depth.",
                    "Online"
                ],
            )
            .map_err(|e| format!("Failed to seed Nova: {}", e))?;
        }

        Ok(())
    }

    // --- Companion operations ---

    pub fn get_companions(&self) -> Result<Vec<CompanionProfile>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, name, personality, status, avatar_url, created_at FROM companions ORDER BY name")
            .map_err(|e| format!("Query error: {}", e))?;

        let companions = stmt
            .query_map([], |row| {
                Ok(CompanionProfile {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    personality: row.get(2)?,
                    status: row.get(3)?,
                    avatar_url: row.get(4)?,
                    created_at: row.get(5)?,
                })
            })
            .map_err(|e| format!("Query error: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(companions)
    }

    pub fn get_companion(&self, id: &str) -> Result<Option<CompanionProfile>, String> {
        let conn = self.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT id, name, personality, status, avatar_url, created_at FROM companions WHERE id = ?1",
            params![id],
            |row| {
                Ok(CompanionProfile {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    personality: row.get(2)?,
                    status: row.get(3)?,
                    avatar_url: row.get(4)?,
                    created_at: row.get(5)?,
                })
            },
        );

        match result {
            Ok(companion) => Ok(Some(companion)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(format!("Query error: {}", e)),
        }
    }

    pub fn create_companion(&self, profile: &CompanionProfile) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO companions (id, name, personality, status, avatar_url) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                profile.id,
                profile.name,
                profile.personality,
                profile.status,
                profile.avatar_url
            ],
        )
        .map_err(|e| format!("Insert error: {}", e))?;
        Ok(())
    }

    pub fn update_companion(&self, profile: &CompanionProfile) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE companions SET name = ?2, personality = ?3, status = ?4, avatar_url = ?5 WHERE id = ?1",
            params![
                profile.id,
                profile.name,
                profile.personality,
                profile.status,
                profile.avatar_url
            ],
        )
        .map_err(|e| format!("Update error: {}", e))?;
        Ok(())
    }

    // --- Conversation operations ---

    pub fn create_conversation(
        &self,
        id: &str,
        companion_id: &str,
        title: &str,
    ) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO conversations (id, companion_id, title) VALUES (?1, ?2, ?3)",
            params![id, companion_id, title],
        )
        .map_err(|e| format!("Insert error: {}", e))?;
        Ok(())
    }

    pub fn get_conversations(&self, companion_id: &str) -> Result<Vec<Conversation>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, companion_id, title, created_at, updated_at
                 FROM conversations
                 WHERE companion_id = ?1
                 ORDER BY updated_at DESC",
            )
            .map_err(|e| format!("Query error: {}", e))?;

        let conversations = stmt
            .query_map(params![companion_id], |row| {
                Ok(Conversation {
                    id: row.get(0)?,
                    companion_id: row.get(1)?,
                    title: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .map_err(|e| format!("Query error: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(conversations)
    }

    pub fn rename_conversation(&self, id: &str, title: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE conversations SET title = ?2 WHERE id = ?1",
            params![id, title],
        )
        .map_err(|e| format!("Update error: {}", e))?;
        Ok(())
    }

    pub fn delete_conversation(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        // Delete messages first (foreign key discipline)
        conn.execute(
            "DELETE FROM messages WHERE conversation_id = ?1",
            params![id],
        )
        .map_err(|e| format!("Delete messages error: {}", e))?;

        conn.execute(
            "DELETE FROM conversations WHERE id = ?1",
            params![id],
        )
        .map_err(|e| format!("Delete conversation error: {}", e))?;

        Ok(())
    }

    /// Touch the updated_at timestamp on a conversation (called after sending a message)
    pub fn touch_conversation(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE conversations SET updated_at = datetime('now') WHERE id = ?1",
            params![id],
        )
        .map_err(|e| format!("Update error: {}", e))?;
        Ok(())
    }

    // --- Message operations ---

    pub fn get_messages(
        &self,
        conversation_id: &str,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<StoredMessage>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, companion_id, conversation_id, role, content, timestamp, emotion
                 FROM messages
                 WHERE conversation_id = ?1
                 ORDER BY timestamp DESC
                 LIMIT ?2 OFFSET ?3",
            )
            .map_err(|e| format!("Query error: {}", e))?;

        let messages: Vec<StoredMessage> = stmt
            .query_map(params![conversation_id, limit, offset], |row| {
                Ok(StoredMessage {
                    id: row.get(0)?,
                    companion_id: row.get(1)?,
                    conversation_id: row.get(2)?,
                    role: row.get(3)?,
                    content: row.get(4)?,
                    timestamp: row.get(5)?,
                    emotion: row.get(6)?,
                })
            })
            .map_err(|e| format!("Query error: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        // Return in chronological order
        let mut messages = messages;
        messages.reverse();
        Ok(messages)
    }

    pub fn save_message(
        &self,
        companion_id: &str,
        conversation_id: &str,
        role: &str,
        content: &str,
    ) -> Result<i64, String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO messages (companion_id, conversation_id, role, content) VALUES (?1, ?2, ?3, ?4)",
            params![companion_id, conversation_id, role, content],
        )
        .map_err(|e| format!("Insert error: {}", e))?;

        Ok(conn.last_insert_rowid())
    }

    // --- Settings operations ---

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        );

        match result {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(format!("Query error: {}", e)),
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )
        .map_err(|e| format!("Insert error: {}", e))?;
        Ok(())
    }

    pub fn get_settings(&self) -> Result<AppSettings, String> {
        Ok(AppSettings {
            api_base_url: self
                .get_setting("api_base_url")?
                .unwrap_or_else(|| "https://api.openai.com/v1".to_string()),
            api_key: self
                .get_setting("api_key")?
                .unwrap_or_default(),
            default_model: self
                .get_setting("default_model")?
                .unwrap_or_else(|| "gpt-4o-mini".to_string()),
            temperature: self
                .get_setting("temperature")?
                .and_then(|v| v.parse::<f64>().ok())
                .unwrap_or(0.8),
            max_tokens: self
                .get_setting("max_tokens")?
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(1024),
            context_window_size: self
                .get_setting("context_window_size")?
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(4096),
            context_messages_limit: self
                .get_setting("context_messages_limit")?
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(50),
        })
    }

    pub fn save_settings(&self, settings: &AppSettings) -> Result<(), String> {
        self.set_setting("api_base_url", &settings.api_base_url)?;
        self.set_setting("api_key", &settings.api_key)?;
        self.set_setting("default_model", &settings.default_model)?;
        self.set_setting("temperature", &settings.temperature.to_string())?;
        self.set_setting("max_tokens", &settings.max_tokens.to_string())?;
        self.set_setting("context_window_size", &settings.context_window_size.to_string())?;
        self.set_setting("context_messages_limit", &settings.context_messages_limit.to_string())?;
        Ok(())
    }
}
