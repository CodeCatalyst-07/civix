# Data contracts

All domain objects are strict Zod objects: unexpected keys are rejected, not silently removed. Types are inferred from schemas and exported beside them. Identifiers are nonempty strings (maximum 200 characters); they are opaque, stable within an extraction, and not required to be UUIDs. Human text must not be blank. Timestamps are ISO UTC instants; deadline dates are calendar dates without time zones.

## Metadata

`documentMetadataSchema` defines `id`, `originalFilename`, `mimeType`, `fileSizeBytes`, `pageCount`, `originalLanguage`, `category`, `createdAt`, and `status`.

Supported media: application/pdf, image/jpeg, image/png, image/webp. Bytes and page count must be positive safe integers. Unknown page count and language are explicitly null. Language tags include en, hi, and mr; other syntactically valid language tags are accepted for future extraction. Status is pending, processing, completed, or failed.

Categories are government_notice, municipal_document, tax_related, public_service_form, scholarship_notice, utility_notice, official_correspondence, other, and unknown. Extend the shared enum when needed; all schemas compose it.

Valid example:

```json
{
  "id": "synthetic-doc-1",
  "originalFilename": "example.pdf",
  "mimeType": "application/pdf",
  "fileSizeBytes": 1024,
  "pageCount": null,
  "originalLanguage": null,
  "category": "unknown",
  "createdAt": "2026-10-01T09:00:00Z",
  "status": "pending"
}
```

Invalid examples: `mimeType: "text/html"`, `fileSizeBytes: 0`, `pageCount: 1.5`, or `createdAt: "yesterday"`. Metadata validation does not inspect actual file signatures, enforce upload limits, or sanitize filenames; the separate Phase 3 ingestion boundary now handles those.

## Evidence

`evidenceSchema` contains `id`, `documentId`, `pageNumber`, `quotation`, optional `sourceBlockId`, and `verificationStatus`. Pages use **one-based physical page indices**, independent of printed page labels. A single image is page 1. Quotation whitespace is preserved. Blank quotations are invalid. Missing source content should produce no evidence record and an analysis warning, rather than an invented quotation or page number.

Verification status is verified, unverified, or unavailable. No default promotes an AI quotation to verified. Future application code must own this transition after checking actual source content. The current schema accepts stored statuses but cannot establish their truth. Unavailable means the claim cannot be checked against available source content.

Valid evidence: `{"id":"e1","documentId":"d1","pageNumber":1,"quotation":"Submit the form.","verificationStatus":"unverified"}`. Page 0 and empty quotations are invalid. This legacy contract stays unchanged; Phase 3 source references separately preserve available PDF text geometry. UI highlighting remains deferred.

## Summary and actions

`summarySchema` includes title, category, nullable issuingAuthority, nullable sourceLanguage, plainLanguageSummary, actionRequired (true, false, or "unknown"), evidenceIds, and warnings. Unknown authority is null, never guessed. Warnings are nonempty strings; empty warning/reference lists are allowed when no evidence is available.

`actionItemSchema` includes id, description, mandatory (true, false, or null), evidenceIds, and optional dependsOnActionIds. Stable IDs are extraction identities, not guarantees of stability across future reanalysis. Completion is user state and deliberately absent: `{"completed":true}` added to an action is rejected. Dependencies must reference existing distinct actions and cannot form cycles.

## Deadlines

`deadlineSchema` is a discriminated union. Every variant includes id, originalText, verificationStatus, and evidenceIds.

- `absolute`: requires normalizedDate in YYYY-MM-DD form. Invalid calendar dates such as 2026-02-29 or 2026-04-31 are rejected. Original text retains whether the instruction says "before", "by", or another boundary; the normalized date alone is not a precise last permissible instant.
- `relative`: requires a positive integer duration with unit days, weeks, months, or years, an anchorEvent, nullable anchorDate, and normalizedDate set to null. Without a receipt date, "within 15 days of receiving this notice" stays relative. Even with a known anchor, deterministic resolution is deferred; AI output cannot set an absolute date on this variant.
- `uncertain`: requires normalizedDate null and a reason. "As soon as possible" stays uncertain. If no deadline language exists, use an empty deadlines array and a warning rather than fabricate original text.

Valid relative example:

```json
{
  "id": "deadline-1",
  "kind": "relative",
  "originalText": "within 15 days of receiving this notice",
  "duration": { "value": 15, "unit": "days" },
  "anchorEvent": "Receipt of this notice",
  "anchorDate": null,
  "normalizedDate": null,
  "verificationStatus": "unverified",
  "evidenceIds": ["e1"]
}
```

Changing normalizedDate to `"2026-10-16"` is invalid. No timezone conversions or date arithmetic run in Phase 1.

## Fees and required documents

`feeSchema` includes id, amount, currency, originalAmountText, description, and evidenceIds. Amount is a nonnegative **decimal string in major currency units**, up to 18 integer and 4 fractional digits, or null. Never use JS float arithmetic. `"10.50"` is valid; numeric `10.5`, `"-1"`, `"1e3"`, and `"01"` are invalid. This representation preserves extracted precision; future payment calculations must use decimal or integer arithmetic and currency-specific rules.

Currency is a runtime-supported ISO 4217 uppercase code or null. INR is valid; XYZ and inr are invalid. Amount and currency may independently be null: a document can state an amount without naming its currency. A non-null amount requires originalAmountText. An explicit no-fee statement is amount `"0"` with its original source text; an unspecified fee is amount null, currency null, originalAmountText null. Nothing coerces null into zero.

`requiredDocumentSchema` contains id, name, nullable description, mandatory (true, false, or null), and evidenceIds. Absence of a known requirement is not proof that no supporting documents are needed; use warnings when instructions are incomplete.

