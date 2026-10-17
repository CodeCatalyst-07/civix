import { z } from "zod";

export const MAX_PROMPT_CHARS = 100000;
export const MAX_RESPONSE_CHARS = 50000;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const promptSchema = z.string().trim().min(1).max(MAX_PROMPT_CHARS);
const shortText = z.string().trim().min(1).max(4000);
/** Experimental only: does not replace the production analysis contract. */
export const extractionSchema = z.strictObject({
  documentType: shortText.nullable(),
  summary: shortText,
  requiredAction: shortText.nullable(),
  deadlineText: shortText.nullable(),
  feeText: shortText.nullable(),
  warnings: z.array(shortText).max(20),
});
export type Extraction = z.infer<typeof extractionSchema>;
export type ImageInput = {
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg";
};
export type Usage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};
export type Generation = {
  text: string;
  model: string;
  modelVersion: string | null;
  usage: Usage | null;
};
export interface AIProvider {
  generateText(prompt: string): Promise<Generation>;
  generateImage(prompt: string, image: ImageInput): Promise<Generation>;
  generateStructured(
    source: string,
    options?: { repairOnce?: boolean },
  ): Promise<Generation & { data: Extraction }>;
}
