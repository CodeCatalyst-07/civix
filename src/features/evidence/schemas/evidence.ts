import { z } from "zod";
import { identifierSchema } from "@/features/documents/schemas/document";

export const verificationStatusSchema = z.enum([
  "verified",
  "unverified",
  "unavailable",
]);
export const evidenceReferencesSchema = z.array(identifierSchema);
export const evidenceSchema = z.strictObject({
  id: identifierSchema,
  documentId: identifierSchema,
  // One-based physical page index. Images are page 1.
  pageNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  // Preserve source whitespace; a quotation is not normalized text.
  quotation: z
    .string()
    .refine((value) => value.trim().length > 0, "Quotation must not be blank"),
  sourceBlockId: identifierSchema.optional(),
  // Storage status only: a future provider boundary must distrust model-supplied
  // verification claims and let the independent source verifier set this value.
  verificationStatus: verificationStatusSchema,
});
export type Evidence = z.infer<typeof evidenceSchema>;
