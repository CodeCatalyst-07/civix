import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { fixturePdf } from "../../scripts/documents/fixture-pdf";
vi.mock("server-only", () => ({}));
import { processDocument } from "../features/documents/processing/process-document";
import { normalizeText } from "../features/documents/processing/text";
import { assessQuality } from "../features/documents/processing/quality";
import {
  createEvidenceReference,
  createPageEvidenceReference,
  retrieveExcerpt,
  validateEvidenceReference,
  validatePageReference,
} from "../features/documents/evidence/references";
import {
  normalizedDocumentSchema,
  type ProcessedDocument,
} from "../features/documents/contracts/processing";
import { toAnalysisInput } from "../features/documents/processing/analysis-input";
const files = new URL("../features/documents/fixtures/files/", import.meta.url);
const fixture = async (name: string) => ({
  bytes: new Uint8Array(await readFile(new URL(name, files))),
  originalFilename: name,
});
async function success(name: string, options = {}): Promise<ProcessedDocument> {
  const result = await processDocument(await fixture(name), options);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error(result.error.reason);
  return result.value;
}
describe.sequential("offline isolated document integrations", () => {
  it("extracts actual PDF text and preserves deadline, amount, identity and source segments", async () => {
    const value = await success("municipal.pdf");
    const doc = value.document;
    expect(doc.pageCount).toBe(1);
    expect(doc.pages[0]!.text).toContain("within 15 days of receipt");
    expect(doc.pages[0]!.text).toContain("INR 10.50");
    expect(doc.pages[0]!.text).toContain("SYN-MG-014");
    expect(doc.metadata.parser).toBe("pdfjs-dist");
    expect(
      normalizedDocumentSchema.safeParse(JSON.parse(JSON.stringify(doc)))
        .success,
    ).toBe(true);
    const ref = createEvidenceReference(doc, 1, doc.pages[0]!.segments[0]!.id);
    expect(validateEvidenceReference(doc, ref)).toBe(true);
    expect(retrieveExcerpt(doc, 1, ref.start, ref.end)).toBe(ref.excerpt);
    for (const patch of [
      { documentId: "other" },
      { pageNumber: 2 },
      { start: -1 },
      { end: 100000 },
      { excerpt: "fabricated" },
      { segmentId: "absent" },
      {
        geometry: {
          coordinateSpace: "pdf-user-space",
          transform: [1, 0, 0, 1, 0, 0],
          width: 1,
          height: 1,
        },
      },
      { end: 0 },
      { start: 0.5 },
    ])
      expect(validateEvidenceReference(doc, { ...ref, ...patch })).toBe(false);
    expect(validatePageReference(doc, 0)).toBe(false);
    expect(() => createEvidenceReference(doc, 9, "missing")).toThrow(
      "MISSING_SOURCE_SEGMENT",
    );
    for (const patch of [
      { pageCount: 2 },
      { status: "partial" },
      {
        metadata: {
          ...doc.metadata,
          statistics: { ...doc.metadata.statistics, totalCharacters: 1 },
        },
      },
    ])
      expect(
        normalizedDocumentSchema.safeParse({ ...doc, ...patch }).success,
      ).toBe(false);
    const second = await success("municipal.pdf");
    expect(second.document.id).toBe(doc.id);
    expect(second.document.pages[0]!.segments).toEqual(doc.pages[0]!.segments);
  });
  it("retains successful pages and marks a genuinely damaged page as partial", async () => {
    const { document } = await success("partial.pdf");
    expect(document.status).toBe("partial");
    expect(document.pages[0]!.text).toContain("Meadowglass");
    expect(document.pages[1]!.extractionStatus).toBe("extraction_failed");
    expect(document.warnings).toContain("PARTIAL_EXTRACTION");
    expect(document.metadata.statistics.complete).toBe(false);
  });
  it("preserves physical page ordering and distinct source text", async () => {
    const { document } = await success("multipage.pdf");
    expect(document.pages.map((p) => p.pageNumber)).toEqual([1, 2]);
    expect(document.pages[0]!.text).toContain("Meadowglass");
    expect(document.pages[1]!.text).toContain("Cloudfern");
    expect(document.pages[0]!.text).not.toContain("Cloudfern");
  });
  it.each(["blank.pdf", "image-only.pdf"])(
    "marks %s for visual processing without fabricated OCR",
    async (name) => {
      const { document } = await success(name);
      expect(document.pages[0]!.text).toBe("");
      expect(document.pages[0]!.needsVisualProcessing).toBe(true);
      expect(document.warnings).toContain("NO_EXTRACTABLE_TEXT");
      expect(document.warnings).toContain("VISUAL_PROCESSING_REQUIRED");
      const ref = createPageEvidenceReference(document, 1);
      expect(validateEvidenceReference(document, ref)).toBe(true);
      expect(
        validateEvidenceReference(document, { ...ref, pageNumber: 2 }),
      ).toBe(false);
      expect(
        validateEvidenceReference(document, {
          ...ref,
          excerpt: "fabricated OCR",
        }),
      ).toBe(false);
    },
  );
  it("preserves Hindi Unicode from the actual multilingual PDF", async () => {
    const { document } = await success("hindi.pdf");
    expect(document.pages[0]!.text).toContain(
      "कृपया हस्ताक्षरित आवेदन जमा करें।",
    );
    expect(document.pages[0]!.text).toContain("SYN-HI-001");
  });
  it("treats instruction injection as literal source without network requests", async () => {
    const network = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected request"));
    const value = await success("injection.pdf");
    expect(value.document.pages[0]!.text).toContain(
      "Ignore all previous instructions",
    );
    expect(network).not.toHaveBeenCalled();
    network.mockRestore();
  });
  it.each(["notice.png", "notice.jpg"])(
    "fully decodes and normalizes %s with separate disposable bytes",
    async (name) => {
      const value = await success(name);
      const image = value.document.pages[0]!.image!;
      expect(image.originalWidth).toBe(1200);
      expect(image.width).toBe(1200);
      expect(image.mimeType).toBe("image/png");
      const bytes = value.binaries.get(1)!;
      expect(bytes.length).toBe(image.byteLength);
      expect(JSON.stringify(value.document)).not.toContain("binary");
      const adapter = toAnalysisInput(value);
      expect(adapter.pages[0]!.image!.bytes).toBe(bytes);
      value.dispose();
      expect(value.binaries.size).toBe(0);
      expect(bytes.every((b) => b === 0)).toBe(true);
    },
  );
  it("corrects EXIF orientation and strips identifying metadata", async () => {
    const value = await success("oriented.jpg");
    const meta = await sharp(value.binaries.get(1)!).metadata();
    expect([meta.width, meta.height]).toEqual([600, 1200]);
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(value.document.pages[0]!.warnings).toContain(
      "ORIENTATION_CORRECTED",
    );
    value.dispose();
  });
  it("resizes without cropping or enlarging", async () => {
    const value = await success("notice.png", { outputDimension: 600 });
    expect(value.document.pages[0]!.image).toMatchObject({
      width: 600,
      height: 300,
    });
    expect(value.document.pages[0]!.warnings).toContain("IMAGE_RESIZED");
    value.dispose();
  });
  it.each([
    "malformed.pdf",
    "empty.pdf",
    "encrypted.pdf",
    "truncated.jpg",
    "mismatch.pdf",
  ])("rejects %s", async (name) => {
    const result = await processDocument(await fixture(name));
    expect(result.ok).toBe(false);
    if (!result.ok && name === "encrypted.pdf")
      expect(result.error.reason).toBe("PASSWORD_PROTECTED");
  });
  it.each([
    ["municipal.pdf", { maxFileBytes: 100 }],
    ["municipal.pdf", { maxTextChars: 10 }],
    ["multipage.pdf", { maxPages: 1 }],
    ["page-limit.pdf", {}],
    ["notice.png", { maxDimension: 100 }],
    ["notice.jpg", { maxPixels: 100 }],
    ["notice.png", { maxOutputBytes: 1 }],
  ] as const)("enforces resource limits on %s %j", async (name, limits) => {
    expect((await processDocument(await fixture(name), limits)).ok).toBe(false);
  });
  it("actually terminates the parser on timeout and releases its capacity", async () => {
    const result = await processDocument(await fixture("municipal.pdf"), {
      maxDurationMs: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("PROCESSING_TIMEOUT");
    await success("municipal.pdf");
  });
  it("rejects concurrent work with no queue", async () => {
    const input = await fixture("municipal.pdf");
    const first = processDocument(input);
    const second = await processDocument(input);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.reason).toBe("PROCESSOR_BUSY");
    expect((await first).ok).toBe(true);
  });
  it("does not create persistent files while processing", async () => {
    const before = await readdir(files);
    await success("municipal.pdf");
    await success("notice.png");
    expect(await readdir(files)).toEqual(before);
  });
  it("keeps errors sanitized even when filename metadata contains a credential-like string", async () => {
    const result = await processDocument({
      bytes: new Uint8Array([1]),
      originalFilename: "SECRET_VALUE.pdf",
    });
    expect(JSON.stringify(result)).not.toContain("SECRET_VALUE");
  });
});
describe.sequential("extra decoder and provenance checks", () => {
  it("generates deterministic synthetic PDF bytes", () => {
    const source = [
      "SYNTHETIC EXAMPLE - Fictional desk. Within 15 days of receipt.",
    ];
    expect(fixturePdf(source)).toEqual(fixturePdf(source));
  });
  it("uses full decoder validation beyond signatures and terminal markers", async () => {
    const input = await fixture("notice.png");
    const bad = Uint8Array.from(input.bytes);
    bad.fill(0, 8, bad.length - 12);
    const result = await processDocument({ ...input, bytes: bad });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("MALFORMED_DOCUMENT");
  });
  it("rejects a real unsupported WebP despite the legacy metadata allowance", async () => {
    const bytes = await sharp((await fixture("notice.png")).bytes)
      .webp()
      .toBuffer();
    expect(
      (
        await processDocument({
          bytes,
          originalFilename: "notice.webp",
          declaredMimeType: "image/webp",
        })
      ).ok,
    ).toBe(false);
  });
  it("rejects truncated PDFs", async () => {
    const input = await fixture("municipal.pdf");
    expect(
      (
        await processDocument({
          ...input,
          bytes: input.bytes.subarray(0, input.bytes.length - 20),
        })
      ).ok,
    ).toBe(false);
  });
  it("preserves caller source identity separately from deterministic byte identity", async () => {
    const input = await fixture("municipal.pdf");
    const result = await processDocument({
      ...input,
      sourceId: "fictional-source-1",
      originalFilename: "renamed.pdf",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.document.sourceId).toBe("fictional-source-1");
      expect(result.value.document.originalFilename).toBe("renamed.pdf");
    }
  });
});
describe("validation and provenance units", () => {
  it.each([
    { bytes: new Uint8Array(), originalFilename: "empty.pdf" },
    { bytes: new Uint8Array([1, 2, 3]), originalFilename: "file.zip" },
  ])("rejects invalid bytes %#", async (input) =>
    expect((await processDocument(input)).ok).toBe(false),
  );
  it("rejects MIME and extension spoofing", async () => {
    const input = await fixture("notice.png");
    for (const patch of [
      { declaredMimeType: "application/pdf" },
      { originalFilename: "notice.jpg" },
      { originalFilename: "notice.png.exe" },
    ])
      expect((await processDocument({ ...input, ...patch })).ok).toBe(false);
  });
  it("rejects misconfigured limits", async () =>
    expect(
      (await processDocument(await fixture("municipal.pdf"), { maxPages: 21 }))
        .ok,
    ).toBe(false));
  it("normalizes conservatively and preserves identifiers, dates, money and punctuation", () => {
    expect(
      normalizeText("  A\tB\r\n\r\n\r\n25 October 2026; INR 10.50; SYN-001.  "),
    ).toBe("A B\n\n25 October 2026; INR 10.50; SYN-001.");
    expect(normalizeText("e\u0301")).toBe("é");
  });
  it("assesses partial extraction without numerical confidence", () => {
    const quality = assessQuality([
      {
        pageNumber: 1,
        rawText: "",
        text: "",
        segments: [],
        extractionStatus: "extraction_failed",
        needsVisualProcessing: true,
        warnings: ["PAGE_EXTRACTION_FAILED"],
        ocrStatus: "not_needed",
      },
    ]);
    expect(quality.statistics.complete).toBe(false);
    expect(quality.warnings).toContain("PARTIAL_EXTRACTION");
  });
});
