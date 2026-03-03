import { useState, useEffect } from "react";
import { useChatStore } from "@/stores/chatStore";
import type { AppSettings } from "@/lib/tauri";

export function SettingsPanel() {
  const settingsOpen = useChatStore((s) => s.settingsOpen);
  const setSettingsOpen = useChatStore((s) => s.setSettingsOpen);
  const currentSettings = useChatStore((s) => s.settings);
  const saveSettings = useChatStore((s) => s.saveSettings);

  const [form, setForm] = useState<AppSettings>({
    api_base_url: "https://api.openai.com/v1",
    api_key: "",
    default_model: "gpt-4o-mini",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync form with current settings
  useEffect(() => {
    if (currentSettings) {
      setForm(currentSettings);
    }
  }, [currentSettings]);

  if (!settingsOpen) return null;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveSettings(form);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const presets = [
    { label: "OpenAI", url: "https://api.openai.com/v1", model: "gpt-4o-mini" },
    { label: "Ollama (local)", url: "http://127.0.0.1:11434/v1", model: "llama3.2" },
    { label: "LM Studio", url: "http://127.0.0.1:1234/v1", model: "local-model" },
    { label: "OpenRouter", url: "https://openrouter.ai/api/v1", model: "meta-llama/llama-3-8b-instruct" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass glow-border rounded-xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
          <h2 className="font-display text-lg font-semibold text-heartline">
            Settings
          </h2>
          <button
            onClick={() => setSettingsOpen(false)}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-surface-hover text-text-secondary hover:text-text-primary transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="1" y1="1" x2="13" y2="13" />
              <line x1="13" y1="1" x2="1" y2="13" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Quick presets */}
          <div>
            <label className="block text-xs text-text-secondary mb-2 uppercase tracking-wider">
              Quick Setup
            </label>
            <div className="flex flex-wrap gap-2">
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      api_base_url: preset.url,
                      default_model: preset.model,
                    }))
                  }
                  className={`px-3 py-1.5 rounded-lg text-xs transition-all ${
                    form.api_base_url === preset.url
                      ? "bg-heartline/20 text-heartline border border-heartline/50"
                      : "glass glass-hover text-text-secondary"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* API Base URL */}
          <div>
            <label className="block text-xs text-text-secondary mb-1.5 uppercase tracking-wider">
              API Base URL
            </label>
            <input
              type="text"
              value={form.api_base_url}
              onChange={(e) =>
                setForm((f) => ({ ...f, api_base_url: e.target.value }))
              }
              className="w-full bg-space-700/50 border border-surface-border rounded-lg px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-heartline/50 transition-all"
              placeholder="https://api.openai.com/v1"
            />
          </div>

          {/* API Key */}
          <div>
            <label className="block text-xs text-text-secondary mb-1.5 uppercase tracking-wider">
              API Key
            </label>
            <input
              type="password"
              value={form.api_key}
              onChange={(e) =>
                setForm((f) => ({ ...f, api_key: e.target.value }))
              }
              className="w-full bg-space-700/50 border border-surface-border rounded-lg px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-heartline/50 transition-all"
              placeholder="sk-... (leave empty for local servers)"
            />
            <p className="text-xs text-text-muted mt-1">
              For local servers (Ollama, LM Studio), you can leave this empty.
            </p>
          </div>

          {/* Model */}
          <div>
            <label className="block text-xs text-text-secondary mb-1.5 uppercase tracking-wider">
              Default Model
            </label>
            <input
              type="text"
              value={form.default_model}
              onChange={(e) =>
                setForm((f) => ({ ...f, default_model: e.target.value }))
              }
              className="w-full bg-space-700/50 border border-surface-border rounded-lg px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-heartline/50 transition-all"
              placeholder="gpt-4o-mini"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-surface-border">
          <button
            onClick={() => setSettingsOpen(false)}
            className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:text-text-primary glass glass-hover transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 rounded-lg text-sm font-medium bg-heartline/20 text-heartline border border-heartline/50 hover:bg-heartline/30 glow-border-subtle transition-all disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save & Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}
