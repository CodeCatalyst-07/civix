import { AppError } from "../../../lib/errors/app-error";
import {
  inputSchema,
  type DocumentInput,
  type ProcessingLimits,
} from "../contracts/processing";
export function validateInput(
  candidate: DocumentInput,
  limits: ProcessingLimits,
) {
  const parsed = inputSchema.safeParse(candidate);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "INVALID_INPUT");
  const input = parsed.data;
  const bytes = input.bytes;
  if (!bytes.length) throw new AppError("VALIDATION_ERROR", "EMPTY_INPUT");
  if (bytes.length > limits.maxFileBytes)
    throw new AppError("VALIDATION_ERROR", "DOCUMENT_LIMIT_EXCEEDED");
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const mime =
    b.subarray(0, 5).toString() === "%PDF-"
      ? "application/pdf"
      : b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? "image/png"
        : b[0] === 255 && b[1] === 216 && b[2] === 255
          ? "image/jpeg"
          : null;
  if (!mime) throw new AppError("UNSUPPORTED_DOCUMENT", "UNSUPPORTED_FORMAT");
  const extension = input.originalFilename.split(".").pop()?.toLowerCase();
  const extensions =
    mime === "application/pdf"
      ? ["pdf"]
      : mime === "image/png"
        ? ["png"]
        : ["jpg", "jpeg"];
  if (
    !extensions.includes(extension ?? "") ||
    (input.declaredMimeType !== undefined && input.declaredMimeType !== mime)
  )
    throw new AppError("VALIDATION_ERROR", "FORMAT_MISMATCH");
  if (
    mime === "application/pdf" &&
    !/%%EOF\s*$/.test(b.subarray(-1024).toString("latin1"))
  )
    throw new AppError("VALIDATION_ERROR", "TRUNCATED_FILE");
  if (mime === "image/jpeg" && (b.at(-2) !== 255 || b.at(-1) !== 217))
    throw new AppError("VALIDATION_ERROR", "TRUNCATED_FILE");
  if (
    mime === "image/png" &&
    !b
      .subarray(-12)
      .equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]))
  )
    throw new AppError("VALIDATION_ERROR", "TRUNCATED_FILE");
  return { input, mime };
}
