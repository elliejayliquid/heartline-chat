# Heartline - Design Document

> An AI companion chat application with voice, 3D avatar, and local model support.
> "A crazy dreamy idea to build up slowly."

---

## 1. Vision

Heartline is a desktop AI companion app with a sci-fi/cosmic aesthetic. Users chat with an AI companion via text or voice, while a 3D avatar reacts with emotion-driven animations. It runs local models natively (no LM Studio needed), supports cloud APIs, and handles memory/context intelligently.

**Core experience:** You open Heartline, your companion's 3D avatar is waiting. You type or speak. They respond with text, voice, and animated gestures that match the emotion of their words. They remember your conversations. It feels alive.

---

## 2. Architecture Overview

```
+------------------------------------------------------------------+
|                        TAURI 2 SHELL                             |
|  +------------------------------------------------------------+  |
|  |                    REACT FRONTEND                           |  |
|  |  +------------+  +----------------+  +-------------------+  |  |
|  |  | Chat Panel |  | 3D Viewport    |  | Companion Panel   |  |  |
|  |  | (draggable)|  | (Three.js/R3F) |  | (status, memory)  |  |  |
|  |  +------------+  +----------------+  +-------------------+  |  |
|  |  +------------+  +----------------+  +-------------------+  |  |
|  |  | Chats List |  | Voice Controls |  | Settings Panel    |  |  |
|  |  +------------+  +----------------+  +-------------------+  |  |
|  +------------------------------------------------------------+  |
|                              |  IPC (Tauri commands)             |
|  +------------------------------------------------------------+  |
|  |                    RUST BACKEND                             |  |
|  |  +---------------+  +---------------+  +----------------+  |  |
|  |  | Inference     |  | Voice Engine  |  | Memory Store   |  |  |
|  |  | Manager       |  | (TTS + STT)  |  | (SQLite + Vec) |  |  |
|  |  +---------------+  +---------------+  +----------------+  |  |
|  |  +---------------+  +---------------+  +----------------+  |  |
|  |  | Model Manager |  | Emotion       |  | Context        |  |  |
|  |  | (download,    |  | Analyzer      |  | Builder        |  |  |
|  |  |  GGUF, API)   |  |               |  |                |  |  |
|  |  +---------------+  +---------------+  +----------------+  |  |
|  +------------------------------------------------------------+  |
+------------------------------------------------------------------+
```

### Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Desktop shell | **Tauri 2** | Lightweight (~10MB), Rust backend, native performance |
| Frontend | **React + TypeScript** | Rich ecosystem, great for complex draggable UIs |
| Styling | **Tailwind CSS** | Rapid styling, easy to theme the cosmic aesthetic |
| 3D rendering | **React Three Fiber** (Three.js) | 3D avatar in the browser, glTF model support |
| UI layout | **react-mosaic** or custom | Draggable, resizable, dockable panels |
| State management | **Zustand** | Simple, performant, perfect for chat state |
| Local inference | **llama.cpp** (via Rust bindings) | Direct GGUF model loading, GPU acceleration |
| API compat | **Ollama + OpenAI-compatible** | Connect to Ollama, OpenAI, Anthropic, etc. |
| Voice STT | **Whisper.cpp** (embedded) | Local speech-to-text, privacy-first |
| Voice TTS | **Qwen3-TTS** (0.6B/1.7B) + Piper fallback | Emotion-controllable TTS, 97ms latency, 4-8GB VRAM |
| Database | **SQLite** (via rusqlite) | Chat history, companion profiles, settings |
| Vector memory | **SQLite + vector extension** or **qdrant-embedded** | Semantic memory search |
| IPC | **Tauri commands** | Type-safe Rust <-> JS communication |

---

## 3. UI Design

### 3.1 Aesthetic

- **Theme:** Deep space / cosmic - dark navy-to-black gradients, glowing cyan/teal accents, starfield particles
- **Typography:** Clean, slightly futuristic sans-serif (e.g., Exo 2, Orbitron for headers)
- **Accents:** Pulsing heartbeat line in the header (the "heartline"), glowing borders on active panels
- **Message bubbles:** Frosted glass effect, slight glow on AI messages

### 3.2 Panel Layout

All panels are **draggable, resizable, and dockable** using a tiling window manager approach:

