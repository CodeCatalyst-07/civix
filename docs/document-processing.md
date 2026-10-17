# Phase 3 and Phase 6 document processing

Civix has offline, server-only PDF/PNG/JPEG ingestion, extraction, normalization and source-location matching, plus conservative document classification and optional local OCR for images. No uploaded bytes are persisted. Documents, OCR text, filenames and instruction-like text are untrusted data.

## Phase 6 classification and OCR

Classification uses conservative textual cues and returns an explicit unknown category when evidence is weak. It distinguishes notices, departmental letters, application or verification requests, schemes, certificates or records, circulars and notifications. Utility-bill cues suppress government classification. Extracted title, issuer, reference number, date, recipient and purpose remain nullable. Every result says `authenticity: not_verified`; classification is not government verification.

Image OCR uses the free local Tesseract 5 command line engine when available. Install Tesseract and English, Hindi (`hin`) and Marathi (`mar`) trained data on the host. On Debian/Ubuntu: `sudo apt install tesseract-ocr tesseract-ocr-eng tesseract-ocr-hin tesseract-ocr-mar`. On macOS, install `tesseract` with Homebrew and confirm the three language packs appear in `tesseract --list-langs`. `CIVIX_TESSERACT_PATH` can point to a nonstandard executable. The process uses stdin/stdout only; source images are not written to disk or sent to OCR services. The isolated parser caps output, time, input pixels and worker memory. A missing binary or language model is reported as a page warning.

Tesseract word boxes and confidence scores become OCR segments with image-pixel coordinates, page identity, UTF-16 offsets and exact excerpts. These references prove only that an excerpt matches the OCR text buffer; they do not prove the reading matches the image. Low confidence is flagged for review. The current workspace did not have Tesseract installed, so OCR execution was not verified here. PDF.js extracts selectable PDF text, but this checkout has no PDF raster backend; image-only PDF pages are marked unreadable with `PDF_PAGE_RENDERER_UNAVAILABLE` and omitted pages make analysis partial or unsupported. Install and package a bounded PDF renderer before claiming scanned-PDF coverage.

The complete serialized source context is rejected above 18,000 characters to stay within the Gemma provider's 20,000-character prompt cap after fixed instructions. Civix never silently truncates pages. A larger document receives an explicit limit error.

## Pipeline and contracts

`processDocument(input, limits?)` in `src/features/documents/processing/process-document.ts` accepts a `Uint8Array`, original filename metadata, optional declared MIME and optional internal source ID. It returns a discriminated outcome: `ok: false` with a whitelisted AppError public message and fixed reason, or `ok: true` with a validated document, an in-memory binary map and `dispose()`.

Input validation checks size before copying, signatures, format-specific terminal markers, declared MIME (if supplied), and filename extension consistency. Missing/unsupported extensions and mismatched declared types are rejected; extension checks supplement decoding, never replace it. PDFs require a leading PDF header and terminal EOF, PNG a signature and IEND, and JPEG SOI/EOI. Actual PDF.js parsing or full strict sharp decoding follows. This intentionally rejects some permissively readable files with trailing data. It is not a general polyglot detector or malware scanner.

The bounded byte snapshot is SHA-256 hashed; the resulting document ID is deterministic for identical bytes. `sourceId` is separate caller metadata. Filenames are never paths, executable commands, IDs or log messages. The source identifier and filename remain untrusted metadata and must be escaped if later displayed. Content hashes reveal equality and must not become public access tokens.

The disposable parser process receives bytes and validated limits over advanced Node IPC. It imports PDF.js or sharp, never the Google SDK. It has no application credentials or inherited NODE_OPTIONS, no source-derived paths and no remote input API. `fetch` is disabled; no document URL, embedded script, XFA execution or attachment execution is requested. Standard PDF fonts are read only from the installed package. There are no temporary document files or raw-document writes. The parent validates the IPC shape, constructs and validates the normalized contract, then returns it.

## Limits and isolation

All settings are validated by `limitsSchema`; callers may lower limits up to the fixed ceilings. No environment variables or secrets are needed.

