import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  actionItemSchema,
  analysisResultSchema,
  analysisResultStructureSchema,
  calendarDateSchema,
  checkAnalysisConsistency,
  deadlineSchema,
  feeSchema,
  requiredDocumentSchema,
  summarySchema,
  type AnalysisResult,
} from "@/features/analysis/schemas/analysis";
import {
  documentMetadataSchema,
  documentCategorySchema,
} from "@/features/documents/schemas/document";
import { evidenceSchema } from "@/features/evidence/schemas/evidence";
import { syntheticFixtures } from "@/features/documents/fixtures/synthetic";

const first = syntheticFixtures[0]!;
const analysis = (): AnalysisResult => structuredClone(first.expectedAnalysis);

describe("document metadata", () => {
  it.each(["application/pdf", "image/jpeg", "image/png", "image/webp"])(
    "accepts supported media %s",
    (mimeType) => {
      expect(
        documentMetadataSchema.safeParse({ ...first.document, mimeType })
          .success,
      ).toBe(true);
    },
  );
  it("represents unknown language and page count as null", () => {
    expect(
      documentMetadataSchema.safeParse({
        ...first.document,
        pageCount: null,
        originalLanguage: null,
      }).success,
    ).toBe(true);
  });
  it.each(["text/plain", "application/javascript", "image/svg+xml"])(
    "rejects MIME %s",
    (mimeType) => {
      expect(
        documentMetadataSchema.safeParse({ ...first.document, mimeType })
          .success,
      ).toBe(false);
    },
  );
  it.each([0, -1, 0.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects file size %s",
    (fileSizeBytes) => {
      expect(
        documentMetadataSchema.safeParse({ ...first.document, fileSizeBytes })
          .success,
      ).toBe(false);
    },
  );
  it.each([0, -1, 1.5, Number.NaN])("rejects page count %s", (pageCount) => {
    expect(
      documentMetadataSchema.safeParse({ ...first.document, pageCount })
        .success,
    ).toBe(false);
  });
  it("supports every documented category", () => {
    for (const category of documentCategorySchema.options)
      expect(
        documentMetadataSchema.safeParse({ ...first.document, category })
          .success,
      ).toBe(true);
  });
  it("rejects invalid timestamps, languages, statuses and blank IDs", () => {
    for (const patch of [
      { createdAt: "yesterday" },
      { originalLanguage: "English" },
      { status: "done" },
      { id: " " },
    ])
      expect(
        documentMetadataSchema.safeParse({ ...first.document, ...patch })
          .success,
      ).toBe(false);
  });
});

describe("evidence and consistency", () => {
  it("accepts valid references", () =>
    expect(checkAnalysisConsistency(analysis())).toEqual([]));
  it.each([0, -1, 1.2])("rejects evidence page %s", (pageNumber) => {
    expect(
      evidenceSchema.safeParse({
        ...first.expectedAnalysis.evidence[0],
        pageNumber,
      }).success,
    ).toBe(false);
  });
  it("preserves exact quote whitespace and rejects blank quotes", () => {
    const evidence = first.expectedAnalysis.evidence[0]!;
    expect(
      evidenceSchema.parse({ ...evidence, quotation: "  exact\nquote " })
        .quotation,
    ).toBe("  exact\nquote ");
    expect(
      evidenceSchema.safeParse({ ...evidence, quotation: "  " }).success,
    ).toBe(false);
  });
  it.each([
    "summary",
    "actions",
    "deadlines",
    "fees",
    "requiredDocuments",
  ] as const)("rejects missing evidence referenced by %s", (key) => {
    const value = analysis();
    const target = key === "summary" ? value.summary : value[key][0]!;
    target.evidenceIds = ["missing"];
    expect(analysisResultStructureSchema.safeParse(value).success).toBe(true);
    const result = analysisResultSchema.safeParse(value);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.message).toContain(
        "Missing evidence reference",
      );
  });
  it("rejects cross-document evidence even if unreferenced", () => {
    const value = analysis();
    value.evidence.push({
      ...value.evidence[0]!,
      id: "foreign",
      documentId: "other-document",
    });
    expect(analysisResultSchema.safeParse(value).success).toBe(false);
  });
  it.each([
    "actions",
    "deadlines",
    "fees",
    "requiredDocuments",
    "evidence",
  ] as const)("rejects duplicate %s IDs", (key) => {
    const value = analysis();
    // Rebuild a structurally typed candidate without mutating heterogeneous arrays.
    const candidate: unknown = {
      ...value,
      [key]: [...value[key], value[key][0]],
    };
    expect(analysisResultSchema.safeParse(candidate).success).toBe(false);
  });
  it("rejects missing, self-referencing and cyclic action dependencies", () => {
    for (const dependency of ["missing", "submit-address-proof"]) {
      const value = analysis();
      value.actions[0]!.dependsOnActionIds = [dependency];
      expect(analysisResultSchema.safeParse(value).success).toBe(false);
    }
    const value = analysis();
    value.actions[0]!.dependsOnActionIds = ["second"];
    value.actions.push({
      ...value.actions[0]!,
      id: "second",
      dependsOnActionIds: ["submit-address-proof"],
    });
    expect(analysisResultSchema.safeParse(value).success).toBe(false);
  });
  it("accepts a valid dependency graph", () => {
    const value = analysis();
    value.actions.push({
      ...value.actions[0]!,
      id: "second",
      dependsOnActionIds: ["submit-address-proof"],
    });
    expect(analysisResultSchema.safeParse(value).success).toBe(true);
  });
  it("never promotes unverified evidence during parsing", () => {
    expect(
      analysisResultSchema.parse(analysis()).evidence[0]?.verificationStatus,
    ).toBe("unverified");
  });
});