```
Default desktop layout:
+------------------+------------------------+------------------+
|                  |                        |                  |
|   CHATS LIST     |    3D AVATAR           |   CHAT WINDOW    |
|                  |    VIEWPORT            |                  |
|   - Companion 1  |                        |   [messages...]  |
|   - Companion 2  |    (emotion-driven     |                  |
|   - Companion 3  |     animations)        |   [input bar]    |
|                  |                        |   [voice btn]    |
+------------------+------------------------+------------------+
```

Users can:

- Drag panel edges to resize
- Drag panel headers to rearrange
- Collapse/expand panels
- Pop panels out into separate windows (stretch goal)
- Save/load layout presets

### 3.3 Key UI Components

| Component | Description |
|-----------|-------------|
| **Header Bar** | "HEARTLINE" logo with animated heartbeat line, connection status indicator |
| **Chats List** | List of conversations/companions with avatars, last message preview, timestamps |
| **3D Viewport** | Three.js canvas rendering the companion's 3D model with animations |
| **Chat Window** | Message history with bubbles, timestamps. Markdown rendering for AI responses |
| **Input Bar** | Text input with send button, voice toggle, attachment button |
| **Voice Controls** | Mic toggle, volume, voice activity indicator |
| **Companion Panel** | Current companion's name, status, personality summary, memory highlights |
| **Settings** | Model selection, voice settings, theme options, memory management |

---

## 4. Backend Systems

### 4.1 Inference Manager

A unified interface that routes to different backends:

```
InferenceManager
  ├── LocalBackend (llama.cpp embedded)
  │     ├── load_model(path: &str, params: ModelParams)
  │     ├── generate(prompt: &str, params: GenParams) -> Stream<Token>
  │     └── unload_model()
  ├── OllamaBackend (HTTP client)
  │     └── connects to local/remote Ollama instance
  └── APIBackend (HTTP client)
        └── OpenAI-compatible (works with OpenAI, Anthropic, local servers)
```

**Key features:**

- Streaming token generation (show tokens as they arrive)
- Model hot-swapping (switch models without restarting)
- GPU layer configuration for local models
- Automatic model discovery (scan common directories for GGUF files)
- Download models from HuggingFace directly in-app

### 4.2 Memory System

Five layers of memory, all stored locally. Each layer has different rules for storage, retrieval, and lifecycle.

| Layer | Purpose | Storage | Retrieval |
|-------|---------|---------|-----------|
| **Chat History** | Full conversation logs per thread | SQLite (structured) | Scrollback, search |
| **Working Memory** | Recent context + pinned memories | In-memory | Auto-injected into prompt every turn |
| **Episodic Memory** | Significant events and shared history | SQLite + vector embeddings | Semantic search, auto-recall |
| **Semantic Memory** | Extracted patterns, preferences, facts | SQLite + vector embeddings | Purpose-based retrieval |
| **Identity Profile** | Companion's stable behavioral traits | SQLite | Loaded at session boot |

#### Memory Entry Types

Every memory declares what it is, enabling smarter retrieval:

- `episode` — a meaningful event or conversation moment
- `semantic_fact` — extracted pattern or preference (evidence-based, revisable)
- `journal_reflection` — companion's private self-narration (observation, hypothesis, self-state, intention)
- `preference` — user preference confirmed across multiple interactions
- `relationship_shift` — change in relationship dynamic or trust level
- `identity_note` — companion behavioral trait (stable, low-rotation)

#### Memory Entry Fields

```yaml
text: "User prefers directness over reassurance"
type: semantic_fact
confidence: 0.84          # How sure (0-1)
stability: high            # high / medium / tentative
last_confirmed: "2026-03-09"
why_it_mattered: "Consistent across 5+ conversations"
tags: ["interaction-style", "preference"]
source_refs: ["conv-abc123"]  # Link back to episodes
supersedes: null              # ID of memory this replaces
```

#### Key Design Principles

- **Confidence-weighted**: Every interpretation has confidence, stability, and last_confirmed. Tentative memories are treated differently from solid ones.
- **Revision over accumulation**: Memories can be merged, superseded, weakened, archived, or retired. New evidence should refine existing memories, not create duplicates.
- **Retrieval by function**: Don't just retrieve by semantic similarity. Retrieve separately for: user preferences, emotional continuity, unresolved threads, identity consistency, callback opportunities. The most semantically similar memory is not always the most socially useful.
- **The main model should NEVER know about memory management.** Memory extraction, summarization, and retrieval happen in background sidecar processes. The response model just sees the assembled context.

