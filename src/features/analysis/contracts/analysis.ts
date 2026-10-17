import { z } from "zod";
import {
  identifierSchema,
  languageSchema,
  textSchema,
} from "@/features/documents/schemas/document";
import { normalizedDocumentSchema } from "@/features/documents/contracts/processing";
import { sourceReferenceSchema } from "@/features/documents/evidence/references";

export const outputLanguageSchema = z.enum(["en", "hi", "mr"]);
export type OutputLanguage = z.infer<typeof outputLanguageSchema>;
export const claimEvidenceSchema = z.strictObject({
  pageNumber: z.number().int().positive(),
  segmentId: identifierSchema,
  excerpt: z.string().min(1),
});
export type ClaimEvidence = z.infer<typeof claimEvidenceSchema>;
const claimSchema = z.strictObject({
  text: textSchema,
  evidence: z.array(claimEvidenceSchema).min(1).max(8),
});
export const extractionResultSchema = z.strictObject({
  detectedLanguage: languageSchema.nullable(),
  documentType: textSchema.nullable(),
  summary: claimSchema,
  issuer: claimSchema.nullable(),
  actions: z
    .array(
      z.strictObject({
        description: textSchema,
        mandatory: z.boolean().nullable(),
        evidence: z.array(claimEvidenceSchema).min(1).max(8),
      }),
    )
    .max(30),
  deadlines: z
    .array(
      z.strictObject({
        expression: textSchema,
        evidence: z.array(claimEvidenceSchema).min(1).max(8),
      }),
    )
    .max(30),
  requiredDocuments: z
    .array(
      z.strictObject({
        name: textSchema,
        mandatory: z.boolean().nullable(),
        evidence: z.array(claimEvidenceSchema).min(1).max(8),
      }),
    )
    .max(30),
  fees: z
    .array(
      z.strictObject({
        statement: textSchema,
        evidence: z.array(claimEvidenceSchema).min(1).max(8),
      }),
    )
    .max(20),
  consequences: z.array(claimSchema).max(20),
  missingInformation: z.array(textSchema).max(30),
  uncertainties: z.array(textSchema).max(30),
});
export type ExtractionResult = z.infer<typeof extractionResultSchema>;

export const groundedClaimSchema = z.strictObject({
  text: textSchema,
  evidence: z.array(sourceReferenceSchema).min(1),
  sourceReferenceStatus: z.literal("valid"),
  semanticSupportStatus: z.literal("unverified"),
  verificationStatus: z.literal("human_review_required"),
});
export const interpretedDeadlineSchema = z.strictObject({
  sourceExpression: textSchema,
  deadlineType: z.enum(["explicit", "relative", "ambiguous"]),
  explicitDate: z.iso.date().nullable(),
  relativeDuration: z
    .strictObject({
      value: z.number().int().positive(),
      unit: z.enum(["days", "weeks", "months", "years"]),
    })
    .nullable(),
  referenceEvent: textSchema.nullable(),
  resolvedDate: z.iso.date().nullable(),
  verificationStatus: z.literal("human_review_required"),
  evidence: z.array(sourceReferenceSchema).min(1),
});
export const civicAnalysisSchema = z.strictObject({
  analysisId: identifierSchema,
  documentId: identifierSchema,
  analysisStatus: z.enum(["complete", "partial", "needs_review"]),
  coverage: z.strictObject({
    includedPages: z.array(z.number().int().positive()),
    omittedPages: z.array(z.number().int().positive()),
    complete: z.boolean(),
  }),
  detectedLanguage: languageSchema.nullable(),
  requestedOutputLanguage: outputLanguageSchema,
  documentType: textSchema.nullable(),
  summary: groundedClaimSchema,
  issuer: groundedClaimSchema.nullable(),
  requiredActions: z.array(
    z.strictObject({
      id: identifierSchema,
      description: textSchema,
      mandatoryStatus: z.enum(["mandatory", "optional", "uncertain"]),
      deadlineReference: z.number().int().nonnegative().nullable(),
      evidence: z.array(sourceReferenceSchema).min(1),
      verificationStatus: z.literal("human_review_required"),
    }),
  ),
  deadlines: z.array(interpretedDeadlineSchema),
  requiredDocuments: z.array(
    z.strictObject({
      name: textSchema,
      mandatoryStatus: z.enum(["mandatory", "optional", "uncertain"]),
      evidence: z.array(sourceReferenceSchema).min(1),
      verificationStatus: z.literal("human_review_required"),
    }),
  ),
  fees: z.array(
    z.strictObject({
      statement: textSchema,
      amount: z.string().nullable(),
      currency: z.string().nullable(),
      semantics: z.enum([
        "explicit_amount",
        "explicitly_no_fee",
        "mentioned_amount_unknown",
        "unknown",
      ]),
      evidence: z.array(sourceReferenceSchema).min(1),
      verificationStatus: z.literal("human_review_required"),
    }),
  ),
  feeInformationStatus: z.enum([
    "explicit_no_fee",
    "stated",
    "mentioned_amount_unknown",
    "not_found",
    "unclear",
  ]),
  consequences: z.array(groundedClaimSchema),
  missingInformation: z.array(textSchema),
  uncertainties: z.array(textSchema),
  warnings: z.array(textSchema),
  processingMetadata: z.strictObject({
    model: textSchema,
    modelVersion: textSchema.nullable(),
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    totalTokens: z.number().int().nonnegative().nullable(),
  }),
});
export type CivicAnalysis = z.infer<typeof civicAnalysisSchema>;

export const analysisInputSchema = z.strictObject({
  document: normalizedDocumentSchema,
  requestedOutputLanguage: outputLanguageSchema.default("en"),
  trustedReferenceDate: z.iso.date().optional(),
  trustedReferenceEvent: textSchema.optional(),
  relativeDeadlineSemantics: z.literal("elapsed_days").optional(),
});
export type AnalysisInput = z.input<typeof analysisInputSchema>;
export type ParsedAnalysisInput = z.output<typeof analysisInputSchema>;
export const sourceReferenceForClaim = sourceReferenceSchema;