describe("deadlines", () => {
  it.each(["2026-10-25", "2024-02-29", "2000-02-29"])(
    "accepts calendar date %s",
    (date) => expect(calendarDateSchema.safeParse(date).success).toBe(true),
  );
  it.each([
    "2026-02-29",
    "2026-04-31",
    "1900-02-29",
    "2026-13-01",
    "2026-10-25T00:00:00Z",
    "25/10/2026",
  ])("rejects invalid calendar date %s", (date) =>
    expect(calendarDateSchema.safeParse(date).success).toBe(false),
  );
  it("accepts an explicit deadline", () =>
    expect(
      deadlineSchema.safeParse(first.expectedAnalysis.deadlines[0]).success,
    ).toBe(true));
  it("preserves receipt-relative deadlines without receipt dates", () => {
    const deadline = deadlineSchema.parse(
      syntheticFixtures[1]!.expectedAnalysis.deadlines[0],
    );
    expect(deadline.kind).toBe("relative");
    if (deadline.kind === "relative") {
      expect(deadline.anchorDate).toBeNull();
      expect(deadline.normalizedDate).toBeNull();
      expect(deadline.duration).toEqual({ value: 15, unit: "days" });
    }
    expect(
      deadlineSchema.safeParse({ ...deadline, normalizedDate: "2026-10-16" })
        .success,
    ).toBe(false);
  });
  it("keeps even known-anchor resolution outside AI output", () => {
    const deadline = syntheticFixtures[1]!.expectedAnalysis.deadlines[0]!;
    expect(
      deadlineSchema.safeParse({ ...deadline, anchorDate: "2026-10-01" })
        .success,
    ).toBe(true);
    expect(
      deadlineSchema.safeParse({
        ...deadline,
        duration: { value: -15, unit: "days" },
      }).success,
    ).toBe(false);
  });
  it("accepts uncertainty without inventing a date", () => {
    const deadline = syntheticFixtures[2]!.expectedAnalysis.deadlines[0]!;
    expect(deadlineSchema.safeParse(deadline).success).toBe(true);
    expect(
      deadlineSchema.safeParse({ ...deadline, normalizedDate: "2026-10-25" })
        .success,
    ).toBe(false);
    expect(deadlineSchema.safeParse({ ...deadline, reason: "" }).success).toBe(
      false,
    );
  });
});