| Setting                                  | Default              | Ceiling    |
| ---------------------------------------- | -------------------- | ---------- |
| Input bytes                              | 10 MiB               | 10 MiB     |
| PDF pages                                | 20                   | 20         |
| Image side                               | 8,000 px             | 8,000 px   |
| Decoded input pixels                     | 20 million           | 20 million |
| Extracted text, including raw whitespace | 200,000 UTF-16 units | 200,000    |
| Parser deadline including child startup  | 15 seconds           | 30 seconds |
| Normalized PNG bytes                     | 10 MiB               | 10 MiB     |
| Normalized longest side                  | 3,000 px             | 4,000 px   |

These are conservative development budgets for civic notices, not universal production recommendations. PDF text is consumed in chunks with an aggregate character budget and at most 50,000 text items per page. Output byte checks occur after bounded pixel-based encoding; they do not prevent the encoder allocating its output buffer. Sharp validates header dimensions before full decoding and enforces its decoder pixel limit as well. Resizing preserves aspect ratio, never crops or enlarges.

One child per application process is allowed, with no queue. Excess work returns `PROCESSOR_BUSY`. A real SIGKILL terminates parsing on success, failure or timeout, and the parent awaits child closure before releasing capacity. This handles synchronous CPU loops and native decoder hangs, unlike a Promise race alone. The child has a 192 MiB V8 old-space limit. **That limit does not cap native allocations, all process RSS or operating-system resources.** Input/output/pixel/page limits reduce exposure but do not replace OS resource isolation. A future public service needs OS memory/CPU quotas, abuse controls and deployment-specific isolation. This is not an OS security sandbox. Parent validation, hashing and final schema checks are small bounded synchronous work outside the parser deadline.

## PDF behavior

PDF.js `pdfjs-dist` 6.3.289 is pinned through its registry tarball and lockfile because cached tarball access was available while package metadata/DNS was unreliable. Its declared Node support is `>=22.13.0 || >=24`; this repository targets Node 24. It includes TypeScript declarations and runs as JavaScript on Apple Silicon. Tests run the actual legacy Node build in an isolated process. No Poppler or system binaries are used. Bundled standard fonts support base-font extraction without system font lookups. Optional canvas installation is not required for the implemented text path.

Pages retain one-based physical order, raw parser text, conservatively normalized text and stable ordered text-item segment IDs. Item transforms, widths and heights are preserved when returned by the parser. Geometry is explicitly PDF user space, not browser pixels, axis-aligned highlight boxes or a promise of glyph-perfect layout. No coordinates are invented. Metadata currently retains only an available title, truncated to 1,000 characters; author/device metadata is not copied.

Encrypted documents, including permission-protected documents readable with an empty password, are rejected. There is no password input or unlock workflow. Fatal structural errors fail the operation. Page extraction errors retain other pages and mark the result partial; if every page fails, processing fails. PDF.js can recover some malformed structures: captured warnings are generic fixed codes, and page warnings make extraction incomplete rather than asserting accuracy. Its raw diagnostics are suppressed to prevent source leakage.

A nonempty page gets `text_extracted`; fewer than 40 normalized characters also produces `LOW_TEXT_QUANTITY` and requests visual review. This is a routing heuristic, not proof of scanning or semantic quality. A page without text gets `visual_processing_required`, not a claim that its visible contents are empty. Blank, scanned, vector-only and image-only pages cannot reliably be distinguished from selectable text alone. No OCR text is fabricated. Failed pages get `extraction_failed`.

PDF rendering is **pending**, exposed honestly as `available: false` by `pdf/rendering.ts`. No PNG page rendering, resolution or memory guarantees are claimed. Adding native canvas and a reliable bounded renderer is deferred rather than introducing a fragile path. Thus scanned PDFs have no image buffers for Gemma yet.

## Images

Sharp 0.35.5 is a direct dependency (already present transitively before Phase 3), with native macOS ARM64 support documented upstream. PNG and JPEG header metadata is inspected, oversized or multi-frame images are rejected, then full decoding runs with `failOn: warning`. EXIF orientation is applied, aspect ratio preserved and output encoded losslessly as PNG without metadata retention. This avoids further JPEG compression of text; existing JPEG loss cannot be reversed. Resizing can still reduce readability and produces `IMAGE_RESIZED`. There is no crop, enhancement, OCR or interpretation.