**How it works:**

1. Every N messages, a background summarization pass extracts key facts
2. Facts are stored with vector embeddings for semantic retrieval
3. When building a prompt, relevant memories are retrieved and injected into context
4. Users can view, edit, and delete memories (full transparency)
5. Old memories decay in retrieval priority; stale conclusions can be retired

#### Failure Modes to Avoid

| Failure Mode | Cause | Prevention |
|-------------|-------|------------|
| **Clinginess** | Over-weighting emotional memories, too much initiative | Initiative thresholds, memory decay, uncertainty in relational inference |
| **Repetition** | Same pinned memories forever, same retrieved notes | Retrieval diversity penalties, cooldowns on recalled memories, anti-loop checks |
| **False intimacy** | Elevating weak evidence into emotional certainty | Evidence-linked memory, explicit uncertainty, separate observation from inference |
| **Personality collapse** | No identity layer, fragmented memory, model changes | Stable behavioral profile, pinned identity notes, model-agnostic personality schema |
| **Haunted scrapbook** | Too many sentimental artifacts with no curation | Stronger curation thresholds, archive tiers, "why does this matter now?" gating |

#### Anti-Loop Protections

Critical for companion systems where loops manifest as repeated reassurance, repeated concern, repeated intimacy moves, or repeated callbacks to old emotional moments.

- **Cooldowns**: If a memory was just retrieved, reduce its retrieval score temporarily
- **Diversity sampling**: Don't let the same 2-3 memories dominate context repeatedly
- **"What changed?" gate**: Before resurfacing a topic, verify something is actually new
- **Track unresolved threads explicitly**: Store topic + status + last_mentioned + mention_count + next_valid_checkin so the model doesn't anxiously resurface things
- **Cap self-reinforcing identity notes**: Identity notes require repeated evidence, start low-confidence, have expiry/review, and aren't overexposed in context
- **Boredom heuristic**: Track repeated topic/action/phrasing and add a "this is stale" penalty

### 4.3 Context Builder

Assembles the final prompt sent to the model:

```
[System prompt / companion personality]
[Identity profile (stable behavioral traits)]           # Future
[Relevant long-term memories (retrieved by function)]    # Future
[Conversation summary (if history is long)]              # Future
[Recent message history (last N messages, token-trimmed)]
[Current user message]
```

**Currently implemented:**
- Token-aware context trimming (rough estimate: 1 token ≈ 4 chars)
- Configurable context window size (2K–128K presets) and messages limit
- Automatic oldest-message trimming to fit within `context_window - max_tokens - system_prompt`
- Messages scoped to active conversation (not companion-wide)

**Future:**
- Summarize old messages rather than dropping them (rolling summaries)
- Inject relevant memories from semantic search
- Purpose-based memory retrieval (preferences, emotional continuity, identity)

### 4.4 Multi-Model Pipeline

Rather than one model doing everything, Heartline can run **specialized models in parallel** for different tasks. This is the backbone of making the companion feel intelligent without requiring a single massive model.

```
User message arrives
       |
       v
+------+-------+------+------+
|              |             |
v              v             v
RESPONSE       SIDECAR       SIDECAR
MODEL          MODEL #1      MODEL #2
(large/smart)  (small/fast)  (small/fast)
|              |             |
v              v             v
Companion      Emotion       Memory
response       classification extraction
               + animation   + fact storage
               trigger
```

**Model roles:**

| Role | Model Size | Task | Runs When |
|------|-----------|------|-----------|
| **Response Model** | Large (7B-70B+ or cloud API) | Generate the companion's reply | Every user message |
| **Emotion Analyzer** | Tiny (0.5B-1.5B) | Classify emotion + intensity from response text | After each response chunk (streaming) |
| **Memory Monitor** | Small (1B-3B) | Extract memorable facts, update user profile, flag important moments | Background, every N messages |
| **Summarizer** | Small (1B-3B) | Compress old conversation history into summaries | Background, periodic |

**Why this is powerful:**

- The response model stays focused on being a good conversationalist
- Sidecar models run in parallel, don't slow down the main response
- Emotion analysis happens *during* streaming, so avatar reacts in real-time
- Memory extraction is invisible to the user but makes the companion feel like it truly remembers
- Each role can use the best model for the job (a 1B model fine-tuned for classification will beat a 70B generalist at emotion detection)
- Users with limited hardware can disable sidecars and fall back to the response model doing everything

