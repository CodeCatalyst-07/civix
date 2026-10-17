"use client";

import { useRef, useState } from "react";
import type {
  CivicAnalysis,
  OutputLanguage,
} from "@/features/analysis/contracts/analysis";

type ApiResult = {
  status: string;
  synthetic?: boolean;
  analysis?: CivicAnalysis;
  document?: {
    classification: {
      category: string;
      title: string | null;
      documentType: string | null;
      issuingAuthority: string | null;
      referenceNumber: string | null;
      issueDate: string | null;
      recipient: string | null;
      purpose: string | null;
      authenticity: "not_verified";
    };
    warnings: string[];
    pages: Array<{
      pageNumber: number;
      ocrStatus: string;
      warnings: string[];
      readable: boolean;
    }>;
    partial: boolean;
  };
  error?: {
    code: string;
    message: string;
    contextLimit?: {
      sourceTextChars: number;
      serializedContextChars: number;
      maximumContextChars: number;
    };
    diagnostic?: {
      stage: string;
      category: string;
      providerCategory?: string;
      mockEnabled: boolean;
      providerAttempts?: Array<{
        attempt: number;
        durationMs: number;
        httpStatus: number | null;
        errorCategory: string | null;
        timeoutSource: string | null;
        dispatched: boolean;
      }>;
    };
    document?: {
      classification: {
        category: string;
        documentType?: string | null;
        issuingAuthority?: string | null;
        referenceNumber?: string | null;
        issueDate?: string | null;
        authenticity?: string;
      };
      warnings: string[];
      pages: Array<{
        pageNumber: number;
        warnings: string[];
        readable: boolean;
      }>;
    };
  };
};
const copy = {
  en: {
    eyebrow: "A clearer next step",
    title: "Make sense of official documents.",
    sub: "Understand what a notice says, what it asks you to do, and what still needs checking.",
    upload: "Choose a document",
    drop: "Drop a PDF or image here, or browse files",
    button: "Analyze document",
    busy: "Reading your document…",
    summary: "In plain language",
    actions: "What to do",
    deadlines: "Dates to check",
    docs: "Documents to prepare",
    fees: "Fees",
    consequences: "What the document says may happen",
    unknown: "What is missing or unclear",
    evidence: "Source evidence",
    disclaimer:
      "Civix is independent information assistance, not an official government service or legal advice. AI claims are not officially verified.",
  },
  hi: {
    eyebrow: "अगला कदम स्पष्ट करें",
    title: "सरकारी दस्तावेज़ों को समझें।",
    sub: "जानें कि नोटिस क्या कहता है, आपसे क्या करने को कहता है, और किन बातों की जाँच बाकी है।",
    upload: "दस्तावेज़ चुनें",
    drop: "PDF या छवि यहाँ छोड़ें, या फ़ाइल चुनें",
    button: "दस्तावेज़ का विश्लेषण करें",
    busy: "दस्तावेज़ पढ़ा जा रहा है…",
    summary: "सरल भाषा में",
    actions: "क्या करें",
    deadlines: "जाँचने की तारीखें",
    docs: "तैयार रखने वाले दस्तावेज़",
    fees: "शुल्क",
    consequences: "दस्तावेज़ में बताए संभावित परिणाम",
    unknown: "क्या जानकारी अधूरी या अस्पष्ट है",
    evidence: "स्रोत प्रमाण",
    disclaimer:
      "Civix स्वतंत्र जानकारी सहायता है, सरकारी सेवा या कानूनी सलाह नहीं। AI के दावे आधिकारिक रूप से सत्यापित नहीं हैं।",
  },
  mr: {
    eyebrow: "पुढचे पाऊल स्पष्ट",
    title: "अधिकृत कागदपत्रे समजून घ्या.",
    sub: "सूचना काय सांगते, कोणती कृती अपेक्षित आहे आणि काय तपासणे बाकी आहे ते जाणून घ्या.",
    upload: "कागदपत्र निवडा",
    drop: "PDF किंवा प्रतिमा येथे टाका, किंवा फाइल निवडा",
    button: "कागदपत्राचे विश्लेषण करा",
    busy: "कागदपत्र वाचत आहे…",
    summary: "सोप्या भाषेत",
    actions: "काय करावे",
    deadlines: "तपासण्याच्या तारखा",
    docs: "तयार ठेवायची कागदपत्रे",
    fees: "शुल्क",
    consequences: "कागदपत्रात नमूद केलेले संभाव्य परिणाम",
    unknown: "काय अपूर्ण किंवा अस्पष्ट आहे",
    evidence: "स्रोत पुरावा",
    disclaimer:
      "Civix ही स्वतंत्र माहिती सहाय्य सेवा आहे; सरकारी सेवा किंवा कायदेशीर सल्ला नाही. AI दावे अधिकृतरीत्या पडताळलेले नाहीत.",
  },
} as const;
type Labels = (typeof copy)[OutputLanguage];

