// Isolated, disposable parser process. Never accepts paths, URLs or credentials.
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
globalThis.fetch = async () => {
  throw new Error("NETWORK_DISABLED");
};
let parserWarning = 0;
console.log =
  console.warn =
  console.error =
    () => {
      parserWarning++;
    };
const fail = (reason) => {
  const e = new Error(reason);
  e.safeReason = reason;
  throw e;
};
process.once("message", async ({ bytes, mime, limits }) => {
  try {
    let result;
    if (mime === "application/pdf")
      result = await pdf(new Uint8Array(bytes), limits);
    else result = await image(Buffer.from(bytes), limits);
    process.send({ ok: true, ...result }, () => process.disconnect());
  } catch (error) {
    const reason =
      error.safeReason ??
      (error.name === "PasswordException"
        ? "PASSWORD_PROTECTED"
        : "MALFORMED_DOCUMENT");
    process.send({ ok: false, reason }, () => process.disconnect());
  }
});
async function pdf(bytes, limits) {
  const { getDocument, version } =
    await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Optional canvas warnings concern pending rendering, not text extraction.
  parserWarning = 0;
  const task = getDocument({
    data: bytes,
    standardFontDataUrl: fileURLToPath(
      new URL(
        "./standard_fonts/",
        import.meta.resolve("pdfjs-dist/package.json"),
      ),
    ),
    stopAtErrors: true,
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
    disableAutoFetch: true,
    enableXfa: false,
    verbosity: 1,
  });
  try {
    const doc = await task.promise;
    if ((await doc.getPermissions()) !== null) fail("PASSWORD_PROTECTED");
    if (!doc.numPages || doc.numPages > limits.maxPages)
      fail("DOCUMENT_LIMIT_EXCEEDED");
    const pages = [];
    let total = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      let page;
      const warningsBefore = parserWarning;
      try {
        page = await doc.getPage(n);
        const reader = page
          .streamTextContent({ disableNormalization: true })
          .getReader();
        const items = [];
        const textItems = [];
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            for (const item of value.items) {
              if (!("str" in item)) continue;
              const text = item.str + (item.hasEOL ? "\n" : " ");
              total += text.length;
              if (total > limits.maxTextChars) fail("DOCUMENT_LIMIT_EXCEEDED");
              items.push(text);
              if (textItems.length >= 50000) fail("DOCUMENT_LIMIT_EXCEEDED");
              textItems.push({
                text: item.str,
                geometry: {
                  coordinateSpace: "pdf-user-space",
                  transform: item.transform,
                  width: item.width,
                  height: item.height,
                },
              });
            }
          }
        } finally {
          await reader.cancel();
        }
        pages.push({
          pageNumber: n,
          rawText: items.join(""),
          textItems,
          failed: !items.join("").trim() && parserWarning > warningsBefore,
          ...(items.join("").trim()
            ? { ocrStatus: "not_needed" }
            : { ocrStatus: "unavailable" }),
          warnings: [
            ...(parserWarning > warningsBefore ? ["PAGE_PARSER_WARNING"] : []),
            ...(!items.join("").trim()
              ? ["PDF_PAGE_RENDERER_UNAVAILABLE"]
              : []),
          ],
        });
      } catch (error) {
        if (error.safeReason) throw error;
        pages.push({ pageNumber: n, rawText: "", failed: true });
      } finally {
        page?.cleanup();
      }
    }
    if (pages.every((p) => p.failed)) fail("EXTRACTION_FAILED");
    const metadata = await doc.getMetadata().catch(() => null);
    return {
      pages,
      parser: "pdfjs-dist",
      libraryVersion: version,
      warnings: parserWarning ? ["PARSER_WARNING"] : [],
      title:
        typeof metadata?.info?.Title === "string"
          ? metadata.info.Title.slice(0, 1000)
          : null,
    };
  } finally {
    await task.destroy();
  }
}
async function image(bytes, limits) {
  const { default: sharp } = await import("sharp");
  sharp.cache(false);
  sharp.concurrency(1);
  const options = {
    limitInputPixels: limits.maxPixels,
    failOn: "warning",
    sequentialRead: true,
  };
  const meta = await sharp(bytes, {
    ...options,
    limitInputPixels: false,
  }).metadata();
  if (
    !["png", "jpeg"].includes(meta.format) ||
    !meta.width ||
    !meta.height ||
    (meta.pages ?? 1) !== 1
  )
    fail("UNSUPPORTED_IMAGE");
  if (
    meta.width > limits.maxDimension ||
    meta.height > limits.maxDimension ||
    meta.width * meta.height > limits.maxPixels
  )
    fail("IMAGE_TOO_LARGE");
  // Full strict decode, orientation correction; PNG avoids lossy text compression.
  const { data, info } = await sharp(bytes, options)
    .rotate()
    .resize({
      width: limits.outputDimension,
      height: limits.outputDimension,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 6 })
    .toBuffer({ resolveWithObject: true });
  if (data.length > limits.maxOutputBytes) fail("DOCUMENT_LIMIT_EXCEEDED");
  const ocr = await runOcr(data, limits.maxDurationMs);
  return {
    pages: [
      {
        pageNumber: 1,
        rawText: ocr.text,
        textItems: ocr.items,
        ocrStatus: ocr.status,
        failed: false,
        image: {
          originalFormat: meta.format,
          originalWidth: meta.width,
          originalHeight: meta.height,
          width: info.width,
          height: info.height,
          mimeType: "image/png",
          byteLength: data.length,
        },
        warnings: [
          ...(ocr.warning ? [ocr.warning] : []),
          ...(meta.orientation && meta.orientation !== 1
            ? ["ORIENTATION_CORRECTED"]
            : []),
          ...(info.width * info.height < meta.width * meta.height
            ? ["IMAGE_RESIZED"]
            : []),
        ],
      },
    ],
    binary: new Uint8Array(data),
    warnings: [],
    parser: "sharp",
    libraryVersion: sharp.versions.sharp,
    title: null,
  };
}

