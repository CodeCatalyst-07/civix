import "server-only";
import { fork } from "node:child_process";
import process from "node:process";
import { z } from "zod";
import { AppError } from "../../../lib/errors/app-error";
import {
  imageSchema,
  geometrySchema,
  type ProcessingLimits,
} from "../contracts/processing";
const responseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(false),
    reason: z.enum([
      "PASSWORD_PROTECTED",
      "MALFORMED_DOCUMENT",
      "DOCUMENT_LIMIT_EXCEEDED",
      "IMAGE_TOO_LARGE",
      "UNSUPPORTED_IMAGE",
      "EXTRACTION_FAILED",
    ]),
  }),
  z.strictObject({
    ok: z.literal(true),
    pages: z
      .array(
        z.strictObject({
          pageNumber: z.int().positive(),
          rawText: z.string(),
          failed: z.boolean(),
          image: imageSchema.optional(),
          textItems: z
            .array(
              z.strictObject({
                text: z.string(),
                geometry: geometrySchema,
                method: z.enum(["pdf-text", "ocr"]).optional(),
                confidence: z.number().min(0).max(100).optional(),
              }),
            )
            .max(50000)
            .optional(),
          warnings: z.array(z.string()).optional(),
          ocrStatus: z
            .enum(["not_needed", "completed", "unavailable", "failed"])
            .optional(),
        }),
      )
      .min(1)
      .max(20),
    binary: z.instanceof(Uint8Array).optional(),
    warnings: z.array(z.string()),
    parser: z.string(),
    libraryVersion: z.string(),
    title: z.string().nullable(),
  }),
]);
let active = false;
/** One isolated process, zero queue. Kill is awaited before releasing capacity. */
export async function parseIsolated(
  bytes: Uint8Array,
  mime: string,
  limits: ProcessingLimits,
) {
  if (active) throw new AppError("DOCUMENT_PROCESSING_ERROR", "PROCESSOR_BUSY");
  active = true;
  let child: ReturnType<typeof fork> | undefined;
  try {
    child = fork(
      new URL("../../../../scripts/documents/parser.mjs", import.meta.url),
      [],
      {
        execArgv: ["--max-old-space-size=192"],
        serialization: "advanced",
        detached: true,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "production",
          ...(process.env.CIVIX_TESSERACT_PATH
            ? { CIVIX_TESSERACT_PATH: process.env.CIVIX_TESSERACT_PATH }
            : {}),
        },
      },
    );
    const parser = child;
    const closed = new Promise<void>((resolve) =>
      parser.once("close", () => resolve()),
    );
    try {
      return await new Promise<z.infer<typeof responseSchema> & { ok: true }>(
        (resolve, reject) => {
          const timer = setTimeout(
            () =>
              reject(
                new AppError("DOCUMENT_PROCESSING_ERROR", "PROCESSING_TIMEOUT"),
              ),
            limits.maxDurationMs,
          );
          const finish = (error?: Error, value?: unknown) => {
            clearTimeout(timer);
            if (error) {
              reject(error);
              return;
            }
            const parsed = responseSchema.safeParse(value);
            if (!parsed.success)
              reject(
                new AppError(
                  "DOCUMENT_PROCESSING_ERROR",
                  "INVALID_PARSER_RESULT",
                ),
              );
            else if (!parsed.data.ok)
              reject(
                new AppError("DOCUMENT_PROCESSING_ERROR", parsed.data.reason),
              );
            else resolve(parsed.data);
          };
          parser.once("message", (value) => finish(undefined, value));
          parser.once("error", () =>
            finish(new AppError("DOCUMENT_PROCESSING_ERROR", "PARSER_FAILURE")),
          );
          parser.once("exit", () =>
            finish(new AppError("DOCUMENT_PROCESSING_ERROR", "PARSER_EXIT")),
          );
          parser.send({ bytes, mime, limits }, (error) => {
            if (error)
              finish(
                new AppError("DOCUMENT_PROCESSING_ERROR", "PARSER_FAILURE"),
              );
          });
        },
      );
    } finally {
      parser.kill("SIGKILL");
      try {
        process.kill(-parser.pid!, "SIGKILL");
      } catch {
        // The child may already have exited or process groups may be unavailable.
      }
      await closed;
    }
  } finally {
    active = false;
  }
}
