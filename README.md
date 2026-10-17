# Civix

**Understand official documents. Know what to do next.**

Civix helps Indian citizens understand civic documents. It is independent information assistance, not an official government service or legal advisor. Missing facts remain unknown; schema-valid AI output may still be wrong.

## Setup

Next.js App Router, React, strict TypeScript, Node 24 LTS, Zod, Vitest, and Google's official `@google/genai` SDK. Use the npm lockfile.

```bash
nvm install
nvm use
npm ci
npm run dev
```

Open http://localhost:3000 and http://localhost:3000/api/health. No credentials are needed for the app, build, or offline tests. No AI requests run during startup or ordinary quality checks. To enable real document analysis, configure the server-only `GEMINI_API_KEY` described below.

### Phase 5–6 document workflow

The home page accepts PDF, PNG, or JPEG files up to 10 MiB. The analysis route validates and parses uploads in an isolated bounded child process, then passes normalized text to the Gemma pipeline. Upload bytes and processed image buffers are cleared after the request; nothing is stored. Requests are limited to one active document per server process. Classification is conservative and never establishes document authenticity. Image OCR uses local Tesseract when installed; see `docs/document-processing.md` for English, Hindi, and Marathi language packs. Scanned PDF pages are visibly reported as unreadable until a PDF raster backend is installed. A successful result remains `needs_review`; OCR text matching does not prove that the OCR reading matches the image or that a claim is semantically correct.

For a deterministic UI demonstration without credentials, use `CIVIX_MOCK_ANALYSIS=true` while running `npm run dev`. The route enables this only when Next sets `NODE_ENV=development`; each response and the page are labeled simulated. The default is false. Production always uses the real provider and returns an error if credentials or provider access are unavailable.

The language selector requests English, Hindi, or Marathi output from the real provider. Synthetic demo prose is available in all three languages; cited source text remains in its original language. Use the sample files in `src/features/documents/fixtures/files/` for local development.

## Gemma configuration

