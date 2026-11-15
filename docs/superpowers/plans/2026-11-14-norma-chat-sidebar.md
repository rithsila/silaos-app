# Norma AI Chat (Full Sidebar Page) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-page AI Chat module to the Life OS sidebar powered by `rithsila/Norma` that knows all 13 Life OS modules, persists chat threads/memory, streams replies, and requires user approval before creating, editing, or deleting data.

**Architecture:** Modular Monolith + 1 Go AI Sidecar. Keep the Rust backend (`backend/`, `:8080`) as the single owner of SQLite (`prisma/dev.db`), and add one Go sidecar service (`agent/`, `:8081`) built on the Norma SDK (`agentcore.Session`). Next.js (`:3000`) proxies `/api/chat/*` to `:8081` via `next.config.ts` `rewrites()`, and the Go sidecar reads/writes Life OS data over HTTP to `:8080` using Norma `CoreTool`s.

**Tech Stack:** Go 1.23+ (Norma SDK `agentcore`, `llm`, `harness`, `tool`, `permission`, `memory`, `transcript`, `compaction`), Next.js 16, React 19, TypeScript, Tailwind CSS, Zustand, Vitest.

---

## Architecture Decision: Modular Monolith + 1 AI Sidecar (Why not Pure Monolith or Full Microservices)

1. **Why not Pure Monolith (1 process)?** Life OS is Next.js + Rust, while Norma is a Go library. Embedding Go into Rust adds fragile FFI; rewriting Norma in Rust/TS duplicates streaming, compaction, memory, and permission loops.
2. **Why not Full Microservices?** Splitting Tasks, Habits, Notes, Projects, Monitoring, and RAG into separate services with separate databases adds network hops, Docker sprawl, and SQLite locking pain for a local-first personal app.
3. **Why Modular Monolith + 1 Go Sidecar wins:**
   - Rust (`backend/`) remains the modular monolith owning SQLite (`prisma/dev.db`) and all CRUD/business rules.
   - `agent/` (Go + Norma) is the **only** extra service (`:8081`), handling LLM streaming, tool orchestration, memory, and future AI tool packs (GitHub, RAG doc search, Monitoring queries, Roadmap generation) via HTTP calls to Rust or external APIs.
   - All 3 processes run together via `bun run dev:all` in dev and inside one container in `Dockerfile` / `docker-entrypoint.sh`.

## Global Constraints

- Do NOT add `src/app/<module>/page.tsx` or `src/app/api/**` (`AGENTS.md`: UI switches via `activeModule`, API proxies via `next.config.ts` `rewrites()`).
- Never expose `/api/data/reset` to any chat tool.
- All mutating tools (`POST`, `PATCH`, `PUT`, `DELETE`) MUST require explicit user approval (`permission.AskUser` -> UI approval card), never `permission.ModeBypass`.
- Every new key in `src/lib/i18n/translations/en.ts` MUST be added to `tr.ts`, `es.ts`, `de.ts`, `fr.ts`.
- Respect `API_KEY` env var if set: Go sidecar enforces `Authorization: Bearer <API_KEY>` on `/api/chat/*` and passes the same header when calling Rust `:8080`.
- Note on Norma Go module path: `rithsila/Norma`'s `go.mod` currently declares `module github.com/Autumn-27/norma`. Either fetch via `replace github.com/Autumn-27/norma => ...` (submodule/local checkout or tagged fork) or update `go.mod` in `rithsila/Norma` to `github.com/rithsila/Norma`. Pin the exact resolution in `agent/go.mod` in Task 1.

## Review Focus

1. **Persisted `enabledModules` in existing browsers:** `useAppStore` persists `enabledModules` in `localStorage` without `'chat'`. `sidebar.tsx` must always allow `'chat'` (same rule as `'dashboard'`) so existing users see Chat without clearing storage.
2. **Next.js rewrite SSE buffering:** Verify live `text/event-stream` deltas stream incrementally through `next.config.ts` rewrites (set `Cache-Control: no-cache`, `X-Accel-Buffering: no`, and `Flush()` after every SSE event in Go).
3. **Mutating tool approval timeout / disconnect:** If the user closes the page or rejects a pending `CanUseTool` request, `CanUseTool` must unblock via `ctx.Done()` or explicit denial instead of leaking a goroutine or hanging the session.
4. **Concurrent messages on the same `agentcore.Session`:** Norma's `Session` is not safe for concurrent `Prompt` calls (`agentcore/agentcore.go`). Serialize `Prompt` per session with a mutex and return `409 Conflict` if a turn is already running.
5. **Missing LLM API key on startup:** If `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` is unset, `agent/` must still boot, pass `/health`, and return a clear `400`/`503` JSON error `{ "error": "..." }` on chat send rather than crashing `dev:all` or Docker.

