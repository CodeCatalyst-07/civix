import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readFile } from "node:fs/promises";
import { processDocument } from "@/features/documents/processing/process-document";
import { analyzeDocument } from "@/features/analysis/orchestration/analyze-document";
import { createSyntheticProvider } from "@/features/analysis/mock-provider";
import { isSyntheticModeEnabled } from "@/features/analysis/mock-mode";
import { POST } from "@/app/api/analyze/route";
import type { NormalizedDocument } from "@/features/documents/contracts/processing";
import { fixturePdf } from "../../scripts/documents/fixture-pdf";

describe("Phase 5 analysis workflow", () => {
  it("enables synthetic results only with the explicit development flag", () => {
    expect(
      isSyntheticModeEnabled({
        NODE_ENV: "development",
        CIVIX_MOCK_ANALYSIS: "true",
      }),
    ).toBe(true);
    expect(
      isSyntheticModeEnabled({
        NODE_ENV: "production",
        CIVIX_MOCK_ANALYSIS: "true",
      }),
    ).toBe(false);
    expect(isSyntheticModeEnabled({ NODE_ENV: "development" })).toBe(false);
  });

  it("returns a safe validation response for a missing file", async () => {
    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        body: new FormData(),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      status: "failed",
      error: { code: "FILE_REQUIRED" },
    });
  });

  it("processes a PDF through the development-only mock route", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CIVIX_MOCK_ANALYSIS", "true");
    const bytes = await readFile(
      new URL(
        "../features/documents/fixtures/files/municipal.pdf",
        import.meta.url,
      ),
    );
    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array(bytes)], "municipal.pdf", {
        type: "application/pdf",
      }),
    );
    form.set("language", "en");
    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        body: form,
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      synthetic: true,
      status: "needs_review",
      analysis: { analysisStatus: "needs_review" },
    });
  });

  it("returns government classification and page-bound citations for a text PDF", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CIVIX_MOCK_ANALYSIS", "true");
    const bytes = fixturePdf([
      "PUBLIC NOTICE. Issued by: Fictional Meadowglass Municipal Office. Reference SYN-GOV-024. Submit the signed form within 15 days of receipt.",
    ]);
    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array(bytes)], "notice.pdf", {
        type: "application/pdf",
      }),
    );
    form.set("language", "en");
    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        body: form,
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      synthetic: true,
      document: {
        classification: {
          category: "government_notice",
          authenticity: "not_verified",
          referenceNumber: "SYN-GOV-024",
        },
      },
      analysis: {
        analysisStatus: "needs_review",
        summary: {
          evidence: [
            {
              documentId: expect.any(String),
              pageNumber: 1,
              extractionMethod: "pdf-text",
              provenanceStatus: "source_matched",
            },
          ],
        },
      },
    });
  });

  it("never returns synthetic analysis in production even if the mock flag is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CIVIX_MOCK_ANALYSIS", "true");
    vi.stubEnv("GEMINI_API_KEY", "");
    const bytes = await readFile(
      new URL(
        "../features/documents/fixtures/files/municipal.pdf",
        import.meta.url,
      ),
    );
    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array(bytes)], "municipal.pdf", {
        type: "application/pdf",
      }),
    );
    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        body: form,
      }),
    );
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toMatchObject({ status: "failed" });
    expect(body).not.toHaveProperty("synthetic");
  });

  it("returns only sanitized failure stage and mock-mode diagnostics in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CIVIX_MOCK_ANALYSIS", "true");
    const bytes = await readFile(
      new URL(
        "../features/documents/fixtures/files/image-only.pdf",
        import.meta.url,
      ),
    );
    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array(bytes)], "image-only.pdf", {
        type: "application/pdf",
      }),
    );
    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        body: form,
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(422);
    expect(body).toMatchObject({
      error: {
        code: "unsupported_document",
        diagnostic: {
          stage: "eligibility",
          category: "no_selectable_text",
          mockEnabled: true,
        },
      },
    });
    expect(JSON.stringify(body)).not.toContain("rawText");
  });

  it("omits development diagnostic details outside development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CIVIX_MOCK_ANALYSIS", "true");
    const bytes = await readFile(
      new URL(
        "../features/documents/fixtures/files/image-only.pdf",
        import.meta.url,
      ),
    );
    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array(bytes)], "image-only.pdf", {
        type: "application/pdf",
      }),
    );
    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        body: form,
      }),
    );
    expect(await response.json()).not.toHaveProperty("error.diagnostic");
  });

  it("grounds deterministic simulated results through the Phase 4 pipeline", async () => {
    const source = new URL(
      "../features/documents/fixtures/files/municipal.pdf",
      import.meta.url,
    );
    const processed = await processDocument({
      bytes: new Uint8Array(await readFile(source)),
      originalFilename: "municipal.pdf",
    });
    expect(processed.ok).toBe(true);
    if (!processed.ok) return;
    try {
      const outcome = await analyzeDocument(
        { document: processed.value.document, requestedOutputLanguage: "en" },
        { provider: createSyntheticProvider(processed.value.document, "en") },
      );
      expect(outcome.status).toBe("needs_review");
      if ("analysis" in outcome) {
        expect(outcome.analysis.summary.semanticSupportStatus).toBe(
          "unverified",
        );
        expect(outcome.analysis.summary.evidence[0]?.provenanceStatus).toBe(
          "source_matched",
        );
      }
    } finally {
      processed.value.dispose();
    }
  });

  it("does not turn a deadline split across PDF text segments into invalid mock evidence", async () => {
    const processed = await processDocument({
      bytes: new Uint8Array(
        await readFile(
          new URL(
            "../features/documents/fixtures/files/municipal.pdf",
            import.meta.url,
          ),
        ),
      ),
      originalFilename: "municipal.pdf",
    });
    expect(processed.ok).toBe(true);
    if (!processed.ok) return;
    try {
      const doc: NormalizedDocument = structuredClone(processed.value.document);
      const page = doc.pages[0]!;
      const text = "Please pay by 20 May 2026.";
      const splitAt = text.indexOf("May");
      const base = page.segments[0]!;
      page.text = text;
      page.rawText = text;
      page.segments = [
        {
          ...base,
          id: `${base.id}:split-1`,
          text: text.slice(0, splitAt),
          start: 0,
          end: splitAt,
        },
        {
          ...base,
          id: `${base.id}:split-2`,
          text: text.slice(splitAt),
          start: splitAt,
          end: text.length,
        },
      ];
      doc.metadata.statistics.totalCharacters = text.length;
      const outcome = await analyzeDocument(
        { document: doc },
        { provider: createSyntheticProvider(doc, "en") },
      );
      expect(outcome.status).toBe("needs_review");
      if ("analysis" in outcome) {
        expect(outcome.analysis.deadlines).toHaveLength(0);
        expect(outcome.analysis.summary.evidence[0]?.excerpt).toBe(
          text.slice(0, splitAt),
        );
      }
    } finally {
      processed.value.dispose();
    }
  });
});
