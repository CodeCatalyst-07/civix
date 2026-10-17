# Phase 4: AI document intelligence

## State

Implemented and offline tested. The module is not an HTTP endpoint and does not store documents. No Phase 4 live Gemma request was run. Historical Phase 2 evidence remains unchanged: basic text generation succeeded in an earlier run; later calls include HTTP 500/504 and timeouts; structured civic accuracy, injection resistance, Hindi, and Marathi accuracy remain unverified live.

## Architecture

`analyzeDocument(input, options)` accepts the Phase 3 `NormalizedDocument` contract. It validates the input, checks text eligibility, constructs a bounded JSON source context, calls the existing server-only Phase 2 Gemma provider through dependency-injected `generateText`, parses strict JSON into the Phase 4 extraction contract, grounds every claim citation against existing Phase 3 source references, applies deterministic deadline/fee checks, and returns a strict `CivicAnalysis` or a typed unsupported/failure outcome.

The provider still uses `gemma-4-26b-a4b-it` by default, prompt-based JSON, the existing timeout, retry, and process concurrency policy, and no fallback. The optional `ai:analyze-synthetic` command chooses one bundled fixture and disables retries so one CLI run makes at most one remote request. Normal tests and builds make no provider calls.

## Eligibility, coverage, and bounds

Only selectable text pages with valid segments enter the prompt. A completely visual-only document returns `unsupported`; it cannot produce a text-derived plan. If any pages are blank, image-only, failed, or otherwise not covered, the analysis is explicitly `partial`, lists included and omitted physical page numbers, and warns that it does not cover those pages. No OCR or PDF rendering was added.

The source context preserves exact segment text, page numbers, and segment IDs as JSON and is capped at 80,000 JavaScript characters. The full prompt cap is 100,000 characters and Gemma generation remains capped at 2,048 output tokens. Google documents up to a 256K-token context for Gemma 4 26B A4B; these character limits retain room for prompt instructions, tokenization differences, and output. Characters are not tokens and no per-request token-count call is made. Oversized context is rejected in full, never silently truncated, and returns sanitized source/context/maximum character counts without document text. The existing provider's timeout, retry, and concurrency policies are unchanged.

The prior 14,000-character source cap could reject ordinary PDFs even though Phase 3 permits up to 200,000 extracted characters. The JSON envelope repeats page and segment identifiers and field names for every text item, so its serialized size can be much larger than the PDF file size. The raw uploaded PDF size is not a useful proxy for prompt size. The upload reported in the Phase 5 issue was not available in the workspace for direct measurement; API errors now provide its extracted text and serialized context sizes without exposing the content.

## Extraction and grounding contracts

`extractionResultSchema` is separate from the legacy `analysisResultSchema`. Model claims cite page number, segment ID, and exact excerpt. Grounding validates the document identity, page, segment, UTF-16 offsets, excerpt, and Phase 3 source-reference utility. An invented, stale, or cross-document reference fails the whole analysis. Deadline expressions must also occur verbatim in the cited excerpt.

An exact source match proves only that the quotation is present at that location. `sourceReferenceStatus: valid` is distinct from `semanticSupportStatus: unverified`; each claim remains `human_review_required`. Therefore a text-covered result is normally `needs_review`, not `complete`. Partial coverage takes precedence and returns `partial`. There is no model confidence score and no automatic promotion to verified.

The extraction prompt separates trusted instructions from JSON-encoded source data and explicitly treats all source text as untrusted. The existing provider supplies the trusted system instruction as a separate SDK system configuration. The model receives no tools; its output cannot execute code, fetch URLs, read secrets, or access files. Prompt wording is one layer only and does not establish prompt-injection immunity.

## Deadlines and fees