Image metadata records original detected format and pre-orientation dimensions, normalized dimensions, PNG MIME and byte length. GPS/device EXIF, XMP and ICC metadata are not copied. Image pages may contain local OCR text; absent OCR remains absent rather than inferred. Binary data is separate from the JSON document in `Map<pageNumber, Uint8Array>`. Call `dispose()` when finished: it zeroes returned buffers and clears the map. Borrowed adapter views expire at disposal. Immutable JS text, library intermediates and caller-owned inputs cannot be securely erased by this API; release references promptly. The service does not persist them.

## Text and evidence

Normalization is exactly: NFC Unicode composition; CRLF/CR to LF; runs of ASCII space, tab and NBSP to one ASCII space; remove spaces adjacent to line breaks; cap repeated line breaks at two; trim page edges. No translation, date conversion, currency conversion, punctuation removal or legal rewriting occurs. Page boundaries never merge. `rawText` retains the parser's concatenated text items with its line endings and inserted item separators; it is not original PDF byte text or a visual reading-order guarantee.

Offsets are **UTF-16 code units, zero-based, start-inclusive and end-exclusive, into the exact normalized page text**. They are not byte, code-point, raw-text or original-file offsets. Each normalized item is located monotonically in that page text; if a location cannot be established it is omitted with `ITEM_POSITION_UNAVAILABLE`. Raw-to-normalized offsets are not asserted. IDs use content hash, physical page and item order; parser/version changes can change segmentation.

`createPageEvidenceReference` provides a separate strict `page-metadata` / `page_located` reference for physical page identity, including images and no-text PDFs. It has no excerpt, offsets or OCR claim and does not assert that PDF page pixels are available. `evidenceReferenceSchema` accepts this or the text reference, and validation checks real page existence.

`createEvidenceReference` finds an actual segment and copies its exact excerpt, offsets, method and optional geometry. `validatePageReference`, `retrieveExcerpt`, and `validateEvidenceReference` reject missing pages/segments, foreign documents, out-of-range or fractional offsets, surrogate-pair splits, altered excerpts and mismatched geometry. Missing or invalid references yield false/null or a fixed error when creating one. The strict Zod reference schema records `source_matched` only for this location check. Anyone receiving serialized references must rerun validation against the document; a stored label alone establishes nothing.

**Source matching does not verify the civic claim, document authenticity, issuer, extraction fidelity or completeness.** The Phase 1 analysis/evidence contracts are preserved. Their broader WebP metadata support is historical contract scope; Phase 3 ingestion intentionally supports only PDF/PNG/JPEG. Phase 4 matches its own extracted claims to source locations but keeps semantic support unverified; it does not transition Phase 1 verification states.

Quality assessment counts pages with text, visual review pages, failed/no-text pages, normalized characters and parser completion, with deterministic flags. `complete` means no observed page extraction failure/warning, not that every visible word was extracted. There is no semantic confidence score. No-text counts are not counts of visibly empty pages.

## Capability distinctions and Phase 4 boundary

- Text extraction reads an existing PDF text layer; it can have ordering/font mapping errors.
- Local Tesseract recognizes text from normalized image pixels when the engine and all three language packs are installed. PDF page rasterization is not implemented in this checkout.
- Multimodal image understanding would send pixels to Gemma. Phase 3 performs no such calls, and Phase 2 image capability remains unverified live.
- AI interpretation would explain obligations or generate actions. It is outside Phase 3.
- Source verification matches quotations/locations and eventually checks claim support. The implemented locator validates exact source matches only.

`toAnalysisInput` supplies document/page identities, normalized page text, source references, warnings and borrowed PNG bytes where available. It creates no prompt and invokes no provider. Analysis source JSON is capped at 18,000 characters, leaving room under the provider's 20,000-character full-prompt limit; it is rejected without truncation. The image provider limit remains 2 MiB. Scanned PDF rendering, local engine availability and live structured/image reliability remain readiness gaps. All document instructions stay untrusted.

## Offline verification and fixtures

```bash
nvm use
npm ci
npm test
npm run documents:verify
npm run lint
npm run typecheck
npm run format:check
npm run build
```

