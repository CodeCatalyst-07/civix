# Architecture

## Scope and decisions

Phase 1 implements a Next.js App Router shell, a health route, strict Zod contracts, deterministic semantic checks, synthetic fixtures, lazy server configuration, typed errors, and automated tests. Phase 2 adds the isolated server-only AI provider described below. Phase 3 adds offline document extraction and source-location validation. Phase 4 adds an offline-testable provider-injected analysis orchestrator with bounded text contexts and claim citation checks. Phase 5 adds the in-memory upload route and evidence review UI. Phase 6 adds conservative content classification and optional local Tesseract OCR for images; scanned-PDF rendering still requires an installed PDF renderer and is reported as unreadable.

Planned flow:

```text
Browser → Next.js backend → Document ingestion → Text extraction
        → Gemma 4 → Structured analysis → Evidence verification → User interface
```

The backend validates uploaded media and treats document content as untrusted input. Extracted content goes to the provider adapter. Provider output passes structural validation, then separate source-evidence checks. Source location matches are labeled as such; semantic support remains unverified and human review is required. Missing or uncertain facts remain explicit. The UI exposes source evidence.

## Module responsibilities

- `features/documents`: metadata and supported media; synthetic source/expected-output fixtures.
- `features/evidence`: source quotation contracts and verification states.
- `features/analysis`: composable analysis contracts and pure consistency validation.
- `lib/config`: lazy server-only environment access. Importing the module does not require credentials.
- `lib/errors`: typed internal errors and safe public representations.
- `app`: HTTP boundary and minimal server-rendered homepage.
- `tests`: offline unit and fixture checks; no provider calls.

Feature contracts remain framework-independent. Types are inferred alongside schemas, avoiding redundant type-only folders. Structural parsing and semantic checks have separate exports; the combined analysis schema applies both. Phase 4 adds exact cited-source matching and narrow deterministic date/fee checks, but does not prove semantic support. Claims remain human-review required.

## Decisions

Use Node 24 LTS, npm lockfile, App Router, strict TypeScript, Zod, Vitest, ESLint flat configuration, and Prettier. Version comes from package.json. No remote fonts or runtime network dependencies are required. Dates are calendar strings, money is a decimal string, unknown values use null or explicit literals, and strict objects reject unexpected AI fields. Analysis status is separate from document ingestion status. Pending and failed attempts can exist without an analysis result; only completed or partial output uses the result contract.

Use TypeScript 6.0 and ESLint 9 release lines to satisfy the Next.js lint dependencies' peer ranges. The newer TypeScript 7 and ESLint 10 majors produced peer conflicts during dependency resolution and are not the compatible defaults for this foundation. The npm lockfile pins the tested dependency tree.

Registry DNS restrictions prevented downloading some latest releases. The tested lockfile uses cached Vitest 4.1.11, Prettier 3.9.9, eslint-config-next 16.4.0, and @types/node 24.19.0 rather than the registry's newer releases. This is an environment-driven deviation from the latest-version request, not an assertion that those versions are latest. Next.js is 16.4.2, React is 19.3.1, and Zod is 4.6.7. Revisit the tooling updates when registry access is available; preserve peer compatibility and rerun all checks. No custom registry or cache configuration is required by the project.

The model identifier is configurable, defaults to `gemma-4-26b-a4b-it`, and is not an enum. Hosted availability and compatibility remain unverified without live credentials. No claim is made that valid contracts imply accurate civic advice.

