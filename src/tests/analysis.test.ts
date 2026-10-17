import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { processDocument } from "@/features/documents/processing/process-document";
import type { NormalizedDocument } from "@/features/documents/contracts/processing";
import { analyzeDocument } from "@/features/analysis/orchestration/analyze-document";
import { AIError } from "@/features/ai/errors";
import { buildSourceContext } from "@/features/analysis/source-context";
import { interpretDeadline } from "@/features/analysis/deadlines/interpret";
import { MAX_SOURCE_CONTEXT_CHARS } from "@/features/analysis/source-context";
import { MAX_PROMPT_CHARS } from "@/features/ai/contracts";

const files = new URL("../features/documents/fixtures/files/", import.meta.url);
async function document(filename: string): Promise<NormalizedDocument> {
  const result = await processDocument({
    bytes: new Uint8Array(await readFile(new URL(filename, files))),
    originalFilename: filename,
  });
  if (!result.ok) throw new Error(result.error.reason);
  return result.value.document;
}
function response(doc: NormalizedDocument) {
  const segment = doc.pages.find((page) => page.segments.length)?.segments[0];
  if (!segment) throw new Error("fixture has no text segment");
  const evidence = [
    {
      pageNumber: segment.pageNumber,
      segmentId: segment.id,
      excerpt: segment.text,
    },
  ];
  return JSON.stringify({
    detectedLanguage: "en",
    documentType: "synthetic notice",
    summary: { text: "The notice contains the cited text.", evidence },
    issuer: null,
    actions: [
      { description: "Review the cited notice.", mandatory: null, evidence },
    ],
    deadlines: [],
    requiredDocuments: [],
    fees: [],
    consequences: [],
    missingInformation: [],
    uncertainties: [],
  });
}
function documentWithText(doc: NormalizedDocument, text: string) {
  const expanded = structuredClone(doc);
  const page = expanded.pages[0]!;
  const segment = page.segments[0]!;
  page.text = text;
  page.rawText = text;
  page.segments = [{ ...segment, text, start: 0, end: text.length }];
  expanded.metadata.statistics.totalCharacters = text.length;
  return expanded;
}
const providerFor = (text: string) => ({
  generateText: vi.fn(async (prompt: string) => {
    void prompt;
    return {
      text,
      model: "gemma-4-26b-a4b-it",
      modelVersion: null,
      usage: null,
    };
  }),
});