`documents:verify` accepts no paths or arguments. It processes only 18 bundled fictional cases sequentially, checks segment references, reports expected rejection separately from failures and exits nonzero on unexpected results. It saves only fixture names, counts, statuses, generic warnings, parser versions and evidence-check results to ignored `.local-reports/documents-verify.json` (mode 0600; directory requested as 0700). No document text, original bytes, normalized buffers, metadata titles, arbitrary user files or credentials enter reports. It loads no environment file and makes no AI/network calls.

`npm test` includes real PDF and image integration tests as well as units; the whole offline suite is fast enough to run together. API keys are unnecessary. Fixtures cover municipal/relative-deadline text, distinct pages, true image-only PDF, blank/zero-page documents, Hindi and Marathi selectable text, injection text, PNG/JPEG, orientation, malformed and partially damaged PDFs, encryption, truncation, mismatch and page limits. Lowered budgets test byte, text, dimension, pixel, output and deadline limits without committing huge documents.

Regenerate ordinary fixtures with `npm run documents:fixtures`. Generation uses sharp and a tiny **fixture-only writer**, never a custom production parser. English PDF bytes are deterministic; raster bytes are reproducible with the same sharp/libvips/font environment. The Hindi fixture uses macOS's available Kohinoor Devanagari system font to render pixels, with explicit invisible Unicode mappings for selectable text; no proprietary font binary is copied. Its PNG was visually inspected and its actual PDF extraction tested. Raster generation on another OS requires an appropriately licensed Devanagari font and visual inspection; it must not silently be accepted with missing glyphs. These fixtures do not prove arbitrary multilingual font/layout fidelity. The PDF's image/text correspondence is synthetic construction, not OCR.

Optional encrypted-fixture regeneration: `python3 scripts/documents/generate-encrypted.py` requires development-only `pypdf`; it is not an application/runtime dependency. Fixed IDs/password and obsolete RC4 deliberately create a deterministic rejection fixture, never security for real storage. The checked-in fixture needs no Python to test. Font binaries and external PDF generation tools are not required to consume bundled fixtures.

## Dependency security and compatibility evidence

Sources reviewed: [Mozilla PDF.js](https://github.com/mozilla/pdf.js), [Node examples](https://mozilla.github.io/pdf.js/examples/index.html), [sharp installation](https://sharp.pixelplumbing.com/install/) and [sharp security](https://sharp.pixelplumbing.com/security/). Installed Next.js serverExternalPackages guidance was read; sharp is automatically externalized. Server-only guards protect orchestration/isolation imports. No parser is imported by the application or a client bundle; the current production build remains the shell/health routes. Future Next.js endpoints need explicit tracing/packaging of `scripts/documents/parser.mjs`, PDF.js assets and sharp native binaries; that runtime path has not been verified inside a deployed Next.js server.

The selected PDF.js version is beyond the patched versions documented for [CVE-2024-4367](https://github.com/mozilla/pdf.js/security/advisories/GHSA-wgrm-67xf-hhpq) (4.2.67) and [CVE-2026-16633](https://github.com/mozilla/pdf.js/security/advisories/GHSA-hq66-cqwq-w95j) (6.2.108). The latter advisory's affected-range wording is broader than its patched-version field; this is not a claim of a completed vulnerability clearance. No viewer/scripting manager is used, eval support is disabled and uploaded PDF actions are never invoked.

Fresh `npm audit --json` failed with registry `ENOTFOUND`, both before/after dependency selection attempts. Earlier five high advisories could not be classified as production or development, and remain unresolved. Offline npm installation printed zero vulnerabilities, but that is **not an authoritative audit**. No audit fix/force or broad dependency upgrade was applied. Rerun `npm audit` and `npm audit --omit=dev` with registry connectivity before public ingestion. Native decoder vulnerabilities and OS resource controls remain part of future operational review.

## Recorded validation (17 October 2026)

Final checks on Node 24.22.0: `npm test` passed 234 tests across eight files (all 195 existing cases preserved); `npm run documents:verify` passed 17 expected outcomes with zero unexpected failures; lint, typecheck, format checking and production build passed. The route listing remained `/`, `/_not-found`, `/api/health`. Regenerating all 17 fixture files, including the optional encrypted fixture, produced identical SHA-256 hashes on this Mac. These are offline processing results, not live Gemma capability tests. No Git metadata exists in this workspace, so a Git diff was unavailable.