---

### File Map

| Path | Responsibility |
|---|---|
| `agent/go.mod`, `agent/cmd/lifeos-agent/main.go` | Go HTTP/SSE server entrypoint (`:8081`), config, `/health`, graceful shutdown |
| `agent/internal/config/config.go` | Env config (`PORT`, `LIFEOS_BACKEND_URL`, `AGENT_DATA_DIR`, `API_KEY`, LLM provider/model/baseURL/key) |
| `agent/internal/lifeostools/client.go` | Typed HTTP client to Rust backend (`:8080`) with `Bearer` auth |
| `agent/internal/lifeostools/tools.go` | Norma `CoreTool` definitions for all 13 Life OS modules + `Snapshot()` for `SystemReminderFunc` |
| `agent/internal/chat/manager.go` | Session lifecycle, per-session mutex, Norma `transcript.Store` + `memory.Store`, pending `CanUseTool` approvals |
| `agent/internal/httpapi/router.go` | `/health` and `/api/chat/*` REST + SSE handlers, Bearer auth middleware |
| `next.config.ts` | Add `/api/chat` proxy rewrite -> `AGENT_URL || "http://localhost:8081"` |
| `scripts/dev-all.mjs`, `package.json` | Start Go agent alongside Rust + Next.js; add `agent:dev` / `agent:build` scripts |
| `Dockerfile`, `docker-entrypoint.sh`, `.github/workflows/ci.yml` | Build Go binary in Docker, start it in entrypoint, run `go test ./...` in CI |
| `src/stores/app-store.ts`, `src/stores/chat-store.ts` | Add `'chat'` to `ModuleId`; manage active session ID + draft UI state |
| `src/lib/api/chat.ts` | Fetch/SSE client + TypeScript types for chat sessions, messages, tool events, approvals |
| `src/lib/i18n/translations/{en,tr,es,de,fr}.ts` | `nav.chat` and `chat.*` translation keys |
| `src/components/lifeos/chat/*` | Full sidebar Chat page (`chat-page.tsx`, `chat-thread-list.tsx`, `chat-message-list.tsx`, `tool-approval-card.tsx`) |
| `src/components/lifeos/app-shell.tsx`, `sidebar.tsx`, `command-palette.tsx` | Register `'chat'` module in AppShell, Sidebar, and Command Palette |

---

### Task 1: Scaffold Go Sidecar (`agent/`) & Config

**Files:**
- Create: `agent/go.mod`
- Create: `agent/internal/config/config.go`
- Create: `agent/internal/config/config_test.go`
- Create: `agent/cmd/lifeos-agent/main.go`

**Interfaces:**
- Produces: `config.Load() config.Config` returning `{ Port, BackendURL, DataDir, APIKey, Provider, Model, BaseURL, LLMAPIKey }`