describe("Phase 4 offline analysis", () => {
  it("keeps exact page and segment provenance and labels semantics for review", async () => {
    const doc = await document("municipal.pdf");
    const provider = providerFor(response(doc));
    const result = await analyzeDocument(
      { document: doc },
      { provider, now: () => new Date("2026-10-17T00:00:00Z") },
    );
    expect(result.status).toBe("needs_review");
    if (result.status === "needs_review") {
      expect(result.analysis.summary.sourceReferenceStatus).toBe("valid");
      expect(result.analysis.summary.semanticSupportStatus).toBe("unverified");
      expect(result.analysis.requiredActions).toHaveLength(1);
      expect(result.analysis.coverage.complete).toBe(true);
    }
    expect(provider.generateText).toHaveBeenCalledOnce();
  });
  it("rejects invented excerpts and invalid segment references", async () => {
    const doc = await document("municipal.pdf");
    const bad = JSON.parse(response(doc));
    bad.summary.evidence[0].excerpt = "Fabricated deadline 2039-01-01";
    const result = await analyzeDocument(
      { document: doc },
      { provider: providerFor(JSON.stringify(bad)) },
    );
    expect(result).toMatchObject({
      status: "failed",
      code: "invalid_evidence",
      diagnostic: {
        stage: "evidence_grounding",
        category: "claim_evidence_not_grounded",
      },
    });
  });
  it("returns failure for malformed, schema-invalid, and unavailable provider responses", async () => {
    const doc = await document("municipal.pdf");
    expect(
      await analyzeDocument(
        { document: doc },
        { provider: providerFor("not json") },
      ),
    ).toMatchObject({
      status: "failed",
      code: "invalid_json",
      diagnostic: { stage: "response_parsing", category: "invalid_json" },
    });
    expect(
      await analyzeDocument({ document: doc }, { provider: providerFor("{}") }),
    ).toMatchObject({
      status: "failed",
      code: "invalid_schema",
      diagnostic: {
        stage: "schema_validation",
        category: "extraction_schema_invalid",
      },
    });
    expect(
      await analyzeDocument(
        { document: doc },
        {
          provider: {
            generateText: async () => {
              throw new Error("secret text must not escape");
            },
          },
        },
      ),
    ).toMatchObject({
      status: "failed",
      diagnostic: {
        stage: "provider_request",
        category: "provider_request_failed",
        providerCategory: "unknown_provider_error",
      },
      message:
        "The document could not be analyzed safely. No action plan was produced.",
    });
    expect(
      await analyzeDocument(
        { document: doc },
        {
          provider: {
            generateText: async () => {
              throw new AIError("AI_TIMEOUT");
            },
          },
        },
      ),
    ).toMatchObject({
      status: "failed",
      code: "analysis_timeout",
      diagnostic: {
        stage: "provider_request",
        category: "provider_request_failed",
        providerCategory: "AI_TIMEOUT",
      },
    });
    expect(
      await analyzeDocument(
        { document: doc },
        {
          provider: {
            generateText: async () => {
              throw new AIError("AI_INVALID_OUTPUT", {
                outputFailure: "schema",
              });
            },
          },
        },
      ),
    ).toMatchObject({
      status: "failed",
      code: "provider_failure",
      diagnostic: {
        stage: "provider_request",
        providerCategory: "AI_INVALID_OUTPUT",
      },
    });
  });
  it("rejects visual-only documents and explicitly marks partial text coverage", async () => {
    const image = await document("image-only.pdf");
    expect(
      await analyzeDocument(
        { document: image },
        { provider: providerFor("{}") },
      ),
    ).toMatchObject({ status: "unsupported", code: "unsupported_document" });
    const partial = await document("partial.pdf");
    const result = await analyzeDocument(
      { document: partial },
      { provider: providerFor(response(partial)) },
    );
    expect(result.status).toBe("partial");
    if (result.status === "partial")
      expect(result.analysis.coverage).toMatchObject({
        complete: false,
        omittedPages: [2],
      });
  });
  it("rejects oversized context without truncating it", async () => {
    const doc = await document("municipal.pdf");
    const result = buildSourceContext(doc, 1);
    expect(result).toMatchObject({
      ok: false,
      reason: "too_large",
    });
    if (!result.ok) {
      expect(result.contextLimit).toMatchObject({
        sourceTextChars: doc.metadata.statistics.totalCharacters,
        maximumContextChars: 1,
      });
      expect(result.message).not.toContain(doc.pages[0]!.text);
    }
  });
  it("rejects source text above the safe prompt budget without truncating evidence", async () => {
    const source = await document("municipal.pdf");
    const text = "😀 " + "Ordinary notice text and instructions. ".repeat(500);
    const doc = documentWithText(source, text);
    const context = buildSourceContext(doc);
    expect(context).toMatchObject({ ok: false, reason: "too_large" });
    if (context.ok) return;
    expect(context.contextLimit?.maximumContextChars).toBe(
      MAX_SOURCE_CONTEXT_CHARS,
    );
    expect(context.message).not.toContain(text);
    expect(MAX_PROMPT_CHARS).toBeGreaterThan(MAX_SOURCE_CONTEXT_CHARS);
  });
  it("keeps citation offsets valid for Unicode source text", async () => {
    const source = await document("municipal.pdf");
    const text = "😀 " + "Ordinary notice text and instructions. ".repeat(40);
    const doc = documentWithText(source, text);
    const segment = doc.pages[0]!.segments[0]!;
    const excerpt = text.slice(10, 60);
    const generated = JSON.stringify({
      detectedLanguage: "en",
      documentType: "notice",
      summary: {
        text: "The document contains the cited passage.",
        evidence: [{ pageNumber: 1, segmentId: segment.id, excerpt }],
      },
      issuer: null,
      actions: [],
      deadlines: [],
      requiredDocuments: [],
      fees: [],
      consequences: [],
      missingInformation: [],
      uncertainties: [],
    });
    const result = await analyzeDocument(
      { document: doc },
      { provider: providerFor(generated) },
    );
    expect(result.status).toBe("needs_review");
    if (result.status === "needs_review") {
      expect(result.analysis.summary.evidence[0]).toMatchObject({
        pageNumber: 1,
        segmentId: segment.id,
        start: 10,
        end: 60,
        excerpt,
      });
    }
  });
  it("reports sanitized context sizes and rejects genuinely oversized input without calling the provider", async () => {
    const source = await document("municipal.pdf");
    const text = "Oversized source material. ".repeat(4000);
    const doc = documentWithText(source, text);
    const provider = providerFor(response(doc));
    const result = await analyzeDocument({ document: doc }, { provider });
    expect(result).toMatchObject({
      status: "unsupported",
      code: "input_too_large",
      contextLimit: {
        sourceTextChars: text.length,
        maximumContextChars: MAX_SOURCE_CONTEXT_CHARS,
      },
    });
    expect(provider.generateText).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(text);
  });
  it("enforces the context boundary exactly without truncation", async () => {
    const source = await document("municipal.pdf");
    const doc = documentWithText(source, "boundary text".repeat(100));
    const payload = JSON.stringify(
      doc.pages.flatMap((page) =>
        page.segments.map((segment) => ({
          pageNumber: page.pageNumber,
          segmentId: segment.id,
          text: segment.text,
          extractionMethod: segment.extractionMethod,
          ...(segment.confidence !== undefined
            ? { confidence: segment.confidence }
            : {}),
        })),
      ),
    );
    expect(buildSourceContext(doc, payload.length)).toMatchObject({
      ok: true,
    });
    expect(buildSourceContext(doc, payload.length - 1)).toMatchObject({
      ok: false,
      contextLimit: {
        serializedContextChars: payload.length,
        maximumContextChars: payload.length - 1,
      },
    });
  });
  it("parses only explicit dates and does not resolve relative dates without supplied semantics", () => {
    expect(interpretDeadline("submit by 25 October 2026").explicitDate).toBe(
      "2026-10-25",
    );
    expect(
      interpretDeadline("within 15 days of receiving this notice", "2026-02-20")
        .resolvedDate,
    ).toBeNull();
    expect(
      interpretDeadline("within 15 days of receiving this notice", "2026-02-20")
        .deadlineType,
    ).toBe("relative");
    expect(
      interpretDeadline("within 15 days of receiving this notice", "2026-02-20")
        .relativeDuration,
    ).toEqual({ value: 15, unit: "days" });
    expect(
      interpretDeadline(
        "within 15 days of receiving this notice",
        "2026-02-20",
        "elapsed_days",
      ).resolvedDate,
    ).toBe("2026-03-07");
    expect(interpretDeadline("respond promptly").deadlineType).toBe(
      "ambiguous",
    );
    expect(
      interpretDeadline("submit by 31 February 2026").explicitDate,
    ).toBeNull();
  });
  it("uses output language as a request and preserves adversarial source as quoted data", async () => {
    const doc = await document("injection.pdf");
    const provider = providerFor(response(doc));
    await analyzeDocument(
      { document: doc, requestedOutputLanguage: "hi" },
      { provider },
    );
    const prompt = provider.generateText.mock.calls[0]?.[0] ?? "";
    expect(prompt).toContain("untrusted document content");
    expect(prompt).toContain("CIVIX_SOURCE_DATA");
    expect(prompt).toContain("hi");
    expect(doc.pages[0]!.text).toMatch(/ignore|instruction|system/i);
  });
  it("handles Hindi source text without altering its Unicode evidence", async () => {
    const doc = await document("hindi.pdf");
    const provider = providerFor(response(doc));
    const result = await analyzeDocument(
      { document: doc, requestedOutputLanguage: "mr" },
      { provider },
    );
    expect(result.status).toBe("needs_review");
    if (result.status === "needs_review")
      expect(result.analysis.summary.evidence[0]?.excerpt).toContain(
        doc.pages[0]!.segments[0]!.text,
      );
  });
  it("supports synthetic Marathi source text as a separate output-language request", async () => {
    const doc = await document("marathi.pdf");
    const provider = providerFor(response(doc));
    const result = await analyzeDocument(
      { document: doc, requestedOutputLanguage: "mr" },
      { provider },
    );
    expect(result.status).toBe("needs_review");
    if (result.status === "needs_review") {
      expect(result.analysis.requestedOutputLanguage).toBe("mr");
      expect(result.analysis.summary.evidence[0]?.excerpt).toContain(
        "स्वाक्षरी",
      );
    }
  });
  it("uses cited source text for amount semantics and leaves fee mentions without an amount unknown", async () => {
    const doc = await document("municipal.pdf");
    const feeSegment = doc.pages[0]!.segments.find((item) =>
      /INR\s*10\.50/.test(item.text),
    );
    expect(feeSegment).toBeDefined();
    const raw = JSON.parse(response(doc));
    raw.fees = [
      {
        statement: "Fee: INR 9999",
        evidence: [
          {
            pageNumber: 1,
            segmentId: feeSegment!.id,
            excerpt: feeSegment!.text,
          },
        ],
      },
    ];
    const result = await analyzeDocument(
      { document: doc },
      { provider: providerFor(JSON.stringify(raw)) },
    );
    expect(result.status).toBe("needs_review");
    if (result.status === "needs_review") {
      expect(result.analysis.fees[0]).toMatchObject({
        amount: "10.50",
        currency: "INR",
        semantics: "explicit_amount",
      });
      expect(result.analysis.feeInformationStatus).toBe("stated");
    }

    const multipage = await document("multipage.pdf");
    const mention = multipage.pages[1]!.segments.find((item) =>
      /No fee specified/.test(item.text),
    );
    expect(mention).toBeDefined();
    const unknown = JSON.parse(response(multipage));
    unknown.fees = [
      {
        statement: "No fee is payable",
        evidence: [
          { pageNumber: 2, segmentId: mention!.id, excerpt: mention!.text },
        ],
      },
    ];
    const unknownResult = await analyzeDocument(
      { document: multipage },
      { provider: providerFor(JSON.stringify(unknown)) },
    );
    expect(unknownResult.status).toBe("needs_review");
    if (unknownResult.status === "needs_review") {
      expect(unknownResult.analysis.fees[0]).toMatchObject({
        amount: null,
        currency: null,
        semantics: "mentioned_amount_unknown",
      });
      expect(unknownResult.analysis.feeInformationStatus).toBe(
        "mentioned_amount_unknown",
      );
    }
  });
  it("resolves relative deadlines only when trusted date and day semantics are both supplied", async () => {
    const doc = await document("municipal.pdf");
    const segment = doc.pages[0]!.segments.find((item) =>
      /15 days of receipt/.test(item.text),
    );
    expect(segment).toBeDefined();
    const raw = JSON.parse(response(doc));
    raw.deadlines = [
      {
        expression: "within 15 days of receipt",
        evidence: [
          { pageNumber: 1, segmentId: segment!.id, excerpt: segment!.text },
        ],
      },
    ];
    const baseInput = {
      document: doc,
      trustedReferenceDate: "2026-02-20",
      trustedReferenceEvent: "receipt",
    };
    const unresolved = await analyzeDocument(baseInput, {
      provider: providerFor(JSON.stringify(raw)),
    });
    expect(unresolved.status).toBe("needs_review");
    if (unresolved.status === "needs_review")
      expect(unresolved.analysis.deadlines[0]?.resolvedDate).toBeNull();
    const resolved = await analyzeDocument(
      { ...baseInput, relativeDeadlineSemantics: "elapsed_days" },
      { provider: providerFor(JSON.stringify(raw)) },
    );
    expect(resolved.status).toBe("needs_review");
    if (resolved.status === "needs_review")
      expect(resolved.analysis.deadlines[0]?.resolvedDate).toBe("2026-03-07");
    const mismatched = await analyzeDocument(
      {
        ...baseInput,
        trustedReferenceEvent: "document issue",
        relativeDeadlineSemantics: "elapsed_days",
      },
      { provider: providerFor(JSON.stringify(raw)) },
    );
    expect(mismatched.status).toBe("needs_review");
    if (mismatched.status === "needs_review")
      expect(mismatched.analysis.deadlines[0]?.resolvedDate).toBeNull();
  });
});