Setup follows the [Next.js installation documentation](https://nextjs.org/docs/app/getting-started/installation). The LTS runtime choice follows the [Node.js release schedule](https://nodejs.org/en/about/previous-releases).

## Phase 2 provider boundary

`features/ai/contracts.ts` defines an SDK-independent interface for text, image and experimental structured extraction. No Phase 1 production schema changed. `google-gemma.ts` implements it using lazy configuration and dependency-injected SDK calls. `google-client.ts` pins the official Gemini Developer API endpoint, explicitly disables Vertex mode and SDK retries, and preserves Retry-After headers before the SDK discards them. The request always uses the configured model; no fallback exists. Results distinguish requested model from provider-reported modelVersion and nullable usage counts.

Configuration and the adapter/transport import `server-only`. Importing them neither requires a key nor performs inference. Existing `getAIConfig` retains its model/key return shape; `getAIPolicy` validates operation settings separately. Missing credentials have a specific AppError code at invocation. Public error messages use the existing whitelist; raw SDK errors, source text and Zod issues are not exposed. Google ApiError HTTP status and structured ErrorInfo/RetryInfo drive classification; unknown errors receive a generic provider code. A missing model returns a model-unavailable error on 404; some provider 400/403 responses may remain validation/access errors because their causes cannot safely be distinguished.

Each attempt gets a deadline, SDK timeout and AbortSignal. A race bounds caller wait even if a mocked/failed transport ignores abort. The gate retains that underlying request's slot until it settles, preventing timed-out requests from creating a new outbound burst. Abort cancels client-side work only; server cancellation/billing is not guaranteed. SDK TimeoutError/AbortError are also classified as timeouts. Timeouts and uncertain network failures are not retried. Only 429 and selected transient 500/502/503/504 statuses retry, with bounded exponential jitter; exposed Retry-After/RetryInfo is a minimum delay. Delays over 30 seconds return metadata immediately rather than block or violate the server hint. Authentication, input, safety, parse and grounding failures do not get transport retries. A shared in-process gate has zero queued requests; excess work is rejected. It is not distributed or per-user rate limiting.

Prompts cap at 20000 characters including extraction instructions; output caps at 50000 characters and generation requests cap output tokens at 2048. PNG/JPEG inputs cap at 2 MiB and check declared type against leading signatures. This is capability testing, not a complete image decoder, dimension/decompression defense, ingestion pipeline or OCR service. The checked-in PNG is generated from the accompanying fictional SVG; no image preprocessing happens at runtime.

The experimental extraction schema is strict, nullable for absent facts, and independent of the production analysis contract. The parser accepts direct JSON or one whole Markdown fence, never explanatory-text substring extraction. It returns validated data only. Deadline/fee literals are checked separately against the input source. This limited transcription check cannot verify summaries, obligations, completeness or truth. An explicit `repairOnce` option retries malformed/schema-invalid output once using the original source and fixed instructions, without replaying the failed output as instructions. It never repairs auth, safety, network, quota or semantic-grounding errors. Experiment defaults disable repair.

System policy treats source text/image instructions as untrusted. Structured source is JSON-string encoded within the user message. This isolates roles but does not prove model resistance; the injection experiment needs actual model review. No user completion state enters AI output.

`ai:smoke` and `ai:experiments` use tsx (development-only tooling) and Node's react-server condition to execute guarded modules. `.env.local` is loaded only by these explicit CLI commands. The suite requires --confirm-synthetic, announces a bounded request budget and runs sequentially. Only fixed synthetic sources and image paths are allowed. Reports redact the configured key and store synthetic output under ignored `.local-reports/`; no arbitrary prompts are persisted by the provider. Successful factual results remain needs-review. A separate --probe-json-mode experiment can test responseMimeType acceptance without making normal calls depend on it. responseSchema is not assumed or used. No routes or app imports call the provider.

## Phase 2 verification constraints

The initial checkout had incomplete dependency executables, so a clean pre-change baseline could not be established. After dependency restoration the existing three test files passed (109 cases including the expanded shared error-code table); the final suite has 162 cases. The bundled Next.js environment and server/client boundary guides were read after restoration; no Next.js routes/components were modified. The initial shell was Node 25.9.0; final checks used a locally available Node 24.22.0 runtime. An incomplete SWC binary was restored from the existing temporary npm cache without changing Next.js versions. No repository Git metadata is present in this workspace; ignore rules are provided but a Git diff/status could not be inspected.

The SDK installation reported five high-severity dependency advisories, but a fresh npm audit could not reach the registry (ENOTFOUND). The offline install's zero-vulnerability message is not an authoritative audit. Advisory details and remediation remain unverified; no broad dependency upgrade or audit fix was applied. This is separate from the passing application checks. See gemma-capability-report.md for observed live status.

## Targeted Phase 2 diagnostics

`features/ai/diagnostics.ts` defines fixed metadata records and credential redaction for the synthetic CLI. The provider's optional onDiagnostic callback emits per-attempt timing, configuration, sanitized status/category, usage and abort facts. The SDK transport observes its actual fetch signal and HTTP status; it never logs headers or request content. The CLI adds experiment IDs and whole-operation timing, preserving final parse failures separately from request success. No diagnostics run automatically in the application. Both credential slots are redacted when CLI reports are serialized.

`features/ai/experiment-control.ts` validates known IDs, requires synthetic confirmation and executes an explicit plan. Default full-suite provider stopping remains; repeated --only flags select independent experiments that may continue after another selection fails. --diagnostic additionally requires at most three unique explicit IDs and disables transport retries for that run. The CLI announces the effective bounded budget. No provider interface, domain schema or public route changed. Default timeout remains 30 seconds; tests prove SDK retries are disabled and show 504 followed by timeout can explain an old final two-attempt timeout without retrying timeout itself. The root cause of earlier structured-request failures is unresolved. See gemma-api-diagnostics.md for measured request comparison and current live limits.

## Fixed thinking comparison diagnostic

`features/ai/thinking-comparison.ts` and `scripts/ai-compare-thinking.ts` implement a synthetic A/B/C comparison, capped at three sends, one per profile. The adapter accepts a developer-injected MINIMAL/HIGH thinking override; ordinary calls leave it absent. A/B share the same source and shortened prompt, differing only in thinking; C executes the existing structured path and keeps thinking omitted. All share the current system policy, temperature, output cap, configured timeout, strict parser/schema and literal checks. The literal check was extracted without behavioral changes into output.ts for reuse. No production environment configuration or defaults changed.

The diagnostic forces zero retries/repair and sequential requests, enforces an independent send budget, refuses a different model, and performs a DNS-only preflight before remote attempts. It reports safe timing/status/settings and distinct JSON/Zod/grounding flags without persisting response or thought content. Network unavailability produces not-run rows and zero inference attempts. See gemma-thinking-comparison.md for official SDK evidence, the current blocked live result and the limits of a single sample per configuration.

## Phase 3 document boundary

`features/documents` now owns input validation, separate strict ingestion contracts, deterministic text normalization, PDF/image processing, quality assessment and exact source references. The server-only entry point delegates SDK-independent parsing to a disposable child process (`scripts/documents/parser.mjs`), validates its response and kills/awaits it before releasing the one-operation gate. Raw documents never enter filesystem storage. Binary PNGs are separate from serialized results and have explicit disposal. The source-matched status verifies location only; it never changes analysis evidence to verified.

PDF.js 6.3.289 and sharp 0.35.5 implement the actual extraction/normalization paths; Node 24 and Apple Silicon are exercised offline. PDF rendering/OCR are pending. No app routes/components or Phase 2 provider code changed. The existing metadata schema's WebP allowance is preserved for compatibility while ingestion accepts only PDF/PNG/JPEG. Roadmap OCR wording was corrected to reflect the explicitly narrower Phase 3 boundary. See [document-processing.md](document-processing.md) for budgets, isolation limitations, dependency audit failure, provenance semantics, tests and future Next.js asset packaging requirements.