Create a Gemini Developer API key in [Google AI Studio](https://aistudio.google.com/apikey), using your own Google project. Check that project's model access and quota. Keep the key on your computer; never paste it into chat.

```bash
cp .env.example .env.local
chmod 600 .env.local
${EDITOR:-vi} .env.local
```

Enter the key as `GEMINI_API_KEY` in that local editor. `.env.local` and all other `.env*` files except `.env.example` are Git-ignored. Never use a `NEXT_PUBLIC_` credential. Do not print configuration objects or commit reports containing arbitrary prompts.

| Server variable              | Default              | Bounds / behavior                                 |
| ---------------------------- | -------------------- | ------------------------------------------------- |
| `GEMINI_API_KEY`             | unset                | Required only for real inference                  |
| `AI_MODEL`                   | `gemma-4-26b-a4b-it` | Exact requested model; no automatic fallback      |
| `AI_REQUEST_TIMEOUT_MS`      | `30000`              | Integer 100–120000; per remote attempt            |
| `AI_MAX_RETRIES`             | `1`                  | Integer 0–3; additional transient attempts        |
| `AI_MAX_CONCURRENT_REQUESTS` | `1`                  | Integer 1–4; shared process gate, excess rejected |

`gemma-4-31b-it` is a manually selectable secondary model. Other nonblank identifiers are accepted for future configuration, but availability is not implied. The CLI loads `.env.local` with Node's environment-file loader, without overriding existing process variables. It intentionally does not load other Next.js environment files or expand `$VARIABLE` references. Next.js sets `NODE_ENV` itself.

## Developer inference commands

```bash
npm run ai:smoke
# Fixed A/B/C thinking comparison: at most 3 attempts, no retries:
npm run ai:compare-thinking -- --confirm-synthetic
# Explicitly allow sending only the bundled synthetic sources:
npm run ai:experiments -- --confirm-synthetic
# Isolate cases; no hidden text preflight:
npm run ai:experiments -- --confirm-synthetic --only A-explicit-deadline
npm run ai:experiments -- --confirm-synthetic --only image-png
npm run ai:experiments -- --confirm-synthetic --only F-hindi
# One minimal English structured diagnostic, zero retries:
npm run ai:experiments -- --confirm-synthetic --diagnostic --only D-missing-information
# Also make one optional responseMimeType JSON-mode capability probe:
npm run ai:experiments -- --confirm-synthetic --probe-json-mode
# Example manual secondary model selection:
AI_MODEL=gemma-4-31b-it npm run ai:smoke
```

Smoke sends one short request with transport retries disabled. It prints sanitized status, requested model, provider-reported model version, and available token usage; absent usage is null. A successful transport response is not a correctness assessment. Its synthetic response is saved locally for inspection.

Experiments announce **8 planned requests**, or **9 with the optional JSON-mode probe**, and the maximum including configured transport retries. They run sequentially: text explanation, six civic extraction cases, and one fixed synthetic PNG. No JSON repair runs in the suite. The full suite stops remaining work after provider/auth/quota/transport failures. Repeated `--only ID` flags run exactly the selected independent cases and continue after a selection fails. `--diagnostic` requires 1–3 unique explicit selections and forces zero retries for that run; all modes remain sequential and require synthetic confirmation. No uploads or arbitrary input paths are accepted. PNG and JPEG request construction have offline coverage; only PNG has a bundled live experiment.

Developer-only metadata records experiment/model, operation and per-attempt duration, timeout, HTTP status, error category, abort observations, request counts and available usage. No source/response content or credentials are printed in diagnostics. Timeout defaults remain unchanged.

Reports go to ignored `.local-reports/` JSON files, with model, SDK version, source identifiers, observed outputs, expectations, assessments, and skipped/failure reasons. Successful factual outputs remain `needs-review`; narrow deterministic checks can flag `fail`. Review the outputs against the synthetic sources; do not automatically promote them to correct. Exit codes: 0 completed without detected failure, 1 failed request/check, 2 not run because configuration or explicit opt-in is missing. Repeated runs consume additional project quota.

## Privacy and rate limits

**Only synthetic fixtures may be sent in Phase 2. Never send actual citizen documents.** Google's free-tier services may use submitted content to improve products; review the [current pricing/data-use table](https://ai.google.dev/gemini-api/docs/pricing) and [API terms](https://ai.google.dev/gemini-api/terms) before enabling inference. This phase is not approved for personal or sensitive documents.

Limits depend on the actual project, model and tier; check [AI Studio and Google's rate-limit documentation](https://ai.google.dev/gemini-api/docs/rate-limits). No advertised free-tier limit is hardcoded. Concurrency is not requests-per-minute or token throttling. A bounded retry policy respects exposed Retry-After headers and structured RetryInfo. Long retry delays are returned to the caller rather than shortened. A client abort does not guarantee Google's server stopped work or billing. The process gate has no queue and is not distributed or per-user rate limiting.

## Validation

```bash
npm run lint
npm run typecheck
npm run format:check
npm test
npm run build
```

Ordinary tests use injected SDK behavior and mocked fetch, with deterministic sleep/backoff. They require no API key or network. The CLI uses `tsx` and the `react-server` condition to run the same guarded server modules outside Next.js. These flags belong only to these CLI commands.

Verification on 17 October 2026 used Node 24.22.0: 195 tests across six files, lint, typecheck, and production build passed. See the [capability report](docs/gemma-capability-report.md) for live status and environment limitations.

## Scope and important paths

Phase 1 contracts, three synthetic fixtures, health route, and minimal shell are preserved. Phase 2 adds a server-only Google Gemma adapter, text/image methods, a small experimental extraction contract, conservative JSON parsing, literal grounding checks, typed sanitized errors, timeouts/retries/concurrency, and developer CLI experiments.

- `src/features/ai/`: provider, SDK transport, experimental schema, prompts, parser, resilience, synthetic experiments and image.
- `scripts/ai-runner.ts`: explicit developer inference commands.
- `src/lib/config/` and `src/lib/errors/`: lazy server configuration and shared error patterns.
- `src/features/documents/`, `analysis/`, `evidence/`: existing production domain contracts.
- `src/tests/`: offline tests.

Phase 5 adds the first public in-memory upload and analysis workflow, evidence review dashboard, and explicitly gated development mock. The analysis source context is bounded to 80,000 characters; oversized input is rejected with sanitized size diagnostics, never truncated. OCR, persistence, authentication, databases, and cloud storage remain out of scope. Phase 3 provides offline PDF/PNG/JPEG processing; Phase 4 provides a provider-injected analysis pipeline with bounded source context, exact citation checks, typed outcomes, and explicit review status. Saved local reports confirm **basic text generation**. Structured requests have returned HTTP 500/504 and timeouts; structured and image reliability remain unverified. The current diagnostic session could not resolve Google's API hostname (ENOTFOUND). See [targeted diagnostics](docs/gemma-api-diagnostics.md) and [Phase 4 architecture and limitations](docs/ai-document-intelligence.md). Exact source matching does not prove that a claim is semantically supported.

Read [architecture](docs/architecture.md), [contracts](docs/data-contracts.md), [roadmap](docs/roadmap.md), and [engineering principles](AGENTS.md) before extending the system.

The [thinking comparison](docs/gemma-thinking-comparison.md) documents official MINIMAL/HIGH support, exact request differences, the hard three-attempt budget, and the latest not-run result when DNS is unavailable. It does not change production defaults.

## Phase 3: offline documents

Secure in-memory PDF/PNG/JPEG processing now includes signature/decoder checks, resource limits, killable isolated parsing, PDF text items and page provenance, image orientation/normalization, quality flags and exact evidence-location validation. No documents are automatically sent to Gemma. Existing provider limits and live capability uncertainties remain unchanged.

```bash
npm run documents:verify  # 18 bundled synthetic cases; no API key or network
npm run documents:fixtures  # optional regeneration on the documented font environment
```

The verifier saves sanitized counts/statuses under `.local-reports/`. See [document processing](docs/document-processing.md) for contracts, defaults, tests, dependency findings and fixture regeneration. OCR and PDF-to-image rendering are pending; scanned pages request visual processing without invented text. Runtime code is under `src/features/documents/`; the disposable parser is `scripts/documents/parser.mjs`. No public upload endpoint or persistent document storage exists.

Phase 3 validation on Node 24.22.0: **234 offline tests passed** across eight files; all 17 CLI fixture outcomes matched expectations; lint, typecheck, formatting and production build passed. Registry DNS prevented a current dependency audit; earlier high advisories remain unresolved.

## Phase 4: AI document intelligence

The analysis pipeline accepts Phase 3 normalized documents, rejects image-only inputs, labels incomplete page coverage as partial, and rejects oversized contexts instead of truncating. It reuses the existing server-only Gemma provider and validates model JSON separately from source grounding. Every retained material claim must cite exact source text and remains semantically unverified for human review. Relative deadlines resolve only with an explicit trusted date and caller-supplied elapsed-day semantics. Missing fee information is distinct from an explicit no-fee statement. Offline validation and optional one-request synthetic experiments are documented in [ai-document-intelligence.md](docs/ai-document-intelligence.md). Phase 4 has not been live-verified.