**Memory Monitor (deep dive):**

The memory monitor is a background process that watches the conversation and maintains the companion's "understanding" of the user:

```
Conversation stream
       |
       v
Memory Monitor (small local model)
       |
       +---> Extract facts: "User mentioned they have a dog named Biscuit"
       +---> Update preferences: "User prefers morning conversations"
       +---> Flag milestones: "This is the 100th conversation"
       +---> Detect topics: "User seems stressed about work lately"
       +---> Relationship notes: "User shared something vulnerable - increase trust level"
       |
       v
Long-term Memory Store (SQLite + vectors)
```

This runs asynchronously - it doesn't block the conversation. The companion model doesn't need to "decide" what to remember; the monitor handles it separately, and relevant memories get injected into future prompts by the context builder.

### 4.5 Emotion Analyzer

Classifies the emotional tone of AI responses to drive avatar animations.

This is one of the sidecar model roles (see Multi-Model Pipeline above), but can also work standalone:

**Approach (start simple, upgrade later):**

1. **V1 - Keyword/rule-based:** Simple regex + keyword matching for basic emotions (happy, sad, excited, thoughtful, etc.)
2. **V2 - Small classifier:** Dedicated small model (e.g., fine-tuned 0.5B) running as a sidecar
3. **V3 - LLM-native:** Ask the response model itself to output emotion tags as structured data alongside its response (works great with capable models)

**Emotion categories (initial set):**

- Neutral / Idle
- Happy / Amused
- Thoughtful / Contemplative
- Excited / Energetic
- Sad / Empathetic
- Affectionate / Warm
- Surprised
- Playful / Teasing

### 4.6 Voice Engine

| Component | Local Option | Cloud Option |
|-----------|-------------|--------------|
| **STT** (Speech-to-Text) | whisper.cpp (embedded) | Whisper API, Deepgram |
| **TTS** (Text-to-Speech) | Piper, Qwen3-TTS, Coqui XTTS | ElevenLabs, OpenAI TTS |

**Qwen3-TTS (primary local TTS candidate):**

- Two sizes: [0.6B (efficient)](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice) and [1.7B (peak quality)](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice)
- **Emotion/instruction control:** Tell it *how* to speak via natural language (e.g. "speak warmly", "excited tone") - pairs perfectly with our emotion analyzer
- **97ms streaming latency** - real-time conversational speed
- **10 languages** including English, Japanese, Korean
- **Voice cloning:** The [Base variant](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base) supports 3-second voice cloning - users could give their companion any voice
- **Custom voice creation:** Users can describe a voice in natural language and generate it - perfect as a companion voice settings feature
- **Hardware requirements (very reasonable):**
  - 0.6B model: **~4-6 GB VRAM** - runs on edge devices and older GPUs
  - 1.7B model: **~6-8 GB VRAM** - RTX 3060/4060 level, fine for single-user
  - FlashAttention 2 recommended (30-40% speedup, 20-25% VRAM reduction)
  - Storage: 0.6B = ~2.5GB, 1.7B = ~4.5GB
