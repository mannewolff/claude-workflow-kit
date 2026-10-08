# `kontext.config.json` — Reference
<!-- de: 299b278fe96e -->

Configures the `/kontext` skill (session start) and the `/document` skill (session end). Both read the same file.

---

## Storage locations
<!-- de: e7cad1d39c61 -->

| Path | Purpose |
|------|-------|
| `~/.claude/kontext.config.json` | Global — applies to all projects |
| `.claude/kontext.config.json` | Project-local — overrides individual fields of the global config |

The local config is **merged field by field** with the global one, **local fields win**. Missing fields are inherited from the global one. If no config is found, `/kontext` and `/document` continue in degraded mode (initiatives (Vorhaben) via the board adapter (Board-Adapter), log into the project directory).

The merge is not a detail but the precondition for the multi-repo setup further below: There the local config sets only `parentProject` and `project` and inherits the vault path from the global one. With "first one found wins", the vault would be lost.

---

## Fields
<!-- de: 1c854d17566a -->

| Field | Type | Description |
|------|-----|--------------|
| `vault` | `string` | Absolute path to the memory vault |
| `always` | `string[]` | Files relative to the `vault` root that are always read |
| `projectDocs` | `string[]` | Files or glob patterns relative to the project directory |
| `project` | `string` | Optional override for the vault project name (only needed if repo name ≠ vault folder name) |
| `logPath` | `string` | Template for the daily log file, relative to the `vault` root. Placeholders `{date}` and `{project}`. Default: `"Log/{date}.md"` |
| `parentProject` | `string` | Umbrella project above several service repos. Set only in the multi-repo setup, see below |

---

## Glob patterns in `projectDocs`
<!-- de: fe3b93abd37a -->

`projectDocs` supports glob patterns. The skill expands them with `find` in the project directory:

```bash
find . -maxdepth 1 -name "CLAUDE-*" -type f
find .claude -maxdepth 1 -name "CLAUDE-*" -type f
```

Patterns without matches are skipped silently.

---

## Checking paths without starting a skill
<!-- de: 035dc68d55a3 -->

The target paths are computed by the board adapter, not by the skill prompt:

```bash
node .claude/kit/board.mjs kontext paths
```

```json
{
  "mode": "full",
  "vault": "/Users/mustermann/Nextcloud/ClaudeMemory",
  "project": "auth-service",
  "parentProject": "ShopSystem",
  "log": "/Users/mustermann/Nextcloud/ClaudeMemory/Log/2026-08-06-auth-service.md",
  "projectNote": "/Users/mustermann/Nextcloud/ClaudeMemory/Projekte/ShopSystem/auth-service.md",
  "parentNote": "/Users/mustermann/Nextcloud/ClaudeMemory/Projekte/ShopSystem/ShopSystem.md",
  "always": ["/Users/mustermann/Nextcloud/ClaudeMemory/Index.md"],
  "projectDocs": ["CLAUDE-*", ".claude/CLAUDE-*"]
}
```

This is the fastest way to check a new config: If the paths are right here, they are right in the skill too. `--project` and `--date` override the project name and the date of the day.

The project name is determined in the order `--project` → `project` from the config → repo name → directory name. If the repo name differs from the vault folder name (e.g. repo `ebdc-react`, vault note `Projekte/EBDC/EBDC.md`), set the `project` field in the local config.

Without `vault`, the command returns `"mode": "degraded"` and all vault paths as `null` — not an error, but the documented mode without persistent memory.

In addition:

```bash
node .claude/kit/board.mjs kontext last-log
```

It returns the most recent existing log entry **of the same project** (`{"path": …, "date": …}`) or `{"path": null}` if there is none. `/document` uses it to pick up from the previous entry instead of starting from scratch. Today's entry is excluded so that a second session on the same day does not read itself.

---

## Multi-repo projects (microservices)
<!-- de: c60b6477f3a0 -->

Several repos, one system: They are meant to share one vault so that the knowledge across the service boundaries lives in one place. Without further configuration, however, all sessions of a day then write into the same log file — in a synchronised vault that produces conflict copies, with parallel sessions an overwritten section.

