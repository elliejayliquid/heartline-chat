import { useState, useEffect } from "react";
import { useChatStore } from "@/stores/chatStore";
import type { CompanionProfile } from "@/lib/tauri";

export function CompanionEditor() {
  const isOpen = useChatStore((s) => s.companionEditorOpen);
  const editingCompanion = useChatStore((s) => s.editingCompanion);
  const closeEditor = useChatStore((s) => s.closeCompanionEditor);
  const createCompanion = useChatStore((s) => s.createCompanion);
  const updateCompanion = useChatStore((s) => s.updateCompanion);

  const isEditing = editingCompanion !== null;

  const [form, setForm] = useState({
    name: "",
    personality: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync form when opening
  useEffect(() => {
    if (isOpen && editingCompanion) {
      setForm({
        name: editingCompanion.name,
        personality: editingCompanion.personality,
      });
    } else if (isOpen) {
      setForm({ name: "", personality: "" });
    }
    setError(null);
  }, [isOpen, editingCompanion]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const profile: CompanionProfile = {
        id: editingCompanion?.id ?? crypto.randomUUID(),
        name: form.name.trim(),
        personality: form.personality,
        status: editingCompanion?.status ?? "Online",
        avatar_url: editingCompanion?.avatar_url ?? null,
        created_at: editingCompanion?.created_at ?? new Date().toISOString(),
      };

      if (isEditing) {
        await updateCompanion(profile);
      } else {
        await createCompanion(profile);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass glow-border rounded-xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
          <h2 className="font-display text-lg font-semibold text-heartline">
            {isEditing ? `Edit ${editingCompanion.name}` : "New Companion"}
          </h2>
          <button
            onClick={closeEditor}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-surface-hover text-text-secondary hover:text-text-primary transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="1" y1="1" x2="13" y2="13" />
              <line x1="13" y1="1" x2="1" y2="13" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[60vh]">
          {/* Name */}
          <div>
            <label className="block text-xs text-text-secondary mb-1.5 uppercase tracking-wider">
              Name
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full bg-space-700/50 border border-surface-border rounded-lg px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-heartline/50 transition-all"
              placeholder="e.g. Luna, Kai, Atlas..."
              autoFocus
            />
          </div>

          {/* Personality / System Prompt */}
          <div>
            <label className="block text-xs text-text-secondary mb-1.5 uppercase tracking-wider">
              Personality (System Prompt)
            </label>
            <textarea
              value={form.personality}
              onChange={(e) =>
                setForm((f) => ({ ...f, personality: e.target.value }))
              }
              rows={6}
              className="w-full bg-space-700/50 border border-surface-border rounded-lg px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-heartline/50 transition-all resize-y"
              placeholder="Describe your companion's personality, speaking style, interests, and how they should interact with you..."
            />
            <p className="text-xs text-text-muted mt-1">
              This defines who your companion is. The more detail, the more consistent their personality.
            </p>
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
            onClick={closeEditor}
            className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:text-text-primary glass glass-hover transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.name.trim()}
            className="px-6 py-2 rounded-lg text-sm font-medium bg-heartline/20 text-heartline border border-heartline/50 hover:bg-heartline/30 glow-border-subtle transition-all disabled:opacity-50"
          >
            {saving
              ? "Saving..."
              : isEditing
                ? "Save Changes"
                : "Create Companion"}
          </button>
        </div>
      </div>
    </div>
  );
}