- [ ] **Step 1: Resolve Norma Go dependency in `agent/go.mod`**
  Initialize `agent/go.mod` (`module lifeos-agent`, `go 1.23+`). Add Norma (`github.com/Autumn-27/norma` via `replace` to the checked-out/forked `rithsila/Norma` or vendored submodule, or update Norma's `go.mod` module path to `github.com/rithsila/Norma` and `go get github.com/rithsila/Norma@main`). Verify `go list github.com/Autumn-27/norma/agentcore` succeeds.

- [ ] **Step 2: Write failing config test**
  In `agent/internal/config/config_test.go`, write `TestLoadDefaults` and `TestLoadOverrides`:
  - Assert default `Port == "8081"`, `BackendURL == "http://localhost:8080"`, `DataDir == ".lifeos-agent"`, `Provider == "openai"`.
  - Set `AGENT_PORT=9090`, `BACKEND_URL=http://127.0.0.1:8080`, `AGENT_PROVIDER=anthropic`, `ANTHROPIC_API_KEY=sk-test`, and assert `Load()` populates them.

- [ ] **Step 3: Run test to verify it fails**
  Run: `cd agent && go test ./internal/config/...`
  Expected: FAIL (package/symbol undefined).

- [ ] **Step 4: Implement `agent/internal/config/config.go` and minimal `agent/cmd/lifeos-agent/main.go`**
  Implement `Load() Config` reading `AGENT_PORT` (default `8081`), `BACKEND_URL` (default `http://localhost:8080`), `AGENT_DATA_DIR` (default `.lifeos-agent`), `API_KEY`, `AGENT_PROVIDER` (`openai` | `anthropic` | `openai-responses`), `AGENT_MODEL`, `AGENT_BASE_URL`, and `LLMAPIKey` (`AGENT_API_KEY` -> `ANTHROPIC_API_KEY` -> `OPENAI_API_KEY`). Implement `main.go` starting an `http.Server` on `:Port` with `/health` returning `{"status":"ok","llmConfigured":bool}`.

- [ ] **Step 5: Run tests & commit**
  Run: `cd agent && go test ./...`
  Expected: PASS.
  Commit: `feat(agent): scaffold Go Norma sidecar and config`

---

### Task 2: Life OS HTTP Client & Norma Tools (`agent/internal/lifeostools`)

**Files:**
- Create: `agent/internal/lifeostools/client.go`
- Create: `agent/internal/lifeostools/tools.go`
- Create: `agent/internal/lifeostools/tools_test.go`

**Interfaces:**
- Consumes: Rust backend HTTP API (`:8080`)
- Produces:
  - `NewClient(baseURL, apiKey string) *Client`
  - `AllTools(c *Client) (primary []tool.CoreTool, deferredNames []string)`
  - `BuildSnapshot(ctx context.Context, c *Client) string` (for Norma `SystemReminderFunc`)

- [ ] **Step 1: Write failing tests for Life OS tools**
  In `agent/internal/lifeostools/tools_test.go`, use `httptest.NewServer`:
  - `TestReadToolParallelSafe`: verify `lifeos_tasks_list` and `lifeos_search` return `IsReadOnly(nil) == true` and `IsConcurrencySafe(nil) == true`, and forward `Authorization: Bearer <key>` + query params.
  - `TestMutatingToolRequiresApproval`: verify `lifeos_tasks_create` and `lifeos_tasks_delete` return `IsReadOnly(nil) == false` and trigger `permission.AskUser` in `CheckPermissions`.
  - `TestResetEndpointNotExposed`: assert no registered tool name or path targets `/api/data/reset`.
  - `TestBuildSnapshotCompact`: serve mocked `/api/dashboard` and `/api/profile` JSON and assert `BuildSnapshot` returns a compact summary under 1500 chars (and returns `""` cleanly if backend is unreachable).

- [ ] **Step 2: Run test to verify it fails**
  Run: `cd agent && go test ./internal/lifeostools/...`
  Expected: FAIL.

- [ ] **Step 3: Implement `client.go` and `tools.go`**
  - `client.go`: `Do(ctx, method, path, query, body)` with 10s timeout, optional `Bearer` header, and clean error formatting.
  - `tools.go`: Register tools covering every module in `mcp/lifeos-server.ts` (tasks, projects, notes, note_folders, calendar, time/pomodoro, habits/habit_logs, journal, goals, learning/courses, finance, profile/tags/stats, dashboard/analytics/weekly_review/activity, search).
  - Mark **primary** tools (e.g., `lifeos_search`, `lifeos_tasks_list`, `lifeos_tasks_create`, `lifeos_tasks_update`, `lifeos_events_list`, `lifeos_notes_list`, `lifeos_dashboard_get`) as always loaded, and place domain-heavy tools (finance budgets/categories, courses, profile export, delete ops) into `deferredNames` so Norma loads schemas on demand via `SearchExtraTools` / `ExecuteExtraTool`.
  - Mark every `GET` tool `ReadOnly: true, Concurrent: true, Permissions: Allowed()` and every `POST`/`PATCH`/`PUT`/`DELETE` tool `ReadOnly: false, Concurrent: false, Permissions: AskUser(...)`.

- [ ] **Step 4: Run tests & commit**
  Run: `cd agent && go test ./internal/lifeostools/...`
  Expected: PASS.
  Commit: `feat(agent): add Norma tools for all Life OS modules and context snapshot`

---

### Task 3: Chat Session Manager, Transcripts, Memory & Approvals (`agent/internal/chat`)

**Files:**
- Create: `agent/internal/chat/manager.go`
- Create: `agent/internal/chat/manager_test.go`

**Interfaces:**
- Consumes: `config.Config`, `lifeostools.Client`, `agentcore`, `transcript.Store`, `memory.Store`
- Produces:
  - `Manager` with:
    - `ListSessions(ctx) ([]SessionSummary, error)`
    - `CreateSession(ctx, title string) (SessionSummary, error)`
    - `GetSession(ctx, id string) (*SessionDetail, error)`
    - `DeleteSession(ctx, id string) error`
    - `SendMessage(ctx, id, text string, emit func(StreamEvent)) error`
    - `ResolveApproval(sessionID, toolUseID string, allow bool) error`
    - `ListMemories() ([]memory.Memory, error)`

- [ ] **Step 1: Write failing tests with a scripted `llm.Provider`**
  In `agent/internal/chat/manager_test.go`:
  - `TestSendMessageStreamsAndPersists`: mock `llm.Provider` emitting text delta -> `SendMessage` emits `text` + `done`; creating a new `Manager` over the same `DataDir` still lists and loads the resumed history via `transcript.Store`.
  - `TestConcurrentPromptRejected`: start a slow prompt on session `s1`; call `SendMessage` again on `s1` -> returns `ErrSessionBusy`.
  - `TestToolApprovalBlocksUntilResolved`: mock provider calls a mutating tool -> `emit` receives `approval_required` with `toolUseId`; calling `ResolveApproval(s1, toolUseID, true)` lets the tool execute; calling `ResolveApproval(..., false)` returns a denied tool result to the model.
  - `TestMissingProviderReturnsClearError`: `LLMAPIKey == ""` -> `SendMessage` returns `ErrLLMNotConfigured`.

- [ ] **Step 2: Run test to verify it fails**
  Run: `cd agent && go test ./internal/chat/...`
  Expected: FAIL.

- [ ] **Step 3: Implement `agent/internal/chat/manager.go`**
  - Store session index metadata (`<DataDir>/sessions.json`) + Norma transcripts (`<DataDir>/transcripts/<id>.jsonl`) + Norma memories (`<DataDir>/memory`).
  - Configure `agentcore.Options` with:
    - Host `SystemPrompt` tailored to Life OS (explain available modules, tell model to check live data with read tools instead of guessing, respect user confirmation for writes).
    - `SystemReminderFunc` calling `lifeostools.BuildSnapshot`.
    - `Tools` + `DeferredTools` from `lifeostools.AllTools`.
    - `Memory: &agentcore.MemoryOptions{ Store, AutoInject: true, IncludeIndexInPrompt: true }`.
    - `Compaction: &compaction.Config{...}` so long conversations never overflow context.
    - `PermissionMode: permission.ModeDefault` and `CanUseTool` wired to a per-session pending approval map (`chan permission.Decision`, cancelled on `ctx.Done()`).
    - `DisableBackgroundTasks: true` (keep chat focused in v1).

- [ ] **Step 4: Run tests & commit**
  Run: `cd agent && go test ./internal/chat/...`
  Expected: PASS.
  Commit: `feat(agent): implement Norma session manager, transcripts, memory, and tool approvals`

---

### Task 4: HTTP + SSE API Router (`agent/internal/httpapi`)

**Files:**
- Create: `agent/internal/httpapi/router.go`
- Create: `agent/internal/httpapi/router_test.go`
- Modify: `agent/cmd/lifeos-agent/main.go` (wire `chat.Manager` + `httpapi.NewRouter`)

**Interfaces:**
- Consumes: `chat.Manager`, `config.Config`
- Produces HTTP endpoints:
  - `GET /health`
  - `GET /api/chat/sessions`, `POST /api/chat/sessions`
  - `GET /api/chat/sessions/{id}`, `DELETE /api/chat/sessions/{id}`
  - `POST /api/chat/sessions/{id}/message` (SSE `text/event-stream`)
  - `POST /api/chat/sessions/{id}/approve` (`{ "toolUseId": string, "allow": bool }`)
  - `GET /api/chat/memory`

- [ ] **Step 1: Write failing HTTP + SSE tests**
  In `agent/internal/httpapi/router_test.go`:
  - `TestAuthMiddleware`: when `APIKey` is set, `/api/chat/sessions` without `Bearer` returns `401`, `/health` stays `200`.
  - `TestSessionCRUD`: `POST /api/chat/sessions` -> `GET /api/chat/sessions` -> `DELETE /api/chat/sessions/{id}`.
  - `TestSSEStreamFormat`: `POST /api/chat/sessions/{id}/message` sets `Content-Type: text/event-stream`, `X-Accel-Buffering: no`, and streams valid `event: ...\ndata: {...}\n\n` frames ending with `done`.
  - `TestErrorShapeMatchesRust`: error responses return `{"error":"..."}` (same shape `src/lib/api/client.ts` `buildError` expects).

- [ ] **Step 2: Run test to verify it fails**
  Run: `cd agent && go test ./internal/httpapi/...`
  Expected: FAIL.

- [ ] **Step 3: Implement `router.go` and update `main.go`**
  Use Go 1.22+ `http.ServeMux` (`GET /api/chat/sessions/{id}`), `http.Flusher` for SSE streaming, and Bearer auth middleware matching `backend/src/lib.rs`.

- [ ] **Step 4: Run tests & commit**
  Run: `cd agent && go test ./...`
  Expected: PASS.
  Commit: `feat(agent): add HTTP and SSE API endpoints for Life OS chat`

---

### Task 5: Next.js Proxy, Dev Launcher, Docker & CI Wiring

**Files:**
- Modify: `next.config.ts:49-80`
- Modify: `scripts/dev-all.mjs:18-58`
- Modify: `package.json:24-54`
- Modify: `Dockerfile:1-75`
- Modify: `docker-entrypoint.sh:1-42`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces:
  - Browser `/api/chat` and `/api/chat/:path*` proxied to `AGENT_URL || "http://localhost:8081"`
  - `bun run agent:dev` / `bun run agent:build`
  - `bun run dev:all` starts Next + Rust + Go agent

- [ ] **Step 1: Update `next.config.ts` and `package.json`**
  Add `...proxyAgent("/api/chat")` targeting `process.env.AGENT_URL || "http://localhost:8081"` in `next.config.ts`. Add `"agent:dev": "cd agent && go run ./cmd/lifeos-agent"` and `"agent:build": "cd agent && go build -o ../dist/lifeos-agent ./cmd/lifeos-agent"` in `package.json`.

- [ ] **Step 2: Update `scripts/dev-all.mjs`**
  Spawn `go run ./cmd/lifeos-agent` in `cwd: 'agent'` with `[agent]` log prefix alongside `[back]` and `[front]`. Stop all 3 cleanly on exit/SIGINT.

- [ ] **Step 3: Update `Dockerfile`, `docker-entrypoint.sh`, and `.github/workflows/ci.yml`**
  - Add a `golang:1.23-bookworm` builder stage in `Dockerfile` compiling `/usr/local/bin/lifeos-agent`.
  - Start `/usr/local/bin/lifeos-agent` in `docker-entrypoint.sh` before `exec node server.js` and wait on `http://localhost:8081/health`.
  - Add an `agent` CI job in `.github/workflows/ci.yml` running `go vet ./...` and `go test ./...` in `agent/`.

- [ ] **Step 4: Verify config & build**
  Run: `bun run typecheck && cd agent && go test ./...`
  Expected: PASS.
  Commit: `chore(infra): proxy /api/chat and wire Go agent into dev, Docker, and CI`

---

### Task 6: Frontend State, SSE API Client & i18n

**Files:**
- Modify: `src/stores/app-store.ts:4-17,147`
- Create: `src/stores/chat-store.ts`
- Create: `src/lib/api/chat.ts`
- Modify: `src/lib/i18n/translations/{en,tr,es,de,fr}.ts`
- Create: `src/__tests__/api/chat-stream.test.ts`

**Interfaces:**
- Produces:
  - `ModuleId` includes `'chat'`
  - `useChatStore` (`activeSessionId`, `setActiveSessionId`)
  - `fetchChatSessions()`, `createChatSession()`, `fetchChatSession(id)`, `deleteChatSession(id)`, `streamChatMessage(id, text, onEvent, signal)`, `approveToolCall(id, toolUseId, allow)`

- [ ] **Step 1: Write failing SSE parser / client tests**
  In `src/__tests__/api/chat-stream.test.ts`, mock `fetch` returning a `ReadableStream` of SSE chunks (`event: text`, `event: tool_use`, `event: approval_required`, `event: done`), including a chunk split mid-line, and assert `streamChatMessage` dispatches every parsed event cleanly.

- [ ] **Step 2: Run test to verify it fails**
  Run: `bunx vitest run src/__tests__/api/chat-stream.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/api/chat.ts`, `src/stores/chat-store.ts`, `app-store.ts`, and translations**
  - Add `'chat'` to `ModuleId` and `enabledModules` default in `src/stores/app-store.ts`.
  - Implement typed SSE reader in `src/lib/api/chat.ts` handling partial chunks and error frames.
  - Add `nav.chat` and `chat.*` keys (new chat, empty state, send, stop, thinking, tool call, approve, deny, delete thread, missing API key hint) in `en.ts`, `tr.ts`, `es.ts`, `de.ts`, `fr.ts`.

- [ ] **Step 4: Run tests & typecheck, then commit**
  Run: `bunx vitest run src/__tests__/api/chat-stream.test.ts && bun run typecheck`
  Expected: PASS.
  Commit: `feat(chat): add frontend chat API client, store, and translations`

---

### Task 7: Full Sidebar Chat Page & Navigation Integration

**Files:**
- Create: `src/components/lifeos/chat/chat-page.tsx`
- Create: `src/components/lifeos/chat/chat-thread-list.tsx`
- Create: `src/components/lifeos/chat/chat-message-list.tsx`
- Create: `src/components/lifeos/chat/tool-approval-card.tsx`
- Modify: `src/components/lifeos/app-shell.tsx:28-41`
- Modify: `src/components/lifeos/sidebar.tsx:33-76`
- Modify: `src/components/lifeos/command-palette.tsx` (add "Go to Chat" command)
- Create: `src/__tests__/components/chat-page.test.tsx`

**Interfaces:**
- Consumes: `src/lib/api/chat.ts`, `useChatStore`, `useAppStore`
- Produces: `<ChatPage />` registered under `moduleComponents['chat']` in `app-shell.tsx`

- [ ] **Step 1: Write failing UI tests**
  In `src/__tests__/components/chat-page.test.tsx` using `renderWithProviders` and MSW:
  - Renders thread list + message composer + quick Life OS starter prompts ("Summarize today's tasks and schedule", "Review my habit streaks", "Check this week's spending").
  - Sending a message streams assistant reply and refreshes thread list.
  - Receiving an `approval_required` SSE event renders `ToolApprovalCard` with tool name/input + **Approve** and **Deny** buttons; clicking **Approve** calls `POST /api/chat/sessions/:id/approve` with `{ toolUseId, allow: true }` and invalidates relevant TanStack Query caches (`tasks`, `events`, `habits`, `notes`, `projects`, `goals`, `finance`, `dashboard`).

- [ ] **Step 2: Run test to verify it fails**
  Run: `bunx vitest run src/__tests__/components/chat-page.test.tsx`
  Expected: FAIL.

- [ ] **Step 3: Implement Chat UI and wire Sidebar + AppShell**
  - In `sidebar.tsx`, add `{ id: 'chat' as ModuleId, label: t('nav.chat'), icon: MessageSquare }` under Overview (right below Dashboard) and ensure `'chat'` is always shown even for existing persisted `enabledModules` (`item.id === 'dashboard' || item.id === 'chat'`).
  - In `app-shell.tsx`, register `chat: ChatPage` in `moduleComponents`.
  - Build `ChatPage` using existing shadcn/ui primitives (`Button`, `ScrollArea`, `Textarea`, `Badge`, `Card`) with collapsible thread list on desktop/mobile, collapsible tool-call & thinking traces, inline `ToolApprovalCard`, and Stop button (`AbortController`).

- [ ] **Step 4: Run tests, lint, typecheck & commit**
  Run: `bunx vitest run src/__tests__/components/chat-page.test.tsx && bun run typecheck && bun run lint`
  Expected: PASS.
  Commit: `feat(ui): add full sidebar Chat page with streaming and tool approvals`

---

### Task 8: End-to-End Verification & Smoke Test

**Files:**
- Create: `e2e/chat.spec.ts`
- Modify: `AGENTS.md` (document `:8081` Go sidecar, `AGENT_URL`, and `LLM_API_KEY` env vars)

- [ ] **Step 1: Add Playwright E2E test `e2e/chat.spec.ts`**
  Verify clicking **Chat** in the sidebar opens the Chat page, shows empty-state prompt chips, and handles session creation cleanly against the running Go sidecar.

- [ ] **Step 2: Run full CI checks**
  Run:
  ```bash
  bun run db:generate && bun run typecheck && bun run lint && bun run test && bun run build
  cd backend && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test -- --test-threads=1
  cd ../agent && go vet ./... && go test ./...
  ```
  Expected: All PASS.

- [ ] **Step 3: Commit**
  `git add e2e/chat.spec.ts AGENTS.md && git commit -m "test(e2e): add chat sidebar e2e test and update agent docs"`