> **`logPath` is not only for those running microservices.** The default `Log/{date}.md` is one file per **day**, not per project — even two completely independent repos on one vault write into each other with it, and at the next `/document`, `kontext last-log` may return the entry of an unrelated project as the predecessor. For this case `logPath` **alone** is enough, set globally; `parentProject` and `project` belong only to the multi-repo setup below.
>
> ```json
> { "logPath": "Log/{date}-{project}.md" }
> ```
>
> Worth knowing when switching: Entries already written keep their old file name and are no longer found by `kontext last-log` as the predecessor — once, until the first entry in the new scheme exists.

The solution is two fields in the **local** config of each service repo:

```json
{
  "parentProject": "ShopSystem",
  "project": "auth-service",
  "logPath": "Log/{date}-{project}.md"
}
```

`vault`, `always` and `projectDocs` stay in the **global** config. Repeating them here is the obvious mistake — the merge takes care of it.

This results in the following vault structure:

```
ClaudeMemory/
├── Index.md                      ← shared
├── Profil.md                     ← shared
├── Wissen/                       ← shared
├── Log/
│   ├── 2026-08-06-auth-service.md
│   ├── 2026-08-06-payment-service.md
│   └── 2026-08-06-order-service.md
└── Projekte/
    └── ShopSystem/
        ├── ShopSystem.md         ← umbrella: architecture, contracts between services
        ├── auth-service.md
        ├── payment-service.md
        └── order-service.md
```

In the multi-repo case `/kontext` loads **both** notes: first the umbrella note as the frame, then the note of the service you are currently working in.

### Why the service identifier belongs in the file name
<!-- de: 55100301b1fb -->

`Log/{date}-{project}.md` is the recommended form, not `Projekte/{project}/Log/{date}.md`. The reason is the reading direction: With the identifier in the file name, all entries of a day lie side by side, and the chronological view across the whole system is preserved. A subfolder per service breaks it into five separate timelines. Both forms work — the template can do either.

### One file, one writer
<!-- de: 987ccf2f2d96 -->

The umbrella note is the only place where several repos meet, and that is why `/document` **never** writes it automatically. Only if a session had a cross-service effect (shared data model, changed API contract, shared infrastructure) does the skill ask once — with the concrete entry text — and writes only after consent.

Without this rule, the conflict surface would merely have moved from the log into the note.

---

## Installer
<!-- de: f0c0c20130e5 -->

The installer (`install.mjs`) creates the global config automatically if a vault path is given during installation:

```
Pfad zum Memory-Vault für /kontext (leer = überspringen): /Users/mustermann/Nextcloud/ClaudeMemory
```

The prompt asks for the path to the memory vault for `/kontext`; leaving it empty skips the step.

Result in `~/.claude/kontext.config.json`:

```json
{
  "vault": "/Users/mustermann/Nextcloud/ClaudeMemory",
  "always": ["Index.md", "Profil.md"],
  "projectDocs": ["CLAUDE-*", ".claude/CLAUDE-*"]
}
```

The local `.claude/kontext.config.json` has to be created manually (only if needed).

---

## Examples
<!-- de: 45383aaefa2b -->

**Global config** (create once, applies everywhere):

```json
{
  "vault": "/Users/manfredwolff/Nextcloud/ClaudeMemory",
  "always": ["Index.md", "Profil.md"],
  "projectDocs": ["CLAUDE-*", ".claude/CLAUDE-*"]
}
```

**Local config** (only if repo name ≠ vault project name):

```json
{
  "project": "EBDC"
}
```

**Local config** (one service of several, see multi-repo above):

```json
{
  "parentProject": "ShopSystem",
  "project": "auth-service",
  "logPath": "Log/{date}-{project}.md"
}
```

**Local config** (completely standalone, without a global config):

```json
{
  "vault": "/Users/mustermann/Nextcloud/ClaudeMemory",
  "always": ["Index.md", "Profil.md"],
  "projectDocs": ["CLAUDE-*", ".claude/CLAUDE-*"],
  "project": "MeinProjekt"
}
```