## Analysis and validation layers

`analysisResultStructureSchema` composes id, documentId, modelIdentifier (any nonempty string), analyzedAt, status (completed or partial), summary, actions, deadlines, fees, requiredDocuments, evidence, and warnings. All lists are required, even when empty. Processing attempts that have not produced output use document processing status rather than fabricating a complete analysis. No AI model has generated the manual fixture outputs.

1. Structural validation: parse the structure schema; check formats and object shapes.
2. Semantic consistency: `checkAnalysisConsistency` accepts structurally parsed data and returns paths/messages; `analysisResultSchema` composes both layers. All evidence references must exist; all evidence must belong to the analyzed document; IDs must be unique within each collection; action dependencies must be valid and acyclic.
3. Claim-to-source verification: planned. Phase 3 now provides exact extracted-source location matching. Checking that a quote appears in source text, that its location is correct, and that it actually supports the claim is a separate responsibility. Semantic validation **does not prove factual correctness**. Phase 3 utilities now check physical page bounds against actual normalized pages; future claim verification must use those source checks.

An otherwise structurally valid analysis with `summary.evidenceIds: ["missing"]` fails layer 2 with a path such as `summary.evidenceIds.0`. An evidence record with another documentId also fails. Zod issues contain precise paths; do not expose raw provider inputs or Zod errors containing sensitive document values through public APIs.

## Synthetic fixtures

`src/features/documents/fixtures/synthetic.ts` stores three marked synthetic source strings, fictional file metadata, and manually authored expected analyses. No real government authority or personal data is used. No physical PDF is claimed: metadata byte sizes are fictional. The fixtures cover an explicit municipal deadline, a receipt-relative deadline with unknown receipt date, and an incomplete notice with unknown fee and authority. Evidence stays unverified; tests check fixture quotation transcription without implementing a production verifier.

## Phase 2 experimental extraction

`src/features/ai/contracts.ts` adds a separate strict `extractionSchema`, not a replacement for `analysisResultSchema`. It contains required keys: nullable `documentType`, nonblank `summary`, nullable `requiredAction`, nullable verbatim `deadlineText`, nullable verbatim `feeText`, and `warnings` (up to 20 nonblank strings). Each string caps at 4000 characters. Missing facts use null; no defaults/coercion fabricate values. It has no issuing-authority field: uncertainty about authority belongs in warnings and is reviewed manually in experiment D.

The provider returns only parsed Zod data and separately checks any non-null deadline/fee string occurs verbatim in source. These checks cannot establish factual completeness or truth. A relative deadline remains a string, with no calendar-date calculation. Output never includes user completion state. JSON syntax/schema failures, semantic grounding failures and provider failures remain distinct internally; public errors use sanitized codes/messages. Direct JSON and one whole code fence are accepted; explanatory prose and arbitrary substring extraction are rejected.

## Phase 3 normalized documents and source references

`features/documents/contracts/processing.ts` defines strict Zod input, limits, geometry, segment, page and normalized-document schemas; all domain types are inferred. Ingestion MIME is limited to PDF/PNG/JPEG without changing the broader historical metadata schema. The outcome distinguishes sanitized failure from completed, completed-with-warnings or partial processing. It does not represent AI analysis success.

Documents contain SHA-256 content identity, optional caller source ID, untrusted original filename metadata, detected MIME, ordered pages, warnings and parser/version/duration/statistics. Pages preserve raw parser text and normalized text separately, text-item segments, optional image metadata and explicit extraction/visual-review states. Binary images live in a separate disposable map. Segments have deterministic page/item IDs, exact normalized excerpts, offsets and available PDF transforms/width/height; no invented boxes.

Text source references contain document/page/segment identity, start/end UTF-16 offsets into exact normalized page text, exact excerpt, method, optional geometry and source_matched provenance. Structural schema parsing cannot establish a match: utilities check actual source independently, rejecting foreign/missing locations, altered text, invalid ranges and surrogate splits. Source matching establishes no claim truth and does not promote legacy evidence status. See [document processing](document-processing.md) for exact normalization rules, quality semantics, limitations and adapter lifetime.

Page-only references separately use `page-metadata` / `page_located`, with document ID and physical page number, for images and no-text PDFs. They cannot carry invented excerpts or offsets, and do not assert pixel availability or verified claims.

## Phase 4 extraction and civic analysis

`features/analysis/contracts/analysis.ts` defines a strict AI `extractionResultSchema` separately from the legacy `analysisResultSchema` and the final `civicAnalysisSchema`. Each model claim carries citations as page number, segment ID, and exact excerpt. Final claims retain the Phase 3 source reference (document ID, UTF-16 offsets, exact excerpt, and method), set `sourceReferenceStatus: valid` only after independent matching, set `semanticSupportStatus: unverified`, and require human review. A matching excerpt is not proof of claim support.

`analysisInputSchema` accepts a normalized document, requested language (`en`, `hi`, or `mr`), and an optional trusted reference date/event plus explicit `elapsed_days` semantics. Relative resolution requires the caller event to match the extracted event. Final results distinguish complete page coverage from omitted pages. Visual-only documents are unsupported; documents with omitted or failed pages return partial coverage. A fully covered result with unverified semantic support is `needs_review`. Provider, parse, schema, and evidence failures return typed outcomes and no action plan.

Fee information separately records explicit no-fee language, stated fees, a fee mention with unknown amount, no fee information found, or unclear text. Missing fee information never becomes zero. Deadline objects preserve their source expression and separate explicit, relative, and ambiguous readings. See [AI document intelligence](ai-document-intelligence.md) for limitations and detailed behavior.
