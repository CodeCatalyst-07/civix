export type AnalysisFailureCode =
  | "unsupported_document"
  | "invalid_document"
  | "input_too_large"
  | "invalid_json"
  | "invalid_schema"
  | "invalid_evidence"
  | "provider_failure"
  | "analysis_timeout"
  | "empty_response";

export type AnalysisDiagnostic = {
  stage:
    | "input_validation"
    | "document_validation"
    | "eligibility"
    | "context_construction"
    | "provider_request"
    | "response_parsing"
    | "schema_validation"
    | "evidence_grounding"
    | "analysis_validation";
  category: string;
  providerCategory?: string;
};

export type AnalysisOutcome =
  | {
      status: "complete" | "partial" | "needs_review";
      analysis: import("../contracts/analysis").CivicAnalysis;
    }
  | {
      status: "unsupported" | "failed";
      code: AnalysisFailureCode;
      message: string;
      diagnostic?: AnalysisDiagnostic;
      contextLimit?: {
        sourceTextChars: number;
        serializedContextChars: number;
        maximumContextChars: number;
      };
    };
