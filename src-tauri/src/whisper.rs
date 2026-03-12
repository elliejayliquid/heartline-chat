use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;

const WHISPER_VERSION: &str = "1.5.0";

/// Manages a local Whisper installation for speech-to-text transcription.
/// Uses the pre-built whisper.cpp CLI binary — no C++ compilation needed.
pub struct WhisperEngine {
    data_dir: PathBuf,
    ready: Mutex<bool>,
}

impl WhisperEngine {
    pub fn new(data_dir: &PathBuf) -> Self {
        let whisper_dir = data_dir.join("whisper");
        Self {
            data_dir: whisper_dir,
            ready: Mutex::new(false),
        }
    }

    fn model_path(&self, model_name: &str) -> PathBuf {
        self.data_dir.join(format!("ggml-{}.bin", model_name))
    }

    fn exe_path(&self) -> PathBuf {
        self.data_dir.join("whisper-cli.exe")
    }

    /// Whether both the binary and the requested model are present.
    pub fn is_ready(&self, model_name: &str) -> bool {
        self.exe_path().exists() && self.model_path(model_name).exists()
    }

    /// Download the whisper.cpp CLI binary and requested model if not present.
    pub async fn ensure_ready(&self, model_name: &str) -> Result<(), String> {
        std::fs::create_dir_all(&self.data_dir)
            .map_err(|e| format!("Failed to create whisper dir: {}", e))?;

        // Download CLI binary if missing
        if !self.exe_path().exists() {
            self.download_binary().await?;
        }

        // Download model if missing
        if !self.model_path(model_name).exists() {
            self.download_model(model_name).await?;
        }

        *self.ready.lock().unwrap() = true;
        Ok(())
    }

    async fn download_binary(&self) -> Result<(), String> {
        let zip_url = format!(
            "https://github.com/ggerganov/whisper.cpp/releases/download/v{}/whisper-bin-x64.zip",
            WHISPER_VERSION
        );

        eprintln!("[Whisper] Downloading whisper.cpp CLI from {}...", zip_url);

        let zip_path = self.data_dir.join("_whisper_download.zip");

        // Download the zip file
        let response = reqwest::get(&zip_url)
            .await
            .map_err(|e| format!("Download failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("Download failed with status: {}", response.status()));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("Failed to read download: {}", e))?;

        std::fs::write(&zip_path, &bytes)
            .map_err(|e| format!("Failed to save zip: {}", e))?;

        eprintln!("[Whisper] Downloaded {:.1} MB, extracting...", bytes.len() as f64 / 1_048_576.0);

        // Use PowerShell's Expand-Archive to extract (built into Windows)
        let extract_dir = self.data_dir.join("_extract");
        let _ = std::fs::remove_dir_all(&extract_dir); // clean any previous extraction

        let ps_output = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
                    zip_path.display(),
                    extract_dir.display()
                ),
            ])
            .output()
            .map_err(|e| format!("PowerShell extraction failed: {}", e))?;

        if !ps_output.status.success() {
            let stderr = String::from_utf8_lossy(&ps_output.stderr);
            return Err(format!("Zip extraction failed: {}", stderr));
        }

        // Find whisper-cli.exe or main.exe in the extracted files
        let mut found_exe = false;
        if let Ok(entries) = find_files_recursive(&extract_dir) {
            for entry in &entries {
                let name = entry.file_name().unwrap_or_default().to_string_lossy();

                if name == "whisper-cli.exe" || name == "main.exe" {
                    std::fs::copy(entry, self.exe_path())
                        .map_err(|e| format!("Failed to copy exe: {}", e))?;
                    found_exe = true;
                    eprintln!("[Whisper] ✓ Found CLI: {}", name);
                }
                if name.ends_with(".dll") {
                    let dll_dest = self.data_dir.join(name.as_ref());
                    let _ = std::fs::copy(entry, &dll_dest);
                    eprintln!("[Whisper] ✓ Extracted DLL: {}", name);
                }
            }
        }

        // Clean up
        let _ = std::fs::remove_dir_all(&extract_dir);
        let _ = std::fs::remove_file(&zip_path);

        if !found_exe {
            return Err("Could not find whisper-cli.exe in downloaded archive".to_string());
        }

        Ok(())
    }

    async fn download_model(&self, model_name: &str) -> Result<(), String> {
        let url = format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{}.bin", model_name);
        eprintln!("[Whisper] Downloading {} model (~148MB)...", model_name);

        let response = reqwest::get(&url)
            .await
            .map_err(|e| format!("Model download failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("Model download failed with status: {}", response.status()));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("Failed to read model: {}", e))?;

        std::fs::write(self.model_path(model_name), &bytes)
            .map_err(|e| format!("Failed to save model: {}", e))?;

        eprintln!(
            "[Whisper] ✓ Model saved ({:.1} MB)",
            bytes.len() as f64 / 1_048_576.0
        );
        Ok(())
    }

    /// Transcribe a WAV file by calling the whisper.cpp CLI.
    pub fn transcribe_file(&self, wav_path: &PathBuf, model_name: &str) -> Result<String, String> {
        if !self.is_ready(model_name) {
            return Err("Whisper not ready — call ensure_ready first".to_string());
        }

        eprintln!("[Whisper] Transcribing {wav_path:?} using {model_name} model");

        // Use "-l auto" for "base" to auto-detect language, or "-l en" for "base.en"
        let lang = if model_name == "base.en" { "en" } else { "auto" };

        let output = Command::new(self.exe_path())
            .arg("-m")
            .arg(self.model_path(model_name))
            .arg("-f")
            .arg(wav_path)
            .arg("--no-timestamps")
            .arg("-l")
            .arg(lang)
            .output()
            .map_err(|e| format!("Failed to run whisper: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            eprintln!("[Whisper] CLI stderr: {}", stderr);
            return Err(format!("Whisper exited with: {}", output.status));
        }

        // whisper-cli outputs progress/info to stderr, transcription to stdout
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        eprintln!("[Whisper] stderr (info): {}", &stderr[..stderr.len().min(300)]);

        // The actual transcription is in stdout, filter out info lines
        let text = stdout
            .lines()
            .filter(|l| {
                !l.starts_with("whisper_")
                    && !l.starts_with("main:")
                    && !l.starts_with("system_info")
                    && !l.is_empty()
            })
            .collect::<Vec<&str>>()
            .join(" ")
            .trim()
            .to_string();

        eprintln!("[Whisper] ✓ Transcribed: \"{}\"", &text[..text.len().min(100)]);
        Ok(text)
    }

    /// Save raw WAV bytes to a temp file and transcribe.
    pub fn transcribe_wav(&self, wav_data: &[u8], model_name: &str) -> Result<String, String> {
        let wav_path = self.data_dir.join("_temp_recording.wav");
        std::fs::write(&wav_path, wav_data)
            .map_err(|e| format!("Failed to write temp wav: {}", e))?;

        let result = self.transcribe_file(&wav_path, model_name);

        // Clean up
        let _ = std::fs::remove_file(&wav_path);
        let txt_path = self.data_dir.join("_temp_recording.wav.txt");
        let _ = std::fs::remove_file(&txt_path);

        result
    }
}

/// Recursively find all files in a directory.
fn find_files_recursive(dir: &PathBuf) -> Result<Vec<PathBuf>, std::io::Error> {
    let mut files = Vec::new();
    if dir.is_dir() {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                files.extend(find_files_recursive(&path)?);
            } else {
                files.push(path);
            }
        }
    }
    Ok(files)
}
