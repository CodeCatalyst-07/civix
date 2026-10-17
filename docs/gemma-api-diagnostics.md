# Targeted Gemma API diagnostics

17 October 2026. Phase 2 only; no new routes, ingestion, PDF/OCR processing, or schema changes.

## Findings and limits of the diagnosis

Local reports confirm the described behavior, rather than just relying on the task summary:

- `gemma-smoke-2026-10-17T05-52-25.641Z.json`: successful nonempty text response using `gemma-4-26b-a4b-it`, with provider usage metadata.
- `gemma-experiments-2026-10-17T05-53-55.314Z.json`: text observed, then A failed with AI_SERVICE_UNAVAILABLE / HTTP 504 / two attempts.
- `gemma-experiments-2026-10-17T05-58-07.191Z.json`: text observed, then A failed with AI_TIMEOUT / two attempts. Later cases were skipped.

These reports are ignored local synthetic artifacts. They have no per-attempt timings, errors or abort facts. The final timeout's two-attempt count is **not evidence that a timeout was retried**: code retries 504 but does not retry AI_TIMEOUT. A first-attempt 504 followed by a timeout on the second attempt reproduces this final error offline. That is an explanation consistent with the reports, not a proven reconstruction of the second run.

The observed failures occurred before any structured response reached the parser. JSON parsing and Zod validation cannot cause these upstream HTTP 504 or request timeout errors. No evidence establishes whether provider load, model generation time, or another upstream condition caused them. Prompt complexity is a hypothesis only. There is no basis for changing the model, temperature, output budget or timeout default.

## Request comparison

Counts are measured JavaScript string lengths from the checked-in synthetic sources and prompts, not token estimates. All requests have the same 463-character system policy.

| Property                            | Successful text path                                                 | Structured A path                                                                              |
| ----------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Endpoint / SDK                      | Official Developer API v1beta generateContent / @google/genai 2.30.0 | Same                                                                                           |
| Configured model                    | gemma-4-26b-a4b-it                                                   | Same; no fallback                                                                              |
| Request contents                    | One user message, one text part                                      | Same shape; extraction instructions and JSON-encoded source                                    |
| User prompt size                    | Smoke: 231 chars; suite text: 202 chars                              | 1193 chars, including 452 source chars                                                         |
| Temperature                         | 0                                                                    | 0                                                                                              |
| Output token cap                    | 2048                                                                 | 2048                                                                                           |
| Response MIME override              | Absent                                                               | Absent                                                                                         |
| responseSchema / responseJsonSchema | Absent                                                               | Absent                                                                                         |
| Validation                          | Nonempty bounded text                                                | Same, followed by conservative JSON parser, strict Zod schema, and literal fee/deadline checks |
| Timeout                             | Configured 30000 ms per attempt                                      | Same                                                                                           |
| Application retries                 | Smoke: 0; suite text: configured 1 additional retry                  | Configured 1 additional retry                                                                  |
| SDK retries                         | Disabled via attempts: 1 at client and per-request level             | Same                                                                                           |
| JSON repair                         | Not applicable                                                       | Off in suite; existing explicit repairOnce API remains limited to one syntax/schema repair     |

The source field constraints are unchanged: all keys required, absent facts nullable, extra keys rejected. Fee/deadline text must occur verbatim in the source. These checks do not establish all claims' source support, truth or completeness. Do not label a validated result factually correct automatically.

## Official documentation check

The [Gemma-specific API guide](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api) documents the selected model, text, image and system-instruction examples. It does not establish model-specific JSON-schema enforcement. Google's [Generate Content structured-output guide](https://ai.google.dev/gemini-api/docs/generate-content/structured-output) describes Gemini structured output; it is not evidence that Gemma accepts the same features. Hosted Gemma JSON MIME/schema enforcement therefore remains **unverified**, not declared unsupported.

Normal extraction already uses the conservative fallback: prompt-only JSON, parse, Zod, then literal checks. There is no unsupported JSON mode to remove from A. The optional sdk-json-mode experiment remains explicitly gated by --probe-json-mode and tests responseMimeType acceptance only; it cannot establish enforcement from a single sample. No automatic model or credential switching was introduced.

## Timeout and transport investigation

Installed SDK source (`apiCall` and `createAttemptSignal`) shows a separate per-attempt AbortController and timeout, with caller abort propagation. SDK attempts: 1 means zero internal retries; Civix's withRetries is the only retry loop. Both SDK and application deadlines receive the same configured timeout. They overlap in elapsed wall time; they do not add two full timeouts to each individual attempt. Application retry backoff and a second eligible attempt can increase total experiment duration beyond 30 seconds.