- **Strategy:** Ship 0.6B as default (runs on almost anything), offer 1.7B as quality upgrade. Piper as ultra-lightweight fallback for very old hardware.
- **Testing:** [Colab notebook for experimentation](https://colab.research.google.com/drive/1dBV1sqFeabqPX1FccnCGEj49u4BNaFt3#scrollTo=7pCSqGeC-UG_)

**Voice chat flow:**

1. User presses voice button (or uses push-to-talk / voice activation)
2. Audio captured -> STT -> text
3. Text sent to inference engine -> response text
4. Response text -> emotion analysis -> avatar animation
5. Response text -> TTS -> audio playback
6. All while streaming (STT streams partial text, LLM streams response, TTS streams audio)

---

## 5. 3D Avatar System

### 5.1 Architecture

```
Emotion Analyzer --> Animation Controller --> Three.js Renderer
                                                   |
                                              glTF Model
                                           (loaded at runtime)
```

### 5.2 Phased Approach

| Phase | Fidelity | Details |
|-------|----------|---------|
| **Phase 1** | Basic 3D | Simple stylized character (e.g., VRM or custom glTF). Idle animation + gesture-based reactions (wave, nod, shrug, heart). No facial animation. |
| **Phase 2** | Mid-fidelity | Add blend shapes for basic facial expressions. Lip sync placeholder (jaw open/close on speech). More gesture variety. |
| **Phase 3** | High-fidelity | MetaHuman-quality model exported to glTF. Full facial animation with blend shapes. Viseme-based lip sync. Smooth emotion blending. |

### 5.3 Animation Controller

```typescript
interface AnimationState {
  emotion: Emotion;          // Current detected emotion
  intensity: number;         // 0-1, how strong the emotion is
  isSpeaking: boolean;       // Is TTS currently playing?
  isListening: boolean;      // Is STT currently active?
  isThinking: boolean;       // Is the model generating?
  gesture?: GestureType;     // Optional triggered gesture
}
```

- Smooth blending between emotion states (no jarring transitions)
- Idle animations always playing (breathing, subtle movement, blinking)
- Gesture triggers on specific keywords or emotion spikes
- "Thinking" animation while model generates tokens
- Unlocking more complex animations based on the relationship

### 5.4 Model Format

- **glTF 2.0 / GLB** as the standard format (Three.js native support)
- **VRM** support for anime-style avatars (via @pixiv/three-vrm)
- MetaHuman models can be exported from Unreal -> glTF via plugins
- Users can potentially import their own models (stretch goal)

---

## 6. Companion System

### 6.1 Companion Profile

Each companion has:

```yaml
name: "Nova"
personality: |
  You are Nova, a warm and curious AI companion. You speak with
  gentle enthusiasm and love exploring deep topics. You remember
  details about the user and reference them naturally.
voice:
  tts_model: "piper-en-nova"
  speed: 1.0
  pitch: 1.0
avatar:
  model_path: "avatars/nova.glb"
  idle_animation: "breathing"
  palette: "cosmic-blue"
memory_config:
  auto_summarize: true
  recall_top_k: 5
```

### 6.2 Multiple Companions

- Users can create multiple companions with different personalities
- Each companion has its own chat history, memories, and avatar
- Switch between companions from the chats list
- Companions can optionally share a "world knowledge" memory pool

### 6.3 Relationship Progression

The companion tracks a "relationship level" that evolves over time, affecting behavior and animations:

```
Level 1: Stranger     -> Formal, polite, basic idle animations
Level 2: Acquaintance -> More relaxed, occasional humor, simple gestures
Level 3: Friend       -> Casual tone, references shared memories, expressive gestures
Level 4: Close Friend -> Vulnerable moments, inside jokes, complex animations
Level 5: Deep Bond    -> Full emotional range, unique animations unlocked, proactive care
```

- Progression is tracked by the Memory Monitor (conversation count, emotional depth, topics shared)
- **Animation unlocks** tied to relationship level (e.g., a heart gesture only appears at Level 3+)
- Users can see their relationship level in the companion panel
- Prevents companions from feeling artificially intimate too quickly
- Relationship can also regress with long absences (companion notices: "It's been a while...")

### 6.4 Companion Marketplace (Monetization)

A community marketplace where users can share and sell companion profiles:

**What's in a companion package:**

- Personality prompt + system instructions
- Custom 3D avatar (glTF/VRM model + animations)
- Voice configuration (TTS model, voice clone sample, speaking style)
- Memory templates (starter knowledge, backstory)
- Theme/color palette

**Marketplace model:**

- **Free tier:** Share companions openly, community ratings
- **Premium companions:** Creators can sell polished companions (revenue share)
- **Subscription option:** Access to a curated library of premium companions
- **Creator tools:** In-app companion builder/editor for creators

**Privacy-first:** No conversation data ever leaves the device. Marketplace only handles companion *profiles*, never user data.

---

## 7. Plugin Architecture

Heartline is built as a **modular core + plugin system** from day one. Every major subsystem (inference, voice, memory, avatar) is a trait/interface that plugins can implement.

### 7.1 Plugin Types

| Plugin Type | What It Does | Example |
|-------------|-------------|---------|
| **Inference Backend** | Adds a new way to run models | Groq backend, Kobold.cpp, custom fine-tune loader |
| **Voice Provider** | Adds TTS or STT engines | Fish TTS, Azure Speech, custom voice model |
| **Memory Processor** | Adds new ways to extract/store/retrieve memories | Diary formatter, relationship tracker, topic grapher |
| **Avatar Pack** | Adds 3D models + animation sets | Anime pack, sci-fi pack, fantasy creatures |
| **UI Panel** | Adds new panels to the layout | Music player, drawing canvas, mood tracker |
| **Scheduler Action** | Adds new autonomous behaviors | Daily horoscope, news briefing, workout reminder |
| **Tool** | Gives the companion new abilities | Web search, image generation, code execution |

### 7.2 Plugin Manifest

Each plugin is a folder with a manifest:

```yaml
# plugin.yaml
id: "community.mood-tracker"
name: "Mood Tracker"
version: "1.0.0"
author: "CommunityDev"
type: "ui-panel"
description: "Tracks emotional patterns over time with beautiful charts"
entry:
  frontend: "index.tsx"       # React component (optional)
  backend: "mod.rs"           # Rust module (optional)
permissions:
  - memory:read               # Can read memory store
  - memory:write              # Can write to memory store
  - chat:read                 # Can read chat history
  - scheduler:register        # Can register scheduled actions
```

### 7.3 Plugin API

Plugins interact through a sandboxed API:

```
PluginHost
  ├── register(manifest) -> PluginHandle
  ├── hooks
  │     ├── on_message_received(msg)      # Before processing
  │     ├── on_message_generated(msg)     # After AI responds
  │     ├── on_emotion_detected(emotion)  # Emotion classified
  │     ├── on_memory_extracted(memory)   # New memory stored
  │     └── on_scheduler_tick(time)       # Periodic tick
  ├── services
  │     ├── inference.generate(prompt)    # Use the active model
  │     ├── memory.search(query)          # Semantic memory search
  │     ├── memory.store(fact)            # Save a memory
  │     ├── chat.get_history(n)           # Read recent messages
  │     ├── ui.show_notification(msg)     # Show a notification
  │     └── scheduler.register(action)   # Register a timed action
  └── sandbox
        ├── No filesystem access outside plugin dir
        ├── No network access without permission
        └── Resource limits (CPU, memory)
```

### 7.4 Architecture Implication

To make plugins work, the core must be built around **traits/interfaces**, not concrete implementations:

```rust
// Every subsystem is a trait
trait InferenceBackend: Send + Sync {
    async fn generate(&self, request: GenerateRequest) -> Result<TokenStream>;
    fn capabilities(&self) -> BackendCapabilities;
}

trait MemoryStore: Send + Sync {
    async fn store(&self, memory: Memory) -> Result<MemoryId>;
    async fn search(&self, query: &str, top_k: usize) -> Result<Vec<Memory>>;
}

trait VoiceProvider: Send + Sync {
    async fn synthesize(&self, text: &str, config: VoiceConfig) -> Result<AudioStream>;
}

// The app core holds trait objects, not concrete types
struct AppCore {
    inference: Box<dyn InferenceBackend>,
    memory: Box<dyn MemoryStore>,
    voice: Box<dyn VoiceProvider>,
    plugins: PluginHost,
    scheduler: Scheduler,
}
```

This means Phase 1 code should use traits from the start, even though we only have one implementation of each. Plugins slot in later without refactoring the core.

---

## 8. Scheduler & Companion Autonomy

The scheduler gives the companion **free turns** - the ability to initiate actions without user input. This is what makes the companion feel alive rather than purely reactive.

### 8.1 How It Works

```
                    Scheduler (background loop)
                           |
              +------------+------------+
              |            |            |
         Time-based    Event-based   Condition-based
         triggers      triggers      triggers
              |            |            |
              v            v            v
         "It's 9am"   "App opened"  "3 days since
                       "User idle    last chat"
                        for 10min"
              |            |            |
              +------+-----+------+----+
                     |            |
                     v            v
              Scheduler decides    Scheduler decides
              to check-in         to journal
                     |            |
                     v            v
              Generate message    Write private
              -> send to chat     journal entry
```

### 8.2 Trigger Types

| Trigger | Description | Example Actions |
|---------|-------------|-----------------|
| **Time-based** | Cron-style schedules | Morning greeting, evening wind-down, weekly reflection |
| **Event-based** | Reacts to app/system events | Welcome back on app open, react to long idle, notice late-night usage |
| **Condition-based** | Memory Monitor flags something | "User seemed stressed last 3 conversations", "Today is an anniversary", "Relationship level just increased" |
| **Plugin-triggered** | Plugins register custom triggers | Weather changed, calendar event upcoming, news alert |

### 8.3 Companion Actions (Free Turns)

When triggered, the companion can:

| Action | Description |
|--------|-------------|
| **Check-in message** | Send a proactive message to the user ("Hey! How did that presentation go?") |
| **Journal entry** | Write a private reflection the user can read later ("I've noticed we've been talking about creativity a lot this week...") |
| **Memory processing** | Consolidate recent memories, update relationship model, find patterns |
| **Mood inference** | Analyze recent conversations to update internal understanding |
| **Notification** | Surface a gentle notification without a full message ("Nova is thinking of you") |
| **Scheduled reminder** | If the user asked to be reminded of something |

### 8.4 User Control

Users have full control over companion autonomy:

```yaml
scheduler:
  enabled: true
  quiet_hours: "23:00-08:00"      # No autonomous messages during sleep
  max_checkins_per_day: 3          # Don't be annoying
  allow_journaling: true           # Companion can write journal entries
  allow_proactive_messages: true   # Companion can message first
  triggers:
    morning_greeting: true
    absence_checkin: true          # "I missed you" after days away
    emotional_followup: true       # Check in after heavy conversations
    weekly_reflection: false       # Weekly summary journal entry
```

### 8.5 Implementation

```rust
struct Scheduler {
    triggers: Vec<Box<dyn Trigger>>,
    action_queue: mpsc::Sender<ScheduledAction>,
}

trait Trigger: Send + Sync {
    /// Check if this trigger should fire
    fn should_fire(&self, context: &SchedulerContext) -> Option<ScheduledAction>;

    /// How often to check this trigger
    fn check_interval(&self) -> Duration;
}

struct SchedulerContext {
    current_time: DateTime,
    last_user_message: Option<DateTime>,
    last_companion_message: Option<DateTime>,
    app_is_focused: bool,
    recent_emotions: Vec<EmotionRecord>,
    relationship_level: u8,
    user_preferences: SchedulerPreferences,
}
```

The scheduler runs as a background task in the Rust backend. When it decides to act, it uses the same inference pipeline as normal chat - the companion generates a message using its personality prompt + context, just as if the user had spoken first.

---

## 9. Development Phases

### Phase 0 - Foundation ✅

- [x] Design document
- [x] Initialize Tauri 2 + React + TypeScript project
- [x] Basic window with cosmic theme (dark background, glow effects)
- [x] Panel layout system (draggable, resizable)
- [x] Basic chat UI (message bubbles, input bar)

### Phase 1 - Chat Core ✅

- [x] Inference manager with **trait-based architecture** (plugin-ready from day one)
- [x] API backend (OpenAI-compatible) as first trait implementation
- [x] Streaming message display (tokens appear in real-time)
- [x] Chat history persistence (SQLite)
- [x] Multiple conversation support (per-companion threads with create/delete/rename)
- [x] Companion profile system (personality prompts, create/edit UI)
- [x] Settings panel (API keys, model selection, temperature, max tokens, context window)
- [x] Event bus foundation (for plugin hooks and scheduler triggers later)
- [x] Auto-reconnect to Ollama (5s polling when disconnected)
- [x] Auto-start Ollama on launch (if configured)
- [x] Token-aware context trimming (estimate tokens, trim oldest messages to fit window)
- [x] Auto-growing chat input field
- [x] Auto-title conversations from first message

### Phase 2 - Local Models

- [ ] llama.cpp integration in Rust backend
- [ ] Model file browser / loader (GGUF support)
- [ ] GPU layer configuration
- [ ] Ollama backend support
- [ ] Model download from HuggingFace (stretch)

### Phase 3 - Memory

- [ ] Rolling summaries (triggered every N messages, stored per conversation)
- [ ] Memory extraction pipeline (facts, preferences, relationship shifts via sidecar model)
- [ ] Memory entry types with confidence, stability, and revision support
- [ ] Vector embedding + semantic retrieval (SQLite vector extension or qdrant-embedded)
- [ ] Purpose-based context retrieval (preferences, emotional continuity, identity, callbacks)
- [ ] Anti-loop protections (retrieval cooldowns, diversity sampling, staleness penalties)
- [ ] Companion identity profile (stable behavioral traits, model-agnostic)
- [ ] Private companion journal (observation, hypothesis, self-state, intention categories)
- [ ] Session boot sequence (vector-search relevant memories on conversation start)
- [ ] Memory viewer/editor in UI (full user transparency and control)

### Phase 4 - 3D Avatar

- [ ] Three.js viewport panel with React Three Fiber
- [ ] Load and display glTF model
- [ ] Idle animations (breathing, blinking)
- [ ] Emotion analyzer (v1 - keyword based)
- [ ] Gesture animations triggered by emotion
- [ ] "Thinking" animation during generation

### Phase 5 - Voice

- [ ] Whisper.cpp STT integration
- [ ] Push-to-talk / voice activation
- [ ] TTS integration (Piper or cloud)
- [ ] Voice chat flow (speak -> transcribe -> generate -> speak)
- [ ] Streaming TTS for low latency

### Phase 6 - Autonomy & Plugins

- [ ] Scheduler system (background triggers, free turns)
- [ ] Companion journaling (private reflections)
- [ ] Proactive check-in messages
- [ ] Plugin host and manifest loader
- [ ] Plugin API (hooks, services, sandbox)
- [ ] First community plugin examples

### Phase 7 - Polish & Advanced

- [ ] MetaHuman-quality avatar (Phase 3 3D)
- [ ] Lip sync / visemes
- [ ] Facial blend shape animations
- [ ] Custom theme editor
- [ ] Export/import companion profiles

### Future - Mobile

- [ ] React Native or Flutter companion app
- [ ] Sync with desktop (shared memories, chat history)
- [ ] Simplified UI (chat + voice, no 3D or lightweight 3D)

---

## 10. File Structure (Planned)

```
HeartlineChat/
├── src-tauri/              # Rust backend (Tauri)
│   ├── src/
│   │   ├── main.rs
│   │   ├── inference/      # LLM inference manager
│   │   │   ├── mod.rs
│   │   │   ├── local.rs    # llama.cpp bindings
│   │   │   ├── ollama.rs   # Ollama client
│   │   │   └── api.rs      # OpenAI-compatible client
│   │   ├── voice/          # STT + TTS
│   │   ├── memory/         # Memory store + vector search
│   │   ├── emotion/        # Emotion analysis
│   │   ├── context/        # Prompt/context builder
│   │   └── db/             # SQLite schema + queries
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                    # React frontend
│   ├── App.tsx
│   ├── components/
│   │   ├── layout/         # Panel system, draggable windows
│   │   ├── chat/           # Chat window, message bubbles, input
│   │   ├── sidebar/        # Chats list, companion panel
│   │   ├── viewport/       # 3D avatar viewport (R3F)
│   │   ├── voice/          # Voice controls
│   │   └── settings/       # Settings panels
│   ├── stores/             # Zustand state stores
│   ├── hooks/              # Custom React hooks
│   ├── styles/             # Tailwind config, global styles
│   └── lib/                # Utilities, types, API helpers
├── assets/
│   ├── avatars/            # 3D model files (.glb, .vrm)
│   ├── animations/         # Animation clips
│   └── fonts/              # Custom fonts
├── DESIGN.md               # This document
├── package.json
└── tsconfig.json
```

---

## 11. Open Questions

- **Avatar creation pipeline:** How do users get/create their companion's 3D model? Pre-made options? Import? VRoid integration?
- **Multi-turn voice:** Should voice be push-to-talk, voice-activated, or always-on? (Probably configurable - all three as options?)
- **Encryption:** Should chat history and memories be encrypted at rest?
- **Qwen3-TTS integration:** 0.6B runs on consumer hardware natively. Need to evaluate: embed via Python subprocess, or find/build Rust bindings?
- **Marketplace infrastructure:** Self-hosted vs. platform (itch.io-style)? Payment processing? Content moderation?
- **Relationship progression tuning:** How fast should levels progress? Should it be configurable per companion?

## 12. Extra notes

### 12.1

# Instead of loading ALL tools at boot (eating precious context)

- memory tools (500 tokens)
- journal tools (500 tokens)  
- emotion tools (300 tokens)
- animation tools (400 tokens)
  Total: 1700 tokens just sitting there

# Deferred loading

- Boot: just a tool registry (100 tokens)
- Model says "search_memory" → load memory tools on demand
  Only pays the token cost when actually needed

### Resolved Questions

- ~~Multi-model conversations~~ -> **Yes.** Designed as the Multi-Model Pipeline (Section 4.4). Sidecar models handle emotion, memory, summarization.
- ~~Companion marketplace~~ -> **Yes.** Revenue sharing model with free + premium tiers (Section 6.4).

---

*Last updated: 2026-03-09*
