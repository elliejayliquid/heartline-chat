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
pub struct StoredMessage {
    pub id: i64,
    pub companion_id: String,
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

            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                companion_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp TEXT NOT NULL DEFAULT (datetime('now')),
                emotion TEXT,
                FOREIGN KEY (companion_id) REFERENCES companions(id)
            );

            CREATE INDEX IF NOT EXISTS idx_messages_companion
                ON messages(companion_id, timestamp DESC);

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            ",
        )
        .map_err(|e| format!("Failed to initialize tables: {}", e))?;

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

    // --- Message operations ---

    pub fn get_messages(
        &self,
        companion_id: &str,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<StoredMessage>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, companion_id, role, content, timestamp, emotion
                 FROM messages
                 WHERE companion_id = ?1
                 ORDER BY timestamp DESC
                 LIMIT ?2 OFFSET ?3",
            )
            .map_err(|e| format!("Query error: {}", e))?;

        let messages: Vec<StoredMessage> = stmt
            .query_map(params![companion_id, limit, offset], |row| {
                Ok(StoredMessage {
                    id: row.get(0)?,
                    companion_id: row.get(1)?,
                    role: row.get(2)?,
                    content: row.get(3)?,
                    timestamp: row.get(4)?,
                    emotion: row.get(5)?,
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
        role: &str,
        content: &str,
    ) -> Result<i64, String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO messages (companion_id, role, content) VALUES (?1, ?2, ?3)",
            params![companion_id, role, content],
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
