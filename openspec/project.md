# Project Context

## Purpose

OmniRoute — a unified AI proxy/router. One endpoint, 160+ LLM providers, with
automatic fallback, combo routing, search and web-fetch gateways, MCP/A2A agent
protocols, skills, and persistent memory. Hermes consumes OmniRoute as its
search (`/v1/search`) and URL-extraction (`/v1/web/fetch`) gateway.

## Tech Stack

- TypeScript 6.0+ (target ES2022, module esnext, resolution bundler, `strict: false`)
- Next.js 16 App Router (`src/`), standalone build
- `open-sse/` streaming engine workspace (handlers, executors, translators, services)
- Electron desktop app (`electron/`)
- SQLite via `src/lib/db/` domain modules (WAL journaling, versioned migrations)
- Node.js ≥22 <23 || ≥24 <27, ES Modules
- Vitest + Node native test runner; Playwright for e2e
- Default port 20128 (API + dashboard)

## Project Conventions

### Code Style

- 2 spaces, semicolons, double quotes, 100 char width, es5 trailing commas (Prettier via lint-staged)
- Imports: external → internal (`@/`, `@omniroute/open-sse`) → relative
- Naming: files camelCase/kebab, components PascalCase, constants UPPER_SNAKE
- ESLint: `no-eval`/`no-implied-eval`/`no-new-func` = error; `no-explicit-any` = warn in `open-sse/` and `tests/`

### Architecture Patterns

- API routes: `Route → CORS preflight → Zod body validation → optional auth → handler delegation` (handlers live in `open-sse/handlers/`, never inline). No global Next.js middleware.
- DB access only through `src/lib/db/` domain modules — never raw SQL in routes/handlers; never add logic to `localDb.ts` (re-export layer only).
- Error responses route through `buildErrorBody()` / `sanitizeErrorMessage()` (`open-sse/utils/error.ts`) — never raw `err.stack`/`err.message`.
- Public upstream credentials via `resolvePublicCred()` — never string literals.
- Three distinct resilience mechanisms kept separate: provider circuit breaker, connection cooldown, model lockout.

### Testing Strategy

- Unit first → integration → e2e. Both runners must pass: `npm run test:unit` (Node native) AND `npm run test:vitest` (MCP, autoCombo, cache).
- Coverage gate 60/60/60/60 (statements/lines/functions/branches), ratcheted against `quality-baseline.json`.
- Hard Rule #18 — every bug fix validated by a failing-then-passing test (TDD preferred) OR a documented live VPS test (`192.168.0.15`). "Worked locally without a test" does not count.
- Changing production code in `src/`/`open-sse/`/`electron/`/`bin/` requires tests in the same PR.

### Git Workflow

- Never commit directly to `main`. Branch prefixes: `feat/`, `fix/`, `refactor/`, `docs/`, `test/`, `chore/`.
- Conventional Commits with scopes (`db`, `sse`, `oauth`, `dashboard`, `api`, `cli`, `docker`, `ci`, `mcp`, `a2a`, `memory`, `skills`).
- Husky pre-commit (lint-staged + docs-sync + any-budget) and pre-push gates; never bypass with `--no-verify` without operator approval.
- Never add `Co-Authored-By` trailers crediting AI assistants/bots; human collaborators may be credited.

## Domain Context

- Search providers registered in `open-sse/config/searchRegistry.ts`; `/v1/search` currently auto-selects cheapest-first when no explicit provider is given.
- Web fetch (`/v1/web/fetch`) currently supports `firecrawl | jina-reader | tavily-search`.
- The daily model-manager routine lives in the Hermes repo; OmniRoute supplies management APIs, routing, telemetry, and provider support. See `openspec/TODO.md` for deferred scope.

## Important Constraints

- 35 CI quality gates across 6 jobs; pass/fail policy gates plus ratchets that must not regress.
- Routes that spawn child processes (`/api/services/`, `/api/mcp/`, `/api/cli-tools/runtime/`) must be classified `isLocalOnlyPath()` in `src/server/authz/routeGuard.ts` (loopback enforced before auth).
- Regex over untrusted input must be strictly bounded (ReDoS); credentials encrypted at rest (AES-256-GCM); prefer secure-by-default libraries (Helmet, DOMPurify, ssrf-req-filter, safe-regex, Tink).
- Full Hard Rules list in `CLAUDE.md`.

## External Dependencies

- 160+ LLM providers (OpenAI, Anthropic, Gemini, GLM, etc.) via executors/translators.
- Search/fetch providers: Brave, Tavily, Exa, Serper, SearchAPI, Linkup, SearXNG, You.com, Perplexity, Google PSE, Ollama, Z.AI; planned: Mdream, Parallel (search + extract), Firecrawl, Gemini grounded search.
- Qdrant + FTS5 for memory; production VPS at `192.168.0.15`.
