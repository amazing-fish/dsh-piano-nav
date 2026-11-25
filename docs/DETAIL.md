# DSH Piano Navigator

A semantic conversation rail for the DeepSeek Harness Web GUI. It renders a continuous pointer-following piano track beside the transcript so you can preview and jump across long agent sessions without losing context.

## What each key represents

| Key | Meaning |
| --- | --- |
| User input | Authored user messages and steering prompts |
| AI process output | Intermediate assistant text; consecutive same-turn outputs fold into one compact key |
| Final result | The concluding assistant response of a turn |
| AI question / user answer | Structured `ask_user_question` exchanges and their status |
| Unloaded history | Real turn outline entries whose loading and landing delegate to DSH native navigation |

## Controls

- **Move along the rail:** continuous wave expansion with plain-text preview for the nearest key.
- **Click / `Enter` / `Space`:** jump to the target or delegate loading of an unloaded turn to DSH.
- **Click a folded process group:** expand the group and jump to its first member; rail wheel scrolling preserves expansion while clicking another key kind or pressing `Escape` folds it back.
- **Keyboard:** `↑` / `↓`, `PageUp` / `PageDown`, `Home` / `End`, `Enter` / `Space`, and `Escape`.

## Settings and safety boundaries

Configure language (简体中文 / English / 繁體中文), key thickness, spacing, visible window capacity, and custom semantic colors from **Piano Navigator** in Settings or this plugin's configuration page.

Piano only reads navigation state, renders plain-text previews, and persists its own preferences. It never rewrites messages, injects system prompts, or submits answers, and automatically restores DSH's native turn navigator whenever space is narrow or host layout contracts change.