async function runOcr(png, maxDurationMs) {
  const executable = process.env.CIVIX_TESSERACT_PATH || "tesseract";
  return await new Promise((resolve) => {
    let child;
    try {
      child = spawn(
        /*turbopackIgnore: true*/
        executable,
        ["stdin", "stdout", "-l", "eng+hin+mar", "--psm", "3", "tsv"],
        {
          stdio: ["pipe", "pipe", "ignore"],
          env: {
            PATH: process.env.PATH,
            TESSDATA_PREFIX: process.env.TESSDATA_PREFIX,
          },
        },
      );
    } catch {
      resolve({
        text: "",
        items: [],
        status: "unavailable",
        warning: "OCR_ENGINE_UNAVAILABLE",
      });
      return;
    }
    const chunks = [];
    let length = 0;
    let done = false;
    const finish = (result) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve(result);
      }
    };
    const timer = setTimeout(
      () => {
        child.kill("SIGKILL");
        finish({
          text: "",
          items: [],
          status: "failed",
          warning: "OCR_TIMEOUT",
        });
      },
      Math.min(maxDurationMs, 10000),
    );
    child.stdout.on("data", (chunk) => {
      length += chunk.length;
      if (length > 2_000_000) {
        child.kill("SIGKILL");
        finish({
          text: "",
          items: [],
          status: "failed",
          warning: "OCR_OUTPUT_LIMIT",
        });
      } else chunks.push(chunk);
    });
    child.on("error", (error) =>
      finish({
        text: "",
        items: [],
        status: error.code === "ENOENT" ? "unavailable" : "failed",
        warning:
          error.code === "ENOENT" ? "OCR_ENGINE_UNAVAILABLE" : "OCR_FAILED",
      }),
    );
    child.on("close", (code) => {
      if (code !== 0) {
        finish({
          text: "",
          items: [],
          status: "unavailable",
          warning: "OCR_LANGUAGE_DATA_UNAVAILABLE",
        });
        return;
      }
      const rows = Buffer.concat(chunks)
        .toString("utf8")
        .split(/\r?\n/)
        .slice(1);
      const items = [];
      for (const row of rows) {
        const fields = row.split("\t");
        const confidence = Number(fields[10]);
        const word = fields.slice(11).join("\t").trim();
        if (!word || !Number.isFinite(confidence) || confidence < 0) continue;
        const left = Number(fields[6]),
          top = Number(fields[7]),
          width = Number(fields[8]),
          height = Number(fields[9]);
        items.push({
          text: word,
          method: "ocr",
          confidence,
          geometry: {
            coordinateSpace: "image-pixels",
            transform: [1, 0, 0, 1, left, top],
            width,
            height,
          },
        });
      }
      const text = items.map((item) => item.text).join(" ");
      finish({
        text,
        items,
        status: text ? "completed" : "failed",
        warning: text
          ? items.some((item) => item.confidence < 60)
            ? "OCR_LOW_CONFIDENCE"
            : null
          : "OCR_NO_TEXT",
      });
    });
    child.stdin.end(png);
  });
}