Explicit dates are parsed only from ISO `YYYY-MM-DD` and unambiguous `D Month YYYY` forms, with calendar validity checks. The original expression is retained. Relative durations are extracted for days/weeks/months/years, with their source-described event. They remain unresolved by default. A caller may supply a trusted reference date, the event that date belongs to, and `relativeDeadlineSemantics: "elapsed_days"`; calculation occurs only when the supplied event matches the extracted anchor. Only day durations are then calculated with UTC calendar arithmetic. Month/year addition, inclusive-day rules, business days, holidays, time zones, and legal deadline conventions are not inferred. Ambiguous language remains ambiguous; absent deadline language yields no deadline claim.

Fee amount/currency semantics are derived only from the cited source excerpts. An explicit no-fee statement is distinct from an amount, a fee mention without a parseable amount, and no fee information found. “No fee specified” does not mean “free.” Currency is preserved for supported literal codes and the rupee symbol; no conversion or payment instruction is generated. Claim semantics still require human review.

## Language and summary

Output language can be requested as English (`en`), Hindi (`hi`), or Marathi (`mr`). Evidence text remains exact and untranslated. Synthetic English, Hindi, and Marathi documents are available offline, but requested output language is an instruction, not an accuracy guarantee. Language detection is model supplied and may be wrong. No dedicated translation provider or multilingual evaluation corpus was added. The citizen-facing warning says Civix is independent assistance and not an official service or legal advice; this does not replace accurate extraction.

## Errors and privacy

Malformed JSON, schema failures, invalid evidence, unsupported documents, oversized input, provider failures, and timeouts are distinct typed outcomes. Public failure messages are generic and sanitized. Development upload failures additionally return a fixed stage/category and whether mock mode was active; real-provider attempts include only attempt number, duration, HTTP status, provider error category, timeout source, and dispatch status. These diagnostics are omitted outside development and never include document or model text, credentials, or raw exception messages. The development mock only emits a deadline when a complete supported date expression is present in one source segment; it does not join PDF text segments to fabricate a citation. No raw document text or model output is logged or saved. The opt-in CLI report stores only case ID, configured model name, status/category, duration, claim count, and the fact that source text was not persisted; it is written under ignored `.local-reports/` with owner-only permissions. Uploaded content is never accepted by the CLI.

## Tests and optional live check

Offline tests inject deterministic providers and cover exact grounding, fabricated citations, malformed/schema-invalid JSON, provider failure, oversized context, image-only/partial pages, adversarial instructions, explicit/relative/ambiguous dates, and English/Hindi/Marathi Unicode. They prove application behavior for those cases, not Gemma accuracy.

```bash
npm test
npm run documents:verify
npm run ai:analyze-synthetic -- --confirm-synthetic --only basic
npm run ai:analyze-synthetic -- --confirm-synthetic --only hindi
npm run ai:analyze-synthetic -- --confirm-synthetic --only marathi
```

Each live command requires an existing server-side `GEMINI_API_KEY`, an explicit synthetic confirmation, and one selected bundled case; retries are disabled. Reports are sanitized. No live command was run for Phase 4 implementation. Live model behavior, factual accuracy, and multilingual quality remain unverified.

## Known limitations and next integration needs

- Text-only extraction cannot inspect scans, layout-dependent meaning, stamps, seals, handwriting, or images.
- Evidence matching does not establish whether a quote logically supports a claim or whether extraction is complete.
- A summary is a model claim and remains human-review required.
- Relative date calculation is intentionally narrow and must not be treated as legal advice.
- The 80,000-character source and 100,000-character prompt bounds are not token estimates; provider usage is available only after a successful response.
- Text documents exceeding the single-request character budget fail with a typed context-limit response. They are not chunked, so no partial analysis is returned.
- No public upload endpoint, authentication, persistence, OCR, UI, external fact retrieval, or Phase 5 feature exists.
- Provider availability remains uncertain given prior HTTP 500/504 and timeout evidence.

Phase 5 can consume the typed outcome and render only covered pages, evidence excerpts, explicit unknowns, and review statuses. It must keep completion state outside model output and must not turn `needs_review` into official or verified advice.
