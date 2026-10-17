import { mkdir, readFile, writeFile } from "node:fs/promises";
import { processDocument } from "../../src/features/documents/processing/process-document";
import {
  createEvidenceReference,
  validateEvidenceReference,
} from "../../src/features/documents/evidence/references";
const cases = [
  ["municipal.pdf", true],
  ["multipage.pdf", true],
  ["blank.pdf", true],
  ["image-only.pdf", true],
  ["notice.png", true],
  ["notice.jpg", true],
  ["oriented.jpg", true],
  ["hindi.pdf", true],
  ["marathi.pdf", true],
  ["hindi.png", true],
  ["injection.pdf", true],
  ["partial.pdf", true],
  ["empty.pdf", false],
  ["malformed.pdf", false],
  ["encrypted.pdf", false],
  ["truncated.jpg", false],
  ["mismatch.pdf", false],
  ["page-limit.pdf", false],
] as const;
if (process.argv.length !== 2)
  throw new Error(
    "Only bundled synthetic fixtures are supported; no arguments accepted.",
  );
const reports = [];
let unexpected = 0;
for (const [filename, expected] of cases) {
  const bytes = new Uint8Array(
    await readFile(
      new URL(
        `../../src/features/documents/fixtures/files/${filename}`,
        import.meta.url,
      ),
    ),
  );
  const result = await processDocument({ bytes, originalFilename: filename });
  let evidenceValid = true;
  if (result.ok)
    for (const page of result.value.document.pages)
      for (const segment of page.segments)
        evidenceValid &&= validateEvidenceReference(
          result.value.document,
          createEvidenceReference(
            result.value.document,
            page.pageNumber,
            segment.id,
          ),
        );
  const passed =
    result.ok === expected &&
    evidenceValid &&
    (!result.ok ||
      filename !== "partial.pdf" ||
      result.value.document.status === "partial");
  if (!passed) unexpected++;
  const row = {
    fixture: filename,
    passed,
    expectedSuccess: expected,
    evidenceValid,
    ...(result.ok
      ? {
          status: result.value.document.status,
          pages: result.value.document.pageCount,
          extractionStatuses: result.value.document.pages.map(
            (p) => p.extractionStatus,
          ),
          warnings: result.value.document.warnings,
          statistics: result.value.document.metadata.statistics,
          parser: result.value.document.metadata.parser,
          libraryVersion: result.value.document.metadata.libraryVersion,
        }
      : { error: result.error }),
  };
  reports.push(row);
  console.log(
    `${passed ? "PASS" : "FAIL"} ${filename}: ${result.ok ? `${result.value.document.pageCount} page(s), ${result.value.document.pages.map((p) => p.extractionStatus).join(",")}; warnings=${result.value.document.warnings.join(",") || "none"}` : result.error.reason}`,
  );
  if (result.ok) result.value.dispose();
}
await mkdir(".local-reports", { recursive: true, mode: 0o700 });
await writeFile(
  ".local-reports/documents-verify.json",
  JSON.stringify(
    { syntheticOnly: true, networkRequests: 0, unexpected, reports },
    null,
    2,
  ) + "\n",
  { mode: 0o600 },
);
console.log(
  `${cases.length} synthetic cases; ${unexpected} unexpected failures. Sanitized report: .local-reports/documents-verify.json`,
);
process.exitCode = unexpected ? 1 : 0;
