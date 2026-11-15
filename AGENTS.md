# Life OS — agent notes

Local-first SPA. Package manager is **Bun** (`bun.lock`). Runtime API is **Rust (axum + sqlx)**, not Next.js route handlers. Prisma is schema + migrations + seed only (`prisma/seed.ts` is the only `@prisma/client` user).

```
Browser :3000 → Next rewrites /api/chat/* → Go Norma Agent :8081 → Rust :8080
             → Next rewrites /api/*      → Rust :8080 → SQLite (prisma/dev.db)
```

UI is a single Next page (`src/app/page.tsx` → `AppShell`). Module switches are Zustand `activeModule`, not App Router paths. Do not add `src/app/<module>/page.tsx` or `src/app/api/**`.

Trust `package.json`, `next.config.ts`, `backend/src/lib.rs`, and `.github/workflows/ci.yml` over `docs/README.md`, `SEED_DATA_README.md`, and `DATABASE_FIX_SUMMARY.md` (those still describe Next API routes / `npm` / wrong ports).

## Commands

Need Bun + Rust stable. Copy `.env.example` → `.env` so Prisma sees `DATABASE_URL`.

```bash
bun install
bun run db:push          # creates prisma/dev.db — required before the backend will start
bun run db:generate      # after schema changes; CI always runs this
bun run db:seed          # bun prisma/seed.ts (wipes then inserts demo rows)
bun run dev:all          # cargo run (backend/) + next dev together
```

`db.rs` opens SQLite with `create_if_missing(false)`. Missing `prisma/dev.db` → backend panic. `file:` and `sqlite:` URLs both work (Rust rewrites `file:`).

Do not use `bun test` (Bun’s runner). Use Vitest via npm scripts.

| What | Command |
|------|---------|
| Frontend unit | `bun run test` |
| One Vitest file | `bunx vitest run src/__tests__/stores/task-store.test.ts` |
| Typecheck | `bun run typecheck` |
| Lint | `bun run lint` |
| Backend | `cd backend && cargo test -- --test-threads=1` |
| One Rust integration test | `cd backend && cargo test --test tasks_test -- --test-threads=1` |
| Clippy (CI denies warnings) | `cd backend && cargo clippy --all-targets --all-features -- -D warnings` |
| rustfmt | `cd backend && cargo fmt --check` |
| E2E | `bun run test:e2e` (Playwright starts backend + Next; first Rust compile can take ~90s) |
| Both processes | `bun run backend:dev` and `bun run dev`, or `bun run dev:all` |

CI frontend order: `db:generate` → `typecheck` → `lint` → `test` → `build`.  
CI backend: `db:push` then `fmt` → `clippy -D warnings` → `cargo test --test-threads=1`.

`bun run db:reset` and `bun run docker:reset` destroy data.

## New API surface (all of these, or the browser never hits Rust)

1. `prisma/schema.prisma` then `bun run db:push` (and a migration if you intend to ship Docker/`migrate deploy`).
2. Mirror the SQL in `backend/tests/schema.sql` — Rust tests apply that file, not Prisma.
3. Handler in `backend/src/<module>.rs`, register in `backend/src/lib.rs`. Axum 0.8 paths use `{id}`, not `:id`.
4. Prefix in `next.config.ts` `rewrites()` — **allowlist**. Unlisted `/api/...` is not proxied (there are no Next handlers to fall back to). Keep the browser path identical to the Rust route.
5. Hook in `src/lib/api/hooks.ts` (`apiGet` / `apiPost` / … in `src/lib/api/client.ts`). Errors are `{ "error": "<message>" }` (`backend/src/error.rs`).
6. UI under `src/components/lifeos/<module>/`. New top-level modules also need `ModuleId` + `moduleComponents` in `app-shell.tsx`.

Health check is `GET http://localhost:8080/health` (not `/api/health`). Docker and Playwright use that URL.

## Data / SQL quirks

- Table and column names are Prisma’s quoted camelCase (`Task`, `createdAt`, …).
- `DateTime` in SQLite is **integer milliseconds**. Serialize with `PrismaDateTime` (`backend/src/prisma_dt.rs`) to ISO `...Z` for the frontend.
- IDs are CUID (`cuid` crate).
- Enable SQLite foreign keys (already on in `db.rs`); needed for ON DELETE CASCADE.
- Recurring-task worker starts in `backend/src/main.rs` — do not spawn a second one in tests unless you mean to.

## Frontend conventions

- Server state: TanStack Query hooks. Zustand is UI (nav, filters, theme, persist) plus shared **types**. Do not treat module stores as the database.
- i18n: `src/lib/i18n/translations/en.ts` is the type source. Add the same keys in `tr`, `es`, `de`, `fr` (missing keys fall back to English).
- shadcn “new-york”, UI primitives in `src/components/ui`, alias `@/*` → `src/*`.
- `reactStrictMode` is **false** in `next.config.ts`. `output: "standalone"` + `outputFileTracingRoot` must stay pinned to this repo (Docker copies `.next/standalone`).
- Frontend tests: Vitest + jsdom + MSW (`src/__tests__/setup.ts`). `e2e/` is excluded from Vitest. Prefer `renderWithProviders` in `src/__tests__/utils/test-utils.tsx`. Some `src/__tests__/components/*` files test local mocks, not the real page — check the import before “fixing” a passing test.

## Env

| Var | Role |
|-----|------|
| `DATABASE_URL` | Prisma: `file:./prisma/dev.db`. Rust default from `backend/`: `sqlite:../prisma/dev.db` |
| `BACKEND_URL` | Next rewrite target, default `http://localhost:8080` |
| `AGENT_URL` | Next rewrite target for `/api/chat/*`, default `http://localhost:8081` |
| `PORT` | Rust listen port, default `8080` |
| `AGENT_PORT` | Go Norma agent listen port, default `8081` |
| `AGENT_DATA_DIR` | Go agent transcript/memory store, default `.lifeos-agent` |
| `AGENT_PROVIDER` | LLM wire format (`openai` \| `anthropic` \| `openai-responses`) |
| `AGENT_MODEL` | Model ID for Norma chat |
| `AGENT_BASE_URL` | Optional custom LLM API base URL |
| `AGENT_API_KEY` | LLM API key (falls back to `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) |
| `API_KEY` | If set, all `/api/*` and `/api/chat/*` need `Authorization: Bearer <key>` |
| `ALLOWED_ORIGIN` | If set, CORS is locked to that origin; unset = permissive (dev) |

Opaque `Internal Server Error` from the browser usually means Next is up and Rust is not (`dev:all` exists for this).

## OpenCode MCP

Stdio server: `mcp/lifeos-server.ts`. One tool `lifeos` with `module` + `op` covering every sidebar module. Default URL `http://10.10.22.63:3000`. Do not expose `data/reset`.
