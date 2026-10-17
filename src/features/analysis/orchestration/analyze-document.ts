import { createGemmaProvider } from "@/features/ai/google-gemma";
import type { Generation } from "@/features/ai/contracts";
import type { RequestDiagnostic } from "@/features/ai/diagnostics";
import { AIError } from "@/features/ai/errors";
import { normalizedDocumentSchema } from "@/features/documents/contracts/processing";
import {
  analysisInputSchema,
  civicAnalysisSchema,
  extractionResultSchema,
  type AnalysisInput,
} from "../contracts/analysis";
import type { AnalysisOutcome } from "../errors/errors";
import { checkEligibility } from "../eligibility";
import { buildSourceContext } from "../source-context";
import { buildExtractionPrompt } from "../prompts/extraction";
import { groundEvidence } from "../grounding/grounding";
import { interpretDeadline } from "../deadlines/interpret";

export type TextGenerator = Pick<
  ReturnType<typeof createGemmaProvider>,
  "generateText"
>;
const publicFailure =
  "The document could not be analyzed safely. No action plan was produced.";

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
function statusFor(
  mandatory: boolean | null,
): "mandatory" | "optional" | "uncertain" {
  return mandatory === true
    ? "mandatory"
    : mandatory === false
      ? "optional"
      : "uncertain";
}
function feeSemantics(statement: string) {
  if (
    /\bno\s+(?:\w+\s+){0,2}fee\s+(?:is\s+)?(?:payable|required|charged)\b|\bfee\s+is\s+not\s+payable\b|\bfee\s+is\s+waived\b/i.test(
      statement,
    )
  )
    return {
      semantics: "explicitly_no_fee" as const,
      amount: "0",
      currency: null,
    };
  const amount =
    /₹\s*(\d+(?:\.\d{1,4})?)\b|\b(INR|USD|EUR)\s*(\d+(?:\.\d{1,4})?)\b/i.exec(
      statement,
    );
  if (amount) {
    const currency = amount[0]!.startsWith("₹")
      ? "INR"
      : amount[2]!.toUpperCase();
    return {
      semantics: "explicit_amount" as const,
      amount: amount[1] ?? amount[3]!,
      currency,
    };
  }
  return {
    semantics: "mentioned_amount_unknown" as const,
    amount: null,
    currency: null,
  };
}

