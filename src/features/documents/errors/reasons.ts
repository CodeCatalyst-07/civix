import { z } from "zod";
/** Fixed diagnostic vocabulary; parser/library exception messages never cross it. */
export const processingReasonSchema = z.enum([
  "INVALID_INPUT",
  "EMPTY_INPUT",
  "DOCUMENT_LIMIT_EXCEEDED",
  "UNSUPPORTED_FORMAT",
  "FORMAT_MISMATCH",
  "TRUNCATED_FILE",
  "INVALID_LIMITS",
  "PROCESSOR_BUSY",
  "PROCESSING_TIMEOUT",
  "INVALID_PARSER_RESULT",
  "PARSER_FAILURE",
  "PARSER_EXIT",
  "PASSWORD_PROTECTED",
  "MALFORMED_DOCUMENT",
  "IMAGE_TOO_LARGE",
  "UNSUPPORTED_IMAGE",
  "EXTRACTION_FAILED",
  "PROCESSING_FAILED",
]);
export type ProcessingReason = z.infer<typeof processingReasonSchema>;
