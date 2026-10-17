# Gemma capability report

Updated 17 October 2026. **Basic text confirmed; structured reliability unresolved.** A server-only API key is configured in ignored `.env.local`. Saved later reports confirm successful text generation, followed by structured A failures (504 and timeout). The current diagnostic session is blocked by local DNS; this does not invalidate those earlier successes. See [targeted diagnostics](gemma-api-diagnostics.md) for the latest evidence and commands. No actual citizen documents were used.

## Configuration and documentation evidence

- Selected primary model: `gemma-4-26b-a4b-it`. Optional manual secondary: `gemma-4-31b-it`; not tested. No fallback.
- Installed official JavaScript SDK: `@google/genai` **2.30.0**, recorded by lockfile. CLI tooling: tsx 4.23.15.
- [Google's Gemma-on-Gemini guide](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api) documents the primary identifier, JavaScript generateContent, image input and systemInstruction. Documentation support is not proof of access or behavior in this project.
- Installed SDK declarations/source confirm inlineData, AbortSignal, HTTP timeout, configurable retry attempts and ApiError.status. SDK abort is client-side and does not cancel service computation. SDK default retries are disabled; Civix controls the budget.
- No model-specific structured-output enforcement was established from the reviewed Gemma guide. Default requests use prompt-based JSON and Zod, with no responseMimeType/responseSchema. An explicit optional responseMimeType probe exists. responseSchema support is **not verified or claimed**. Even a successful MIME probe requires review and does not prove universal enforcement.

## Capability observations

| Capability                                 | Current result       | Evidence / pending check                                                                                |
| ------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------- |
| Text explanation                           | Confirmed basic text | Later smoke and suite reports contain nonempty text and usage                                           |
| PNG document understanding                 | Unverified live      | Fixed 1000×500 fictional notice visually checked; inline SDK construction tested offline                |
| JPEG understanding                         | Unverified live      | Request construction tested offline; no live JPEG experiment                                            |
| Prompt-based JSON                          | Unverified live      | Parser, strict schema, bounded repair and literal checks pass offline                                   |
| SDK-enforced JSON                          | Unverified           | Optional MIME probe not run; responseSchema not tested                                                  |
| Hindi to English meaning                   | Unverified live      | Synthetic Hindi notice is ready; no output observed                                                     |
| Instruction-injection resistance           | Unverified live      | Request isolation tested; actual model behavior not tested                                              |
| Model access, usage counts, quota, latency | Partial observation  | Earlier text reports establish access and usage for those calls; quota and model latency remain unknown |

## Civic experiment status

| ID                    | Synthetic source                         | Expected behavior                                                                | Observed output / assessment                       |
| --------------------- | ---------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------- |
| A-explicit-deadline   | Phase 1 fixture 1                        | Preserve `before 25 October 2026`                                                | No output; HTTP 504 and timeout in later runs      |
| B-relative-deadline   | Phase 1 fixture 2                        | Preserve `within 15 days of receiving this notice`; no calendar calculation      | None; not run                                      |
| C-missing-fee         | Phase 1 fixture 2                        | Unknown fee is null                                                              | None; not run                                      |
| D-missing-information | Phase 1 fixture 3                        | Acknowledge omitted authority/materials/destination                              | Latest isolated connection failed; no model output |
| E-injection           | Fixture 1 plus embedded APPROVED command | Ignore embedded command as an instruction                                        | None; not run                                      |
| F-hindi               | Fictional Neelpankh office notice        | Explain signed application requirement in English; no fee/date invention         | None; not run                                      |
| text                  | Fictional address-proof notice           | Action, 25 October 2026 deadline, possible rejection                             | Earlier output observed; needs factual review      |
| image-png             | Fictional Application Notice PNG         | Title, fictional Meadowglass Service Desk, 25 October 2026, submit address proof | None; not run                                      |
| sdk-json-mode         | Same synthetic smoke notice              | Check MIME-mode acceptance and validate output                                   | None; not run; optional opt-in                     |

Initial runs failed to connect. Later local reports confirm basic text responses; their factual correctness still needs review. A then failed with HTTP 504 (two attempts) and AI_TIMEOUT (two attempts) in separate runs. Later cases were skipped. These failures do not establish a model-quality or JSON-validation failure because no structured output was returned. Offline tests are not model capability results.

## Commands and actual results

Final validation used Node **24.22.0**:

- `npm test`: **195 tests passed**, six files; no real network requests.
- `npm run lint`: passed.
- `npm run typecheck`: passed, including Next.js route type generation.
- `npm run build`: passed; only `/`, `/_not-found`, `/api/health` appear in the route listing.
- Initial `npm run ai:smoke` without credentials: not run, exit 2. After local key configuration: **failure**, AI_NETWORK_ERROR, exit 1, one connection attempt and no Google response.
- Initial `npm run ai:experiments` without credentials/opt-in: not run, exit 2. Follow-up `npm run ai:experiments -- --confirm-synthetic --probe-json-mode`: **failure**, exit 1. Nine requests planned; only the first connection was attempted, with remaining eight cases skipped. Report: `.local-reports/gemma-experiments-2026-10-17T05-48-09.108Z.json`.

The default full-suite CLI reports 8 logical remote requests (9 with MIME probe); --only reports its actual selected count, sequential execution and the retry-inclusive upper bound. It does not run automatically. It marks factual successes needs-review, flags narrow deterministic mismatches fail, and records sanitized provider failures. Explicit JSON repair is off in this suite. Saved reports contain only these bundled synthetic cases; never point the runner at real documents.

## Observed errors and limitations

Missing configuration was observed locally as a typed sanitized error. A subsequent live connection attempt observed AI_NETWORK_ERROR. A credential-free connectivity check confirmed ENOTFOUND resolving `generativelanguage.googleapis.com`. This connectivity failure cannot establish whether the currently configured key is valid; earlier successful calls establish access for the credentials used in those calls. Later saved reports establish actual provider HTTP 504 and a final timeout; authentication, access denial, missing model and quota mappings still have offline coverage only. No claim is made about actual provider error distributions. Retry-After and structured RetryInfo tests use mocked responses.

The first dependency tree lacked runnable tooling and contained an incomplete native SWC binary. Dependencies were restored, and the target Node 24 runtime was located locally. Final required checks pass. Initial install output mentioned five high-severity dependency advisories; a fresh audit was blocked by registry DNS failure, so their current details/remediation are unresolved. See architecture for environment details.

Literal source checks validate only fee/deadline transcription; a string match does not prove a claim or detect every invented obligation. Relative deadlines are never calculated. Prompt injection, multilingual fidelity, image readability and JSON reliability need real-output inspection and repeated evaluation. There are no model latency benchmarks; new diagnostics measure client operation/attempt durations only. Image magic-byte checking is not secure production ingestion or OCR.

Google's [free-tier data-use terms and pricing](https://ai.google.dev/gemini-api/docs/pricing) require privacy review before real documents are considered. [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) depend on project/model/tier and are not encoded as fixed quotas. In-process concurrency is not distributed abuse prevention.

The integration is ready for developer-controlled synthetic capability checks. PDF parsing, ingestion security, production image handling, source identity and evidence verification belong to later phases. Live verification is a prerequisite to trusting this provider for that work.

## Latest isolated diagnostic run

`npm run ai:experiments -- --confirm-synthetic --diagnostic --only D-missing-information` planned and attempted one structured connection, with retries disabled. It exited 1 with AI_NETWORK_ERROR before an HTTP response. A credential-free preflight separately confirmed ENOTFOUND for Google's API hostname. No model output, usage or abort was observed; no full suite was run. Report: `.local-reports/gemma-experiments-2026-10-17T06-07-27.973Z.json`.

The runner now supports repeated --only IDs and bounded --diagnostic mode, with request/operation timing, attempts, timeout, status/category, abort facts and usage. Default full-suite stopping and all strict validation are preserved. Timeout remains 30000 ms and normal structured calls still send no responseMimeType or responseSchema. See gemma-api-diagnostics.md for the complete comparison, regression evidence and remaining uncertainties.

## Thinking comparison follow-up

The report `gemma-experiments-2026-10-17T06-10-32.540Z.json` records structured D returning HTTP 500 after 28180 ms, one attempt, no application/transport abort and no usable output. An older text experiment also returned HTTP 500, so the error is not established to be structured-only. Google explicitly documents Gemma's API thinking levels MINIMAL and HIGH. A new fixed comparison uses the same synthetic D source for minimal-prompt/minimal-thinking, identical-prompt/high-thinking, and the existing Civix structured path with thinking unset. No production default changed.

`npm run ai:compare-thinking -- --confirm-synthetic` is capped at three attempts, one per case, with zero automatic retries or JSON repair. In this session DNS was unavailable, so all cases were not run and total inference attempts were zero. Exact settings, validation flags and offline verification are documented in [gemma-thinking-comparison.md](gemma-thinking-comparison.md). No new live conclusion about thinking or JSON reliability was established.

## Phase 4 status

Phase 4 adds an offline-tested analysis orchestrator that reuses the Phase 2 provider and does not alter the model default. No Phase 4 live request was run. The optional CLI requires explicit synthetic opt-in, accepts one bundled case, disables retries, and records sanitized metadata. Its existence is not evidence of model success, extraction accuracy, injection resistance, or Hindi/Marathi quality. See [AI document intelligence](ai-document-intelligence.md).
