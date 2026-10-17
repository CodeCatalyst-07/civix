import type { AnalysisResult } from "@/features/analysis/schemas/analysis";
import type { DocumentMetadata } from "@/features/documents/schemas/document";

export type SyntheticFixture = {
  synthetic: true;
  name: string;
  source: string;
  document: DocumentMetadata;
  expectedAnalysis: AnalysisResult;
};

const timestamp = "2026-10-01T09:00:00Z";
const sources = [
  "SYNTHETIC EXAMPLE — NOT AN OFFICIAL DOCUMENT\nFictional Meadowglass Civic Applications Department\nReference: SYN-MG-2026-014\nIssue date: 1 October 2026\nYour application is missing address proof. Submit a copy of address proof at the fictional Meadowglass application desk before 25 October 2026. Quote reference SYN-MG-2026-014 with your submission. If the missing document is not submitted, the application will be closed. No submission fee is payable.",
  "SYNTHETIC EXAMPLE — NOT AN OFFICIAL DOCUMENT\nFictional Cloudfern Records Department\nReference: SYN-CF-2026-008\nIssue date: 1 October 2026\nSubmit the signed correction form to the fictional Cloudfern records desk within 15 days of receiving this notice. Include reference SYN-CF-2026-008. Receipt date has not been recorded. The notice does not specify a fee.",
  "SYNTHETIC EXAMPLE — NOT AN OFFICIAL DOCUMENT\nService Desk [issuing department not identified]\nReference: SYN-UN-2026-003\nIssue date: 1 October 2026\nYour request requires attention. Please respond as soon as possible. The destination and required materials are omitted from this incomplete copy.",
] as const;

function base(
  index: number,
  title: string,
  authority: string | null,
  quotation: string,
): SyntheticFixture {
  const id = `synthetic-document-${index}`;
  return {
    synthetic: true,
    name: title,
    source: sources[index - 1] ?? "",
    document: {
      id,
      originalFilename: `synthetic-notice-${index}.pdf`,
      mimeType: "application/pdf",
      // Fictional metadata: no physical PDF or extracted-byte count is asserted.
      fileSizeBytes: 1024,
      pageCount: 1,
      originalLanguage: "en",
      category: "municipal_document",
      createdAt: timestamp,
      status: "completed",
    },
    expectedAnalysis: {
      id: `synthetic-analysis-${index}`,
      documentId: id,
      modelIdentifier: "synthetic-manual-fixture",
      analyzedAt: timestamp,
      status: "completed",
      summary: {
        title,
        category: "municipal_document",
        issuingAuthority: authority,
        sourceLanguage: "en",
        plainLanguageSummary: "Synthetic notice requiring review.",
        actionRequired: true,
        evidenceIds: ["e1"],
        warnings: [],
      },
      actions: [],
      deadlines: [],
      fees: [],
      requiredDocuments: [],
      evidence: [
        {
          id: "e1",
          documentId: id,
          pageNumber: 1,
          quotation,
          verificationStatus: "unverified",
        },
      ],
      warnings: [
        "Entirely synthetic training fixture; no real office, applicant, or AI invocation.",
      ],
    },
  };
}

const municipal = base(
  1,
  "Missing address proof",
  "Fictional Meadowglass Civic Applications Department",
  "Your application is missing address proof.",
);
municipal.expectedAnalysis.summary.plainLanguageSummary =
  "Submit address proof before 25 October 2026 and include the fictional reference. The application will be closed if the document is not submitted. No submission fee is payable.";
