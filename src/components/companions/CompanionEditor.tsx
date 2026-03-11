import { useState, useEffect } from "react";
import { useChatStore } from "@/stores/chatStore";
import { api, type CompanionProfile, type Memory } from "@/lib/tauri";

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

  // Memory state
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memoriesLoading, setMemoriesLoading] = useState(false);
  const [memoriesExpanded, setMemoriesExpanded] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Sync form when opening
  useEffect(() => {
    if (isOpen && editingCompanion) {
      setForm({
        name: editingCompanion.name,
        personality: editingCompanion.personality,
      });
      // Load memories for this companion
      setMemoriesLoading(true);
      setMemoriesExpanded(false);
      api
        .getCompanionMemories(editingCompanion.id)
        .then((mems) => setMemories(mems))
        .catch((err) => console.error("Failed to load memories:", err))
        .finally(() => setMemoriesLoading(false));
    } else if (isOpen) {
      setForm({ name: "", personality: "" });
      setMemories([]);
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

  const handleDeleteMemory = async (id: number) => {
    setDeletingId(id);
    try {
      await api.deleteMemory(id);
      setMemories((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      console.error("Failed to delete memory:", err);
    } finally {
      setDeletingId(null);
    }
  };

  const typeColors: Record<string, string> = {
    personal_fact: "text-blue-400 bg-blue-500/15 border-blue-500/30",
    preference: "text-purple-400 bg-purple-500/15 border-purple-500/30",
    moment: "text-amber-400 bg-amber-500/15 border-amber-500/30",
    relationship_shift: "text-pink-400 bg-pink-500/15 border-pink-500/30",
    identity_note: "text-emerald-400 bg-emerald-500/15 border-emerald-500/30",
  };

  const confidenceColors: Record<string, string> = {
    high: "text-green-400",
    medium: "text-yellow-400",
    low: "text-red-400",
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
        <div className="p-6 space-y-5 overflow-y-auto max-h-[70vh]">
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

          {/* Memories Section — only when editing */}
          {isEditing && (
            <div className="border-t border-surface-border pt-5">
              <button
                onClick={() => setMemoriesExpanded(!memoriesExpanded)}
                className="flex items-center justify-between w-full group"
              >
                <div className="flex items-center gap-2">
                  <label className="text-xs text-text-secondary uppercase tracking-wider cursor-pointer group-hover:text-text-primary transition-colors">
                    Memories
                  </label>
                  <span className="text-xs text-text-muted bg-space-700/60 px-2 py-0.5 rounded-full">
                    {memoriesLoading ? "..." : memories.length}
                  </span>
                </div>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className={`text-text-muted transition-transform duration-200 ${memoriesExpanded ? "rotate-180" : ""
                    }`}
                >
                  <polyline points="2,4 6,8 10,4" />
                </svg>
              </button>

              {memoriesExpanded && (
                <div className="mt-3 space-y-2">
                  {memoriesLoading ? (
                    <div className="text-center py-6 text-text-muted text-sm">
                      Loading memories...
                    </div>
                  ) : memories.length === 0 ? (
                    <div className="text-center py-6 text-text-muted text-sm">
                      No memories yet — keep chatting and they'll appear here ✨
                    </div>
                  ) : (
                    memories.map((mem) => (
                      <div
                        key={mem.id}
                        className={`group/card relative glass rounded-lg px-4 py-3 border border-surface-border hover:border-surface-border/80 transition-all ${deletingId === mem.id ? "opacity-40" : ""
                          }`}
                      >
                        {/* Delete button */}
                        <button
                          onClick={() => handleDeleteMemory(mem.id)}
                          disabled={deletingId === mem.id}
                          className="absolute top-2 right-2 w-6 h-6 rounded flex items-center justify-center opacity-0 group-hover/card:opacity-100 hover:bg-red-500/20 text-text-muted hover:text-red-400 transition-all"
                          title="Delete memory"
                        >
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <line x1="1" y1="1" x2="9" y2="9" />
                            <line x1="9" y1="1" x2="1" y2="9" />
                          </svg>
                        </button>

                        {/* Content */}
                        <p className="text-sm text-text-primary pr-6 leading-relaxed">
                          {mem.content}
                        </p>

                        {/* Meta badges */}
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                          {/* Type badge */}
                          <span
                            className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${typeColors[mem.memory_type] ??
                              "text-text-muted bg-space-700/50 border-surface-border"
                              }`}
                          >
                            {mem.memory_type.replace("_", " ")}
                          </span>

                          {/* Confidence */}
                          <span
                            className={`text-[10px] ${confidenceColors[mem.confidence] ?? "text-text-muted"
                              }`}
                          >
                            {mem.confidence}
                          </span>

                          {/* Importance */}
                          <span className="text-[10px] text-text-muted" title={`Importance: ${mem.importance}/10`}>
                            ⚡{mem.importance}
                          </span>

                          {/* Date */}
                          <span className="text-[10px] text-text-muted ml-auto">
                            {new Date(mem.created_at + "Z").toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

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