export async function analyzeDocument(
  input: AnalysisInput,
  options: {
    provider?: TextGenerator;
    maxContextChars?: number;
    now?: () => Date;
    onProviderDiagnostic?: (diagnostic: RequestDiagnostic) => void;
  } = {},
): Promise<AnalysisOutcome> {
  const parsedInput = analysisInputSchema.safeParse(input);
  if (!parsedInput.success)
    return {
      status: "failed",
      code: "invalid_document",
      message: "Analysis input failed validation.",
      diagnostic: {
        stage: "input_validation",
        category: "invalid_analysis_input",
      },
    };
  const {
    document: doc,
    requestedOutputLanguage,
    trustedReferenceDate,
    trustedReferenceEvent,
    relativeDeadlineSemantics,
  } = parsedInput.data;
  const documentResult = normalizedDocumentSchema.safeParse(doc);
  if (!documentResult.success)
    return {
      status: "failed",
      code: "invalid_document",
      message: "The normalized document failed validation.",
      diagnostic: {
        stage: "document_validation",
        category: "invalid_normalized_document",
      },
    };
  const eligibility = checkEligibility(documentResult.data);
  if (!eligibility.supported)
    return {
      status: "unsupported",
      code: "unsupported_document",
      message: eligibility.message,
      diagnostic: { stage: "eligibility", category: "no_selectable_text" },
    };
  const built = buildSourceContext(
    documentResult.data,
    options.maxContextChars,
  );
  if (!built.ok)
    return {
      status: "unsupported",
      code:
        built.reason === "too_large"
          ? "input_too_large"
          : "unsupported_document",
      message: built.message,
      diagnostic: {
        stage: "context_construction",
        category:
          built.reason === "too_large"
            ? "context_limit_exceeded"
            : "unsupported_source_context",
      },
      ...(built.contextLimit ? { contextLimit: built.contextLimit } : {}),
    };
  let generation: Generation;
  try {
    generation = await (
      options.provider ??
      createGemmaProvider({
        ...(options.onProviderDiagnostic
          ? { onDiagnostic: options.onProviderDiagnostic }
          : {}),
      })
    ).generateText(
      buildExtractionPrompt(built.context.text, requestedOutputLanguage),
    );
  } catch (error) {
    const code = error instanceof AIError ? error.code : null;
    return {
      status: "failed",
      code:
        code === "AI_TIMEOUT"
          ? "analysis_timeout"
          : code === "AI_EMPTY_RESPONSE"
            ? "empty_response"
            : "provider_failure",
      message: publicFailure,
      diagnostic: {
        stage: "provider_request",
        category: "provider_request_failed",
        providerCategory: code ?? "unknown_provider_error",
      },
    };
  }
  if (!generation.text.trim())
    return {
      status: "failed",
      code: "empty_response",
      message: publicFailure,
      diagnostic: { stage: "response_parsing", category: "empty_response" },
    };
  const raw = parseJson(generation.text);
  if (raw === null)
    return {
      status: "failed",
      code: "invalid_json",
      message: publicFailure,
      diagnostic: { stage: "response_parsing", category: "invalid_json" },
    };
  const extraction = extractionResultSchema.safeParse(raw);
  if (!extraction.success)
    return {
      status: "failed",
      code: "invalid_schema",
      message: publicFailure,
      diagnostic: {
        stage: "schema_validation",
        category: "extraction_schema_invalid",
      },
    };
  const value = extraction.data;
  const grounded = (claim: {
    text: string;
    evidence: typeof value.summary.evidence;
  }) => {
    const evidence = groundEvidence(doc, claim.evidence);
    return evidence
      ? {
          text: claim.text,
          evidence,
          sourceReferenceStatus: "valid" as const,
          semanticSupportStatus: "unverified" as const,
          verificationStatus: "human_review_required" as const,
        }
      : null;
  };
  const summary = grounded(value.summary);
  const issuer = value.issuer === null ? null : grounded(value.issuer);
  const consequences = value.consequences.map(grounded);
  const actions = value.actions.map((item) => ({
    item,
    evidence: groundEvidence(doc, item.evidence),
  }));
  const deadlines = value.deadlines.map((item) => ({
    item,
    evidence: groundEvidence(doc, item.evidence),
    interpretation: (() => {
      const base = interpretDeadline(item.expression);
      const sameReferenceEvent =
        !!trustedReferenceDate &&
        trustedReferenceEvent?.trim().toLowerCase() ===
          base.referenceEvent?.trim().toLowerCase();
      return interpretDeadline(
        item.expression,
        sameReferenceEvent ? trustedReferenceDate : undefined,
        sameReferenceEvent ? relativeDeadlineSemantics : undefined,
      );
    })(),
  }));
  const requiredDocuments = value.requiredDocuments.map((item) => ({
    item,
    evidence: groundEvidence(doc, item.evidence),
  }));
  const fees = value.fees.map((item) => ({
    item,
    evidence: groundEvidence(doc, item.evidence),
    sourceText: item.evidence.map((citation) => citation.excerpt).join(" "),
  }));
  if (
    deadlines.some(
      ({ item }) =>
        !item.evidence.some((citation) =>
          citation.excerpt.includes(item.expression),
        ),
    )
  )
    return {
      status: "failed",
      code: "invalid_evidence",
      message: publicFailure,
      diagnostic: {
        stage: "evidence_grounding",
        category: "deadline_evidence_mismatch",
      },
    };
  if (
    !summary ||
    (value.issuer !== null && !issuer) ||
    consequences.some((x) => !x) ||
    [actions, deadlines, requiredDocuments, fees].some((items) =>
      items.some((x) => !x.evidence),
    )
  )
    return {
      status: "failed",
      code: "invalid_evidence",
      message: publicFailure,
      diagnostic: {
        stage: "evidence_grounding",
        category: "claim_evidence_not_grounded",
      },
    };

  const analysis = civicAnalysisSchema.safeParse({
    analysisId: `analysis-${doc.id}-${(options.now ?? (() => new Date()))().getTime()}`,
    documentId: doc.id,
    analysisStatus: eligibility.partial ? "partial" : "needs_review",
    coverage: {
      includedPages: built.context.includedPages,
      omittedPages: eligibility.omittedPages,
      complete: !eligibility.partial,
    },
    detectedLanguage: value.detectedLanguage,
    requestedOutputLanguage,
    documentType: value.documentType,
    summary,
    issuer,
    requiredActions: actions.map(({ item, evidence }, index) => ({
      id: `action-${index + 1}`,
      description: item.description,
      mandatoryStatus: statusFor(item.mandatory),
      deadlineReference: null,
      evidence: evidence!,
      verificationStatus: "human_review_required" as const,
    })),
    deadlines: deadlines.map(({ item, evidence, interpretation }) => ({
      sourceExpression: item.expression,
      ...interpretation,
      verificationStatus: "human_review_required" as const,
      evidence: evidence!,
    })),
    requiredDocuments: requiredDocuments.map(({ item, evidence }) => ({
      name: item.name,
      mandatoryStatus: statusFor(item.mandatory),
      evidence: evidence!,
      verificationStatus: "human_review_required" as const,
    })),
    fees: fees.map(({ item, evidence, sourceText }) => ({
      statement: item.statement,
      ...feeSemantics(sourceText),
      evidence: evidence!,
      verificationStatus: "human_review_required" as const,
    })),
    feeInformationStatus: (() => {
      if (
        fees.some(
          ({ sourceText }) =>
            feeSemantics(sourceText).semantics === "explicitly_no_fee",
        )
      )
        return "explicit_no_fee";
      if (
        fees.some(
          ({ sourceText }) =>
            feeSemantics(sourceText).semantics === "explicit_amount",
        )
      )
        return "stated";
      if (fees.length) return "mentioned_amount_unknown";
      if (
        doc.pages
          .filter((page) =>
            built.context.includedPages.includes(page.pageNumber),
          )
          .some((page) =>
            /\b(fee|fees|charge|charges|payment|payable)\b|शुल्क|फी|शुल्काची/i.test(
              page.text,
            ),
          )
      )
        return "unclear";
      return "not_found";
    })(),
    consequences: consequences,
    missingInformation: value.missingInformation,
    uncertainties: value.uncertainties,
    warnings: [
      "Civix provides independent information assistance, not an official government service or legal advice.",
      ...(eligibility.partial
        ? [
            "Some pages were not text-extracted; this analysis covers only the listed pages.",
          ]
        : []),
      ...(new Set(
        deadlines
          .map(({ interpretation }) => interpretation.explicitDate)
          .filter(Boolean),
      ).size > 1
        ? [
            "The cited text contains different explicit deadline dates; confirm which applies.",
          ]
        : []),
      ...(requiredDocuments.length === 0
        ? [
            "No supporting document requirement was extracted; this does not establish that none is required.",
          ]
        : []),
      "Claim support is not automatically established; review each cited passage against the official document.",
    ],
    processingMetadata: {
      model: generation.model,
      modelVersion: generation.modelVersion,
      ...(generation.usage ?? {
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      }),
    },
  });
  if (!analysis.success)
    return {
      status: "failed",
      code: "invalid_schema",
      message: publicFailure,
      diagnostic: {
        stage: "analysis_validation",
        category: "analysis_schema_invalid",
      },
    };
  return { status: analysis.data.analysisStatus, analysis: analysis.data };
}