municipal.expectedAnalysis.evidence.push(
  {
    id: "e2",
    documentId: municipal.document.id,
    pageNumber: 1,
    quotation:
      "Submit a copy of address proof at the fictional Meadowglass application desk before 25 October 2026.",
    verificationStatus: "unverified",
  },
  {
    id: "e3",
    documentId: municipal.document.id,
    pageNumber: 1,
    quotation: "No submission fee is payable.",
    verificationStatus: "unverified",
  },
  {
    id: "e4",
    documentId: municipal.document.id,
    pageNumber: 1,
    quotation:
      "If the missing document is not submitted, the application will be closed.",
    verificationStatus: "unverified",
  },
  {
    id: "e5",
    documentId: municipal.document.id,
    pageNumber: 1,
    quotation: "Quote reference SYN-MG-2026-014 with your submission.",
    verificationStatus: "unverified",
  },
);
municipal.expectedAnalysis.summary.evidenceIds = ["e1", "e2", "e3", "e4", "e5"];
municipal.expectedAnalysis.actions = [
  {
    id: "submit-address-proof",
    description:
      "Submit address proof to the fictional Meadowglass application desk, quoting SYN-MG-2026-014.",
    mandatory: true,
    evidenceIds: ["e2", "e5"],
  },
];
municipal.expectedAnalysis.deadlines = [
  {
    id: "submission-deadline",
    kind: "absolute",
    originalText: "before 25 October 2026",
    normalizedDate: "2026-10-25",
    verificationStatus: "unverified",
    evidenceIds: ["e2"],
  },
];
municipal.expectedAnalysis.fees = [
  {
    id: "submission-fee",
    amount: "0",
    currency: null,
    originalAmountText: "No submission fee is payable.",
    description: "No submission fee",
    evidenceIds: ["e3"],
  },
];
municipal.expectedAnalysis.requiredDocuments = [
  {
    id: "address-proof",
    name: "Address proof",
    description: "A copy of address proof",
    mandatory: true,
    evidenceIds: ["e1", "e2"],
  },
];

const relative = base(
  2,
  "Correction form request",
  "Fictional Cloudfern Records Department",
  "Submit the signed correction form to the fictional Cloudfern records desk within 15 days of receiving this notice.",
);
relative.expectedAnalysis.summary.plainLanguageSummary =
  "Submit the signed correction form within 15 days of receiving the notice. The receipt date is unknown, so a calendar deadline cannot be determined.";
relative.expectedAnalysis.actions = [
  {
    id: "submit-correction",
    description:
      "Submit the signed correction form to the fictional Cloudfern records desk.",
    mandatory: true,
    evidenceIds: ["e1"],
  },
];
relative.expectedAnalysis.deadlines = [
  {
    id: "receipt-deadline",
    kind: "relative",
    originalText: "within 15 days of receiving this notice",
    duration: { value: 15, unit: "days" },
    anchorEvent: "Receipt of this notice",
    anchorDate: null,
    normalizedDate: null,
    verificationStatus: "unverified",
    evidenceIds: ["e1"],
  },
];
relative.expectedAnalysis.requiredDocuments = [
  {
    id: "correction-form",
    name: "Signed correction form",
    description: null,
    mandatory: true,
    evidenceIds: ["e1"],
  },
];
relative.expectedAnalysis.fees = [
  {
    id: "unknown-fee",
    amount: null,
    currency: null,
    originalAmountText: null,
    description: "Fee not specified",
    evidenceIds: [],
  },
];
relative.expectedAnalysis.warnings.push(
  "Receipt date is unknown. No absolute deadline was calculated.",
);

const incomplete = base(
  3,
  "Incomplete request notice",
  null,
  "Please respond as soon as possible.",
);
incomplete.document.category = "unknown";
incomplete.expectedAnalysis.summary.category = "unknown";
incomplete.expectedAnalysis.status = "partial";
incomplete.expectedAnalysis.summary.actionRequired = "unknown";
incomplete.expectedAnalysis.summary.plainLanguageSummary =
  "This incomplete copy requests a response but does not identify a clear issuing authority, destination, required materials, fee, or calendar deadline.";
incomplete.expectedAnalysis.summary.warnings = [
  "Issuing authority and instructions are incomplete.",
];
incomplete.expectedAnalysis.deadlines = [
  {
    id: "unclear-deadline",
    kind: "uncertain",
    originalText: "as soon as possible",
    normalizedDate: null,
    reason: "No determinable calendar date or duration is supplied.",
    verificationStatus: "unavailable",
    evidenceIds: ["e1"],
  },
];
incomplete.expectedAnalysis.fees = [
  {
    id: "unspecified-fee",
    amount: null,
    currency: null,
    originalAmountText: null,
    description: "No fee specified in available content",
    evidenceIds: [],
  },
];
incomplete.expectedAnalysis.warnings.push(
  "Missing fee does not mean free. Required materials and destination are unknown.",
);

export const syntheticFixtures: readonly SyntheticFixture[] = [
  municipal,
  relative,
  incomplete,
];
