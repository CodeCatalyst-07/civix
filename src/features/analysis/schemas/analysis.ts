import { z } from "zod";
import {
  documentCategorySchema,
  identifierSchema,
  languageSchema,
  textSchema,
} from "@/features/documents/schemas/document";
import {
  evidenceReferencesSchema,
  evidenceSchema,
  verificationStatusSchema,
} from "@/features/evidence/schemas/evidence";

export const calendarDateSchema = z.iso.date();
export const warningsSchema = z.array(textSchema);
export const summarySchema = z.strictObject({
  title: textSchema,
  category: documentCategorySchema,
  issuingAuthority: textSchema.nullable(),
  sourceLanguage: languageSchema.nullable(),
  plainLanguageSummary: textSchema,
  actionRequired: z.union([z.boolean(), z.literal("unknown")]),
  evidenceIds: evidenceReferencesSchema,
  warnings: warningsSchema,
});
export const actionItemSchema = z.strictObject({
  id: identifierSchema,
  description: textSchema,
  mandatory: z.boolean().nullable(),
  evidenceIds: evidenceReferencesSchema,
  dependsOnActionIds: z.array(identifierSchema).optional(),
});
const deadlineFields = {
  id: identifierSchema,
  originalText: textSchema,
  verificationStatus: verificationStatusSchema,
  evidenceIds: evidenceReferencesSchema,
};
export const relativeDurationSchema = z.strictObject({
  value: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  unit: z.enum(["days", "weeks", "months", "years"]),
});
export const deadlineSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...deadlineFields,
    kind: z.literal("absolute"),
    normalizedDate: calendarDateSchema,
  }),
  z.strictObject({
    ...deadlineFields,
    kind: z.literal("relative"),
    duration: relativeDurationSchema,
    anchorEvent: textSchema,
    anchorDate: calendarDateSchema.nullable(),
    // Resolution belongs to a future deterministic date service, not AI output.
    normalizedDate: z.null(),
  }),
  z.strictObject({
    ...deadlineFields,
    kind: z.literal("uncertain"),
    normalizedDate: z.null(),
    reason: textSchema,
  }),
]);
export const feeSchema = z
  .strictObject({
    id: identifierSchema,
    // Decimal major units, up to 4 fractional digits. No JS floating-point arithmetic.
    amount: z
      .string()
      .regex(
        /^(0|[1-9]\d{0,17})(\.\d{1,4})?$/,
        "Use a nonnegative decimal amount string",
      )
      .nullable(),
    // ISO 4217 codes supported by this runtime; reject invented codes such as XYZ.
    currency: z
      .string()
      .refine(
        (value) => Intl.supportedValuesOf("currency").includes(value),
        "Use an ISO 4217 currency code",
      )
      .nullable(),
    originalAmountText: textSchema.nullable(),
    description: textSchema,
    evidenceIds: evidenceReferencesSchema,
  })
  .refine((fee) => fee.amount === null || fee.originalAmountText !== null, {
    message: "A stated amount requires original source amount text",
    path: ["originalAmountText"],
  });
export const requiredDocumentSchema = z.strictObject({
  id: identifierSchema,
  name: textSchema,
  description: textSchema.nullable(),
  mandatory: z.boolean().nullable(),
  evidenceIds: evidenceReferencesSchema,
});

// Structural validation only: does not resolve references or establish truth.
export const analysisResultStructureSchema = z.strictObject({
  id: identifierSchema,
  documentId: identifierSchema,
  modelIdentifier: textSchema,
  analyzedAt: z.iso.datetime(),
  status: z.enum(["completed", "partial"]),
  summary: summarySchema,
  actions: z.array(actionItemSchema),
  deadlines: z.array(deadlineSchema),
  fees: z.array(feeSchema),
  requiredDocuments: z.array(requiredDocumentSchema),
  evidence: z.array(evidenceSchema),
  warnings: warningsSchema,
});
export type AnalysisResult = z.infer<typeof analysisResultStructureSchema>;
export type DocumentSummary = z.infer<typeof summarySchema>;
export type ActionItem = z.infer<typeof actionItemSchema>;
export type Deadline = z.infer<typeof deadlineSchema>;
export type Fee = z.infer<typeof feeSchema>;
export type RequiredDocument = z.infer<typeof requiredDocumentSchema>;

export type ConsistencyIssue = { path: (string | number)[]; message: string };

/** Input must already be structurally parsed. This is not source verification. */
export function checkAnalysisConsistency(
  analysis: AnalysisResult,
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const evidenceIds = new Set(analysis.evidence.map((item) => item.id));
  const uniqueIds = (items: { id: string }[], path: string) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (seen.has(item.id))
        issues.push({
          path: [path, index, "id"],
          message: `Duplicate ${path} ID: ${item.id}`,
        });
      seen.add(item.id);
    });
  };
  for (const key of [
    "actions",
    "deadlines",
    "fees",
    "requiredDocuments",
    "evidence",
  ] as const)
    uniqueIds(analysis[key], key);
  analysis.evidence.forEach((item, index) => {
    if (item.documentId !== analysis.documentId)
      issues.push({
        path: ["evidence", index, "documentId"],
        message: "Evidence belongs to a different document",
      });
  });
  const references: {
    item: { evidenceIds: string[] };
    path: (string | number)[];
  }[] = [{ item: analysis.summary, path: ["summary"] }];
  for (const key of [
    "actions",
    "deadlines",
    "fees",
    "requiredDocuments",
  ] as const) {
    analysis[key].forEach((item, index) =>
      references.push({ item, path: [key, index] }),
    );
  }
  for (const { item, path } of references) {
    item.evidenceIds.forEach((id, index) => {
      if (!evidenceIds.has(id))
        issues.push({
          path: [...path, "evidenceIds", index],
          message: `Missing evidence reference: ${id}`,
        });
    });
  }
  const actions = new Map(analysis.actions.map((item) => [item.id, item]));
  analysis.actions.forEach((item, index) => {
    for (const dependency of item.dependsOnActionIds ?? []) {
      if (!actions.has(dependency) || dependency === item.id)
        issues.push({
          path: ["actions", index, "dependsOnActionIds"],
          message: "Dependency must reference another existing action",
        });
    }
  });
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cyclic = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of actions.get(id)?.dependsOnActionIds ?? [])
      if (cyclic(dependency)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  if (analysis.actions.some((item) => cyclic(item.id)))
    issues.push({
      path: ["actions"],
      message: "Action dependencies must not contain cycles",
    });
  return issues;
}

export const analysisResultSchema = analysisResultStructureSchema.superRefine(
  (analysis, context) => {
    for (const issue of checkAnalysisConsistency(analysis))
      context.addIssue({ code: "custom", ...issue });
  },
);
