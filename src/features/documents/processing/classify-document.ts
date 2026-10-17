import type { NormalizedDocument } from "../contracts/processing";

/** Conservative text cues only. This classifies content; it cannot establish authenticity. */
export function classifyDocument(pages: NormalizedDocument["pages"]) {
  const text = pages.map((page) => page.text).join("\n");
  const lower = text.toLowerCase();
  const contains = (...terms: string[]) =>
    terms.some((term) => lower.includes(term));
  const utilityBill = contains(
    "electricity bill",
    "consumer number",
    "meter reading",
    "units consumed",
    " बिजली बिल",
    "वीज बिल",
  );
  let category:
    | "government_notice"
    | "official_departmental_letter"
    | "application_or_verification_request"
    | "government_scheme"
    | "certificate_or_record"
    | "public_circular_or_notification"
    | "unknown_or_unsupported" = "unknown_or_unsupported";
  if (!utilityBill) {
    if (
      contains(
        "public notice",
        "show cause notice",
        "notice to",
        "कारण बताओ",
        "सूचना क्रमांक",
      )
    )
      category = "government_notice";
    else if (contains("circular", "notification", "परिपत्र", "अधिसूचना"))
      category = "public_circular_or_notification";
    else if (contains("scheme", "yojana", "योजना", "शासन योजना"))
      category = "government_scheme";
    else if (
      contains("application", "verification", "सत्यापन", "अर्ज", "आवेदन")
    )
      category = "application_or_verification_request";
    else if (contains("certificate", "record", "प्रमाणपत्र", "दाखला"))
      category = "certificate_or_record";
    else if (contains("department", "विभाग", "कार्यालय", "office of"))
      category = "official_departmental_letter";
  }
  const firstLine =
    text
      .split(/\n/)
      .map((line) => line.trim())
      .find((line) => line.length >= 5 && line.length <= 180) ?? null;
  const find = (patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1])
        return match[1]
          .trim()
          .replace(/[.,;:]+$/, "")
          .slice(0, 180);
    }
    return null;
  };
  const officialCue = contains(
    "government",
    "department",
    "municipal",
    "collector",
    "भारत सरकार",
    "महाराष्ट्र शासन",
    "शासन",
    "विभाग",
  );
  return {
    category,
    title: category === "unknown_or_unsupported" ? null : firstLine,
    documentType:
      category === "unknown_or_unsupported"
        ? null
        : category.replaceAll("_", " "),
    issuingAuthority: officialCue
      ? find([
          /(?:issued by|from|department|office of)\s*[:\-]?\s*([^\n]{3,120})/i,
          /(भारत सरकार[^\n]{0,100}|महाराष्ट्र शासन[^\n]{0,100})/,
        ])
      : null,
    referenceNumber: find([
      /\b(?:reference|ref\.?)\b\s*(?:no\.?|number)?\s*[:#\-]?\s*([A-Z0-9][A-Z0-9./-]{2,39})/i,
      /\bnotice[ \t]*(?:no\.?|number)[ \t]*[:#\-]?[ \t]*([A-Z0-9][A-Z0-9./-]{2,39})/i,
      /(?:पत्र|जा\.क्र\.?|क्रमांक)\s*(?:संख्या|क्रमांक)?\s*[:#\-]?\s*([A-Z0-9][A-Z0-9./-]{2,39})/i,
    ]),
    issueDate: find([
      /(?:date|दिनांक)\s*[:\-]?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})/i,
    ]),
    recipient: find([
      /(?:to|recipient|प्रति|सेवा में)\s*[:\-]?\s*([^\n]{3,120})/i,
    ]),
    purpose: category === "unknown_or_unsupported" ? null : firstLine,
    authenticity: "not_verified" as const,
  };
}