New offline tests use the real SDK serializer and mocked fetch to verify the actual HTTP timeout aborts its fetch signal and two eligible 504 attempts produce exactly two fetch calls. A first-attempt timeout produces one call. The 504-then-timeout regression reproduces the ambiguous old final error and now yields distinct per-attempt records.

The SDK fetch signal is observed directly until response consumption completes. Diagnostics distinguish applicationAbortRequested, transportAbortObserved and timeoutSource. An unavailable transport observation is null, not false. These are client facts; neither implies Google stopped server work or billing. The gate retains slots for underlying requests that ignore abort until they settle; independent selections do not bypass that protection.

Default timeout remains 30000 ms, max retries 1, concurrency 1. No new dependencies, timeouts of several minutes, additional retry layer or key rotation were added.

## Developer diagnostics

The provider emits nothing unless onDiagnostic is explicitly supplied. The CLI opts in and prints metadata only:

- Experiment ID, requested model, whole-operation duration and configured timeout.
- Dispatched attempt count and one record per application attempt, including retry ordering.
- Whitelisted HTTP status, sanitized error category and available token counts (null when unavailable).
- Application abort request, observed transport abort, and application-versus-SDK timeout source.
- Prompt/system character counts, response mode, output-token limit, and SDK attempt limit.

Whole-operation duration includes application backoff and local validation. Per-request duration measures its attempt. Request success followed by parse failure retains successful request metadata and a final AI_INVALID_OUTPUT category. Diagnostic callbacks cannot trigger inference retries. No request text, response text, URLs, headers, key values, raw exceptions, or stack traces are printed by diagnostics. Both primary and backup keys are redacted from serialized reports as defense in depth. As before, explicit synthetic output is saved in ignored .local-reports for human review, including invalid JSON when available.

## Selecting experiments

Use the configured key in .env.local; never put it on the command line. All remote experiment commands still require --confirm-synthetic.

```bash
npm run ai:experiments -- --confirm-synthetic --only A-explicit-deadline
npm run ai:experiments -- --confirm-synthetic --only image-png
npm run ai:experiments -- --confirm-synthetic --only F-hindi
```

Repeated --only flags run exactly those unique IDs in the given order. An explicitly selected independent experiment continues after another selection fails. No text preflight or hidden smoke request is added. Default full-suite stopping after provider failure is preserved; full-suite validation/empty-output failures retain their previous continuation behavior.

For a smaller, bounded diagnostic pass, add --diagnostic. It requires 1–3 explicit unique selections, forces zero transport retries for that CLI run and preserves the timeout/concurrency settings. It does not enable JSON repair.

```bash
# Smallest English source fixture, one structured call, zero retries:
npm run ai:experiments -- --confirm-synthetic --diagnostic --only D-missing-information
# Independent cases, at most three calls total:
npm run ai:experiments -- --confirm-synthetic --diagnostic --only A-explicit-deadline --only image-png --only F-hindi
# Optional MIME-mode check, isolated and separately opted in:
npm run ai:experiments -- --confirm-synthetic --diagnostic --only sdk-json-mode --probe-json-mode
```

Other existing IDs: text, B-relative-deadline, C-missing-fee, D-missing-information, E-injection. Invalid options fail before inference without echoing arbitrary arguments. Budget announcements reflect selected IDs and effective retry policy. Exit 0 means completed without detected failures, not factual correctness; exit 1 means detected failure, exit 2 means not run for missing config/confirmation.

## Actual verification in this diagnostic session

Node 24.22.0: lint, Next typecheck, format check, **186 tests across five files**, and production build passed. All tests are offline; mock fetch prevents real SDK network access. The original 162 tests remain intact and pass.

The isolated D command above was executed once with one planned connection attempt and no retries. It exited 1 with AI_NETWORK_ERROR, null HTTP status, null usage, no client abort, and no model output. A credential-free connectivity check separately returned ENOTFOUND for generativelanguage.googleapis.com. This is an environment connectivity failure, not evidence that the current key or Gemma structured generation is invalid. Report: `.local-reports/gemma-experiments-2026-10-17T06-07-27.973Z.json`.

No full live suite, image inference, multilingual inference, MIME probe or repeated API retries were run in this session. Run the isolated command locally when connectivity is available. Prior successful text reports remain evidence of basic text access; structured reliability and the root cause of the two earlier failures remain unresolved. Phase 2 is ready for further controlled live diagnostics, not production document processing or Phase 3 implementation.