describe("fees and other output fields", () => {
  const unknownFee = syntheticFixtures[2]!.expectedAnalysis.fees[0]!;
  it("distinguishes an unknown fee from an explicitly zero fee", () => {
    expect(feeSchema.parse(unknownFee).amount).toBeNull();
    expect(feeSchema.parse(first.expectedAnalysis.fees[0]).amount).toBe("0");
    expect(feeSchema.safeParse({ ...unknownFee, amount: "0" }).success).toBe(
      false,
    );
  });
  it.each(["0", "0.00", "10.50", "123456789012345678.1234"])(
    "accepts precise decimal money %s",
    (amount) => {
      expect(
        feeSchema.safeParse({
          ...unknownFee,
          amount,
          currency: "INR",
          originalAmountText: `INR ${amount}`,
        }).success,
      ).toBe(true);
    },
  );
  it.each([0, -1, "-1", "01", "1e3", "NaN", "1.12345"])(
    "rejects malformed amount %s",
    (amount) =>
      expect(feeSchema.safeParse({ ...unknownFee, amount }).success).toBe(
        false,
      ),
  );
  it.each(["inr", "XYZ", "RUPEES", "12"])("rejects currency %s", (currency) =>
    expect(feeSchema.safeParse({ ...unknownFee, currency }).success).toBe(
      false,
    ),
  );
  it("does not require a currency when only amount is stated", () =>
    expect(feeSchema.safeParse(first.expectedAnalysis.fees[0]).success).toBe(
      true,
    ));
  it.each(["completed", "completedAt", "userId"])(
    "rejects user state %s in AI actions",
    (key) =>
      expect(
        actionItemSchema.safeParse({
          ...first.expectedAnalysis.actions[0],
          [key]: true,
        }).success,
      ).toBe(false),
  );
  it("accepts unknown mandatory status and authority", () => {
    expect(
      actionItemSchema.safeParse({
        ...first.expectedAnalysis.actions[0],
        mandatory: null,
      }).success,
    ).toBe(true);
    expect(
      requiredDocumentSchema.safeParse({
        ...first.expectedAnalysis.requiredDocuments[0],
        mandatory: null,
      }).success,
    ).toBe(true);
    expect(
      summarySchema.safeParse(syntheticFixtures[2]!.expectedAnalysis.summary)
        .success,
    ).toBe(true);
  });
});

describe("complete results and synthetic fixtures", () => {
  it.each(syntheticFixtures)("validates $name", (fixture) => {
    expect(fixture.synthetic).toBe(true);
    expect(fixture.source).toContain("SYNTHETIC EXAMPLE");
    expect(documentMetadataSchema.safeParse(fixture.document).success).toBe(
      true,
    );
    expect(
      analysisResultSchema.safeParse(fixture.expectedAnalysis).success,
    ).toBe(true);
    // Fixture QA only; a production source verifier is not implemented.
    for (const evidence of fixture.expectedAnalysis.evidence)
      expect(fixture.source).toContain(evidence.quotation);
  });
  it("accepts arbitrary future model identifiers", () =>
    expect(
      analysisResultSchema.safeParse({
        ...analysis(),
        modelIdentifier: "future-model-v2",
      }).success,
    ).toBe(true));
  it.each([
    null,
    {},
    { ...first.expectedAnalysis, actions: "not-an-array" },
    { ...first.expectedAnalysis, invented: true },
    { ...first.expectedAnalysis, status: "pending" },
  ])("rejects malformed result %#", (candidate: unknown) =>
    expect(analysisResultSchema.safeParse(candidate).success).toBe(false),
  );
  it("reports meaningful paths on structural errors", () => {
    const result = analysisResultSchema.safeParse({
      ...analysis(),
      summary: { ...analysis().summary, title: "" },
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(z.flattenError(result.error).fieldErrors.summary).toBeDefined();
  });
});
