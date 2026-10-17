import { z } from "zod";

export const identifierSchema = z.string().trim().min(1).max(200);
export const textSchema = z.string().trim().min(1);
export const languageSchema = z
  .string()
  .regex(
    /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/,
    "Use a language tag such as en, hi, or mr",
  );
export const documentCategorySchema = z.enum([
  "government_notice",
  "municipal_document",
  "tax_related",
  "public_service_form",
  "scholarship_notice",
  "utility_notice",
  "official_correspondence",
  "other",
  "unknown",
]);
export const mimeTypeSchema = z.enum([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
export const processingStatusSchema = z.enum([
  "pending",
  "processing",
  "completed",
  "failed",
]);
export const documentMetadataSchema = z.strictObject({
  id: identifierSchema,
  originalFilename: textSchema,
  mimeType: mimeTypeSchema,
  fileSizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  pageCount: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .nullable(),
  originalLanguage: languageSchema.nullable(),
  category: documentCategorySchema,
  createdAt: z.iso.datetime(),
  status: processingStatusSchema,
});

export type DocumentMetadata = z.infer<typeof documentMetadataSchema>;
export type DocumentCategory = z.infer<typeof documentCategorySchema>;
