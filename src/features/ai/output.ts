import {
  extractionSchema,
  MAX_RESPONSE_CHARS,
  type Extraction,
} from "./contracts";
import { AIError } from "./errors";

export function parseExtraction(text: string): Extraction {
  if (text.length > MAX_RESPONSE_CHARS)
    throw new AIError("AI_INVALID_OUTPUT", { outputFailure: "json" });
  let json = text.trim();
  // Only a whole, single fenced object is accepted. Never extract substrings.
  if (json.startsWith("```")) {
    const lines = json.split(/\r?\n/);
    if (
      !["```", "```json"].includes(lines[0] ?? "") ||
      lines.at(-1) !== "```" ||
      lines.slice(1, -1).some((line) => line.includes("```"))
    ) {
      throw new AIError("AI_INVALID_OUTPUT", { outputFailure: "json" });
    }
    json = lines.slice(1, -1).join("\n");
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new AIError("AI_INVALID_OUTPUT", { outputFailure: "json" });
  }
  const result = extractionSchema.safeParse(value);
  if (!result.success)
    throw new AIError("AI_INVALID_OUTPUT", { outputFailure: "schema" });
  return result.data;
}

/** Limited transcription check, independent of structural validation. */
export function checkExtractionLiterals(
  data: Extraction,
  source: string,
): void {
  for (const literal of [data.deadlineText, data.feeText]) {
    if (literal !== null && !source.includes(literal))
      throw new AIError("AI_INVALID_OUTPUT");
  }
}