export default function Home() {
  const [language, setLanguage] = useState<OutputLanguage>("en");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ApiResult | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const t = copy[language];
  const choose = (next?: File) => {
    setResult(null);
    setError("");
    if (!next) return;
    if (!/\.(pdf|png|jpe?g)$/i.test(next.name)) {
      setFile(null);
      setError("Choose a PDF, PNG, or JPEG file.");
      return;
    }
    if (next.size > 10 * 1024 * 1024) {
      setFile(null);
      setError("This file is larger than 10 MiB.");
      return;
    }
    setFile(next);
  };
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("language", language);
      const response = await fetch("/api/analyze", { method: "POST", body });
      const payload = (await response.json()) as ApiResult;
      if (!response.ok || !payload.analysis) {
        if (payload.error?.document) setResult(payload);
        if (payload.error?.contextLimit) {
          const limit = payload.error.contextLimit;
          throw new Error(
            `This document has ${limit.sourceTextChars.toLocaleString()} characters of selectable text (${limit.serializedContextChars.toLocaleString()} characters in the analysis context), above the safe single-request limit of ${limit.maximumContextChars.toLocaleString()}. No partial analysis was produced. Try a shorter document or split the PDF into smaller files.`,
          );
        }
        const message =
          payload.error?.message ?? "Analysis could not be completed.";
        const diagnostic = payload.error?.diagnostic;
        throw new Error(
          diagnostic
            ? `${message} [Development diagnostic: stage=${diagnostic.stage}, category=${diagnostic.category}, mock=${diagnostic.mockEnabled ? "enabled" : "disabled"}${diagnostic.providerCategory ? `, provider=${diagnostic.providerCategory}` : ""}${diagnostic.providerAttempts?.length ? `, attempts=${diagnostic.providerAttempts.length}, HTTP=${diagnostic.providerAttempts.at(-1)?.httpStatus ?? "unknown"}, timeout=${diagnostic.providerAttempts.at(-1)?.timeoutSource ?? "none"}` : ""}]`
            : message,
        );
      }
      setResult(payload);
      requestAnimationFrame(() =>
        resultsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Analysis failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Civix home">
          <span className="brand-mark">c</span> civix
        </a>
        <nav aria-label="Main navigation">
          <a href="#how">How it works</a>
          <a href="#about">About Civix</a>
        </nav>
        <label className="language">
          <span className="sr-only">Output language</span>
          <select
            value={language}
            onChange={(e) => {
              setLanguage(e.target.value as OutputLanguage);
              setResult(null);
            }}
          >
            <option value="en">English</option>
            <option value="hi">हिन्दी</option>
            <option value="mr">मराठी</option>
          </select>
        </label>
      </header>
      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="eyebrow-dot" />
            {t.eyebrow}
          </div>
          <h1>{t.title}</h1>
          <p className="lede">{t.sub}</p>
          <div className="trust-line">
            <span>⌁</span> Private by design <i /> Evidence linked <i /> You
            stay in control
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="sun" />
          <div className="paper paper-back" />
          <div className="paper">
            <span className="paper-line short" />
            <span className="paper-line" />
            <span className="paper-line" />
            <span className="paper-callout" />
            <span className="paper-line short" />
          </div>
          <div className="art-badge">
            <span>✓</span> Clear next steps
          </div>
          <div className="art-leaf">✳</div>
        </div>
      </section>
      <section className="workspace" aria-label="Document analysis">
        <div className="section-heading">
          <div>
            <span className="step">
              01 <i /> START HERE
            </span>
            <h2>Bring your document</h2>
            <p>We’ll find the key details and show where they appear.</p>
          </div>
          <span className="secure-tag">
            ⌑ &nbsp; Files are processed in memory
          </span>
        </div>
        <form onSubmit={submit} hidden={!!result?.analysis}>
          <div
            className={`dropzone ${dragging ? "is-dragging" : ""} ${file ? "has-file" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              choose(e.dataTransfer.files[0]);
            }}
            onClick={() => input.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                input.current?.click();
              }
            }}
            role="button"
            tabIndex={0}
            aria-label={t.drop}
          >
            <input
              ref={input}
              className="sr-only"
              type="file"
              accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
              onChange={(e) => choose(e.target.files?.[0])}
            />
            <span className="upload-icon">↑</span>
            <strong>{file ? file.name : t.drop}</strong>
            <span className="file-hint">
              {file
                ? `${(file.size / 1024 / 1024).toFixed(2)} MB · ${file.type || "Document"}`
                : "PDF, PNG or JPG · Up to 10 MB"}
            </span>
            <button
              className="browse-button"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                input.current?.click();
              }}
            >
              {file ? "Change file" : t.upload}
            </button>
          </div>
          <div className="form-row">
            <div className="privacy-note">
              <span>◎</span>
              <span>
                Your file is not saved. Only extracted text is sent to the
                analysis provider when real analysis is enabled.
              </span>
            </div>
            <button className="primary-button" disabled={!file || busy}>
              {busy ? (
                <>
                  <span className="spinner" /> {t.busy}
                </>
              ) : (
                <>
                  {t.button} <span>→</span>
                </>
              )}
            </button>
          </div>
        </form>
        {error && (
          <div className="error-box" role="alert">
            <strong>We couldn’t complete the analysis</strong>
            <span>{error}</span>
            <small>
              Your document has not been reported as successfully analyzed.
            </small>
            {result?.error?.document && (
              <small>
                {result.error.document.classification.documentType ??
                  "Unknown or unsupported document"}{" "}
                · authenticity not verified.{" "}
                {result.error.document.pages
                  .filter((page) => !page.readable)
                  .map((page) => `Page ${page.pageNumber} unreadable`)
                  .join("; ")}
              </small>
            )}
          </div>
        )}
        {result?.synthetic && (
          <div className="synthetic-banner" role="status">
            Development demo · Simulated results, not an analysis from Gemma.
          </div>
        )}
        {result?.analysis && (
          <div ref={resultsRef}>
            <button
              className="browse-button"
              type="button"
              onClick={() => {
                setResult(null);
                setFile(null);
              }}
            >
              Analyze another document
            </button>
            <AnalysisView
              analysis={result.analysis}
              labels={t}
              document={result.document}
            />
          </div>
        )}
      </section>
      <section id="how" className="how">
        <span className="step">
          03 <i /> HOW CIVIX HELPS
        </span>
        <h2>Clarity, with the source in view.</h2>
        <div className="how-grid">
          <article>
            <span>01</span>
            <h3>Read the document</h3>
            <p>
              Upload a PDF or image. Pages with missing text are clearly marked.
            </p>
          </article>
          <article>
            <span>02</span>
            <h3>Find what matters</h3>
            <p>
              See possible actions, dates, fees and requested documents in one
              place.
            </p>
          </article>
          <article>
            <span>03</span>
            <h3>Check the evidence</h3>
            <p>
              Every claim links back to an excerpt. Review it before you act.
            </p>
          </article>
        </div>
      </section>
      <footer id="about">
        <a className="brand" href="#top">
          <span className="brand-mark">c</span> civix
        </a>
        <p>{t.disclaimer}</p>
        <span>Independent information assistance · India</span>
      </footer>
    </main>
  );
}

function AnalysisView({
  analysis,
  labels,
  document,
}: {
  analysis: CivicAnalysis;
  labels: Labels;
  document?: ApiResult["document"];
}) {
  const claims = [
    ...analysis.summary.evidence,
    ...analysis.requiredActions.flatMap((x) => x.evidence),
    ...analysis.deadlines.flatMap((x) => x.evidence),
    ...analysis.requiredDocuments.flatMap((x) => x.evidence),
    ...analysis.fees.flatMap((x) => x.evidence),
    ...analysis.consequences.flatMap((x) => x.evidence),
  ];
  return (
    <section className="results" aria-live="polite">
      <div className="result-top">
        <div>
          <span className="step">
            02 <i /> YOUR DOCUMENT GUIDE
          </span>
          <h2>{analysis.documentType ?? "Document analysis"}</h2>
        </div>
        <span className="review-pill">
          ● &nbsp;
          {analysis.analysisStatus === "complete"
            ? "Needs human review"
            : analysis.analysisStatus === "partial"
              ? "Partial coverage · review"
              : "Needs review"}
        </span>
      </div>
      {document && (
        <article className="summary-card">
          <span className="card-kicker">
            Detected document · authenticity not verified
          </span>
          <p>{document.classification.title ?? "Title unknown"}</p>
          <p>
            {document.classification.documentType ??
              "Unknown or unsupported document"}{" "}
            · {document.classification.category.replaceAll("_", " ")}
          </p>
          <p>
            {[
              document.classification.issuingAuthority,
              document.classification.referenceNumber,
              document.classification.issueDate,
            ]
              .filter(Boolean)
              .join(" · ") ||
              "Authority, reference number, and issue date are unknown."}
          </p>
          <small>
            Classification does not verify that this document is official or
            authentic.
          </small>
          {document.pages.some((page) => page.ocrStatus === "completed") && (
            <small>
              Some classification cues came from OCR text; check them against
              the original page image.
            </small>
          )}
        </article>
      )}
      <div className="warning-stack">
        {analysis.warnings.map((warning, i) => (
          <p key={i}>ⓘ &nbsp;{warning}</p>
        ))}
        {!analysis.coverage.complete && (
          <p>
            ⓘ &nbsp;Only pages {analysis.coverage.includedPages.join(", ")} are
            covered. Pages {analysis.coverage.omittedPages.join(", ")} could not
            be included.
          </p>
        )}
        {document?.warnings.map((warning, i) => (
          <p key={`doc-${i}`}>ⓘ &nbsp;{warning.replaceAll("_", " ")}</p>
        ))}
        {document?.pages
          .filter((page) => !page.readable)
          .map((page) => (
            <p key={`page-${page.pageNumber}`}>
              ⓘ &nbsp;Page {page.pageNumber} could not be read.{" "}
              {page.warnings
                .map((warning) => warning.replaceAll("_", " "))
                .join(" · ")}
            </p>
          ))}
        {document?.partial && (
          <p role="status">
            ⓘ &nbsp;Partial analysis: some pages were unreadable or not
            included.
          </p>
        )}
      </div>
      <article className="summary-card">
        <span className="card-kicker">{labels.summary}</span>
        <p>{analysis.summary.text}</p>
        <EvidenceRefs refs={analysis.summary.evidence} />
      </article>
      <div className="result-grid">
        <InfoCard
          title={labels.actions}
          empty="No action could be identified in the available text."
        >
          {analysis.requiredActions.map((item) => (
            <div className="result-item" key={item.id}>
              <span className="bullet">→</span>
              <div>
                <p>{item.description}</p>
                <small>
                  {item.mandatoryStatus.replace("_", " ")} · human review
                  required
                </small>
                <EvidenceRefs refs={item.evidence} />
              </div>
            </div>
          ))}
        </InfoCard>
        <InfoCard
          title={labels.deadlines}
          empty="No deadline was extracted. This does not confirm there is no deadline."
        >
          {analysis.deadlines.map((item, i) => (
            <div className="result-item" key={i}>
              <span className="bullet date">◷</span>
              <div>
                <p>{item.sourceExpression}</p>
                {item.resolvedDate && (
                  <small>Possible date: {item.resolvedDate}</small>
                )}
                <EvidenceRefs refs={item.evidence} />
              </div>
            </div>
          ))}
        </InfoCard>
        <InfoCard
          title={labels.docs}
          empty="No required documents were identified."
        >
          {analysis.requiredDocuments.map((item, i) => (
            <div className="result-item" key={i}>
              <span className="bullet">▤</span>
              <div>
                <p>{item.name}</p>
                <small>{item.mandatoryStatus.replace("_", " ")}</small>
                <EvidenceRefs refs={item.evidence} />
              </div>
            </div>
          ))}
        </InfoCard>
        <InfoCard
          title={labels.fees}
          empty={
            analysis.feeInformationStatus === "not_found"
              ? "No fee information found. This does not mean the process is free."
              : "The available text does not establish a fee amount."
          }
        >
          {analysis.fees.map((item, i) => (
            <div className="result-item" key={i}>
              <span className="bullet">₹</span>
              <div>
                <p>
                  {item.amount
                    ? `${item.currency ?? ""} ${item.amount}`
                    : item.statement}
                </p>
                <small>{item.semantics.replaceAll("_", " ")}</small>
                <EvidenceRefs refs={item.evidence} />
              </div>
            </div>
          ))}
        </InfoCard>
      </div>
      {analysis.consequences.length > 0 && (
        <InfoCard title={labels.consequences} empty="">
          {analysis.consequences.map((item, i) => (
            <div className="result-item" key={i}>
              <span className="bullet">!</span>
              <div>
                <p>{item.text}</p>
                <EvidenceRefs refs={item.evidence} />
              </div>
            </div>
          ))}
        </InfoCard>
      )}
      {(analysis.missingInformation.length > 0 ||
        analysis.uncertainties.length > 0) && (
        <InfoCard title={labels.unknown} empty="">
          {[...analysis.missingInformation, ...analysis.uncertainties].map(
            (item, i) => (
              <p className="plain-list" key={i}>
                • &nbsp;{item}
              </p>
            ),
          )}
        </InfoCard>
      )}
      <details className="evidence-panel">
        <summary>
          {labels.evidence}
          <span>{claims.length} cited passages</span>
        </summary>
        <div className="evidence-list">
          {claims.map((ref, i) => (
            <blockquote
              key={`${ref.documentId}-${ref.pageNumber}-${ref.start}-${i}`}
            >
              <span>
                PAGE {ref.pageNumber} ·{" "}
                {ref.extractionMethod === "ocr"
                  ? "OCR TEXT MATCHED · UNVERIFIED AGAINST IMAGE"
                  : "SELECTABLE SOURCE TEXT MATCHED"}
              </span>
              <p>“{ref.excerpt}”</p>
              <small>
                Text location matched · Semantic support unverified · Human
                review required
              </small>
            </blockquote>
          ))}
        </div>
      </details>
    </section>
  );
}
function EvidenceRefs({
  refs,
}: {
  refs: CivicAnalysis["summary"]["evidence"];
}) {
  return (
    <span className="evidence-ref">
      ↗ Page {refs.map((x) => x.pageNumber).join(", ")} · source-linked
    </span>
  );
}
function InfoCard({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children)
    ? children.length > 0
    : Boolean(children);
  return (
    <article className="info-card">
      <h3>{title}</h3>
      {hasChildren ? (
        children
      ) : empty ? (
        <p className="empty-note">{empty}</p>
      ) : null}
    </article>
  );
}
