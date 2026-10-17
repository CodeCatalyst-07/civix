import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import { groundEvidence } from "@/features/analysis/grounding/grounding";
import { processDocument } from "@/features/documents/processing/process-document";
import { classifyDocument } from "@/features/documents/processing/classify-document";

const previousTesseract = process.env.CIVIX_TESSERACT_PATH;
afterEach(() => {
  if (previousTesseract === undefined) delete process.env.CIVIX_TESSERACT_PATH;
  else process.env.CIVIX_TESSERACT_PATH = previousTesseract;
});

describe("Phase 6 classification and OCR evidence", () => {
  it("classifies a fictional notice conservatively and leaves authenticity unknown", () => {
    const classification = classifyDocument([
      {
        pageNumber: 1,
        extractionStatus: "text_extracted",
        rawText:
          "PUBLIC NOTICE\nIssued by: Meadowglass Municipal Office\nNotice No: SYN-204\nDate: 12.04.2026",
        text: "PUBLIC NOTICE\nIssued by: Meadowglass Municipal Office\nNotice No: SYN-204\nDate: 12.04.2026",
        segments: [],
        needsVisualProcessing: false,
        warnings: [],
        ocrStatus: "not_needed",
      },
    ]);
    expect(classification).toMatchObject({
      category: "government_notice",
      issuingAuthority: "Meadowglass Municipal Office",
      referenceNumber: "SYN-204",
      issueDate: "12.04.2026",
      authenticity: "not_verified",
    });
    expect(
      classifyDocument([
        {
          pageNumber: 1,
          text: "Electricity bill consumer number 12345 units consumed",
          rawText: "",
          segments: [],
          extractionStatus: "text_extracted",
          needsVisualProcessing: false,
          warnings: [],
          ocrStatus: "not_needed",
        },
      ]).category,
    ).toBe("unknown_or_unsupported");
    expect(
      classifyDocument([
        {
          pageNumber: 1,
          text: "Unrelated personal letter",
          rawText: "",
          segments: [],
          extractionStatus: "text_extracted",
          needsVisualProcessing: false,
          warnings: [],
          ocrStatus: "not_needed",
        },
      ]).category,
    ).toBe("unknown_or_unsupported");
  });

  it("keeps English, Hindi, and Marathi OCR excerpts page-bound and traceable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "civix-ocr-fixture-"));
    const executable = join(directory, "fake-tesseract");
    try {
      for (const excerpt of [
        "SYNTHETIC notice",
        "काल्पनिक सूचना",
        "काल्पनिक सूचना",
      ]) {
        const tsv = excerpt
          .split(" ")
          .map(
            (word, index) =>
              `5\t1\t1\t1\t1\t${index + 1}\t${index * 90}\t20\t80\t18\t92.00\t${word}`,
          )
          .join("\n");
        await writeFile(
          executable,
          `#!/bin/sh\nprintf '%s\\n' 'level\\tpage_num\\tblock_num\\tpar_num\\tline_num\\tword_num\\tleft\\ttop\\twidth\\theight\\tconf\\ttext'\nprintf '%s\\n' '${tsv}'\n`,
        );
        await chmod(executable, 0o700);
        process.env.CIVIX_TESSERACT_PATH = executable;
        const bytes = new Uint8Array(
          await readFile(
            new URL(
              "../features/documents/fixtures/files/notice.png",
              import.meta.url,
            ),
          ),
        );
        const result = await processDocument({
          bytes,
          originalFilename: "fictional-notice.png",
          declaredMimeType: "image/png",
        });
        expect(result.ok).toBe(true);
        if (!result.ok) continue;
        try {
          const page = result.value.document.pages[0]!;
          expect(page.ocrStatus).toBe("completed");
          expect(page.text).toContain(excerpt);
          const segment = page.segments.find(
            (item) => item.text === excerpt.split(" ")[0],
          )!;
          expect(segment.extractionMethod).toBe("ocr");
          expect(segment.geometry?.coordinateSpace).toBe("image-pixels");
          expect(segment.confidence).toBe(92);
          expect(
            groundEvidence(result.value.document, [
              { pageNumber: 1, segmentId: segment.id, excerpt: segment.text },
            ])?.[0],
          ).toMatchObject({
            pageNumber: 1,
            extractionMethod: "ocr",
            excerpt: segment.text,
            provenanceStatus: "source_matched",
          });
        } finally {
          result.value.dispose();
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
