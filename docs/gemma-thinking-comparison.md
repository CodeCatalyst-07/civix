# Gemma 4 thinking comparison

17 October 2026. Phase 2 diagnostic only. Production defaults, models, credentials, timeout limits and strict validation are preserved.

## Verified configuration support

Google's [Gemma-on-Gemini API guide, Thinking section](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api#thinking) explicitly describes Gemma 4's two thinking modes: minimal disables thinking and high enables it. Its JavaScript example uses `config.thinkingConfig.thinkingLevel` with the SDK's `ThinkingLevel` enum. This is model-specific evidence, rather than an inference from Gemini model documentation.

Installed `@google/genai` 2.30.0 declares `GenerateContentConfig.thinkingConfig`, `ThinkingConfig.thinkingLevel`, and `ThinkingLevel.MINIMAL` / `ThinkingLevel.HIGH`. The enum wire values are uppercase. A regression test uses the actual SDK serializer with mocked fetch and verifies those exact wire fields. It does not verify that the hosted service accepted or honored them in this session.

```ts
import { ThinkingLevel } from "@google/genai";
const config = {
  thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
};
// The otherwise-identical B request uses ThinkingLevel.HIGH.
```

The comparison does not use thinkingBudget, includeThoughts, raw thinking control tokens, enforced JSON MIME mode, responseSchema, or responseJsonSchema. C omits thinkingConfig exactly as the current provider does; its actual backend thinking default remains unknown. No production thinking setting was added. The provider accepts a developer-only injected override used by this comparison runner.

## Evidence motivating the comparison

The local report `gemma-experiments-2026-10-17T06-10-32.540Z.json` records structured D receiving HTTP 500 in 28180 ms, with a configured 30000 ms timeout, one attempt, no application abort and no observed transport abort. Its response mode was prompt-json, with 1035 user-prompt characters and 463 system characters. It returned no validated model output or usage metadata. This is a real provider HTTP failure before the client deadline, not a parser/schema rejection. The underlying reason remains unknown.

An older report (`gemma-experiments-2026-10-17T05-45-34.363Z.json`) also contains HTTP 500 for a text experiment. Later basic text requests succeeded. The evidence therefore does not establish that HTTP 500 is exclusive to structured extraction. Other earlier structured reports contain HTTP 504 and final AI_TIMEOUT errors, as described in gemma-api-diagnostics.md. None proves that thinking mode caused these failures.

## Controlled request comparison

All profiles use the exact same Phase 1 synthetic incomplete-notice source, `D-missing-information`, containing 294 JavaScript characters. The full fictional source is available in the existing fixture; no actual citizen document or arbitrary input path is accepted.

| Setting                              | A                                                        | B                            | C                                     |
| ------------------------------------ | -------------------------------------------------------- | ---------------------------- | ------------------------------------- |
| Identifier                           | A-minimal-json-thinking-minimal                          | B-minimal-json-thinking-high | C-existing-civix                      |
| Model                                | gemma-4-26b-a4b-it                                       | Same                         | Same                                  |
| Source                               | Fictional D fixture                                      | Identical                    | Identical                             |
| User prompt                          | Short six-field extraction instruction                   | Identical to A               | Existing extractionPrompt(source)     |
| User-prompt characters               | 658                                                      | 658                          | 1035                                  |
| System policy                        | Existing CIVIC_SYSTEM, 463 characters                    | Identical                    | Identical                             |
| Thinking config                      | MINIMAL                                                  | HIGH                         | Omitted; backend default not inferred |
| Temperature                          | 0                                                        | 0                            | 0                                     |
| Max output tokens                    | 2048                                                     | 2048                         | 2048                                  |
| Configured application / SDK timeout | 30000 / 30000 ms locally                                 | Same                         | Same                                  |
| Application retries                  | 0                                                        | 0                            | 0                                     |
| SDK attempts (includes original)     | 1                                                        | 1                            | 1                                     |
| JSON repair                          | Off                                                      | Off                          | Off                                   |
| JSON MIME/schema enforcement         | None                                                     | None                         | None                                  |
| Parser and schema                    | Existing conservative parser and strict extractionSchema | Same                         | Same                                  |
| Fee/deadline literal checks          | Existing checks                                          | Same                         | Same                                  |

Counts are measured JavaScript string lengths, not token estimates. The configured timeout is read from existing AI_REQUEST_TIMEOUT_MS; no default or .env.local value was changed. Top-p and top-k remain omitted, preserving current application behavior. Report settings describe the final application request, not unreported service defaults or proof of honored internal reasoning effort.

The short prompt requests exactly the existing six fields, null for absent facts, verbatim deadline/fee text and treatment of document instructions as untrusted. C uses the original longer prompt, which additionally describes English summary, uncertainty warnings and relative-deadline preservation. A versus B isolates the requested thinking level. C differs in both prompt and unspecified thinking, so a difference involving C cannot identify which variable caused it.

## Budget and execution

```bash
npm run ai:compare-thinking -- --confirm-synthetic
```

Use the existing server-only key in .env.local. AI_MODEL must match the specified primary model; the runner refuses other values rather than silently replacing them. No key should appear in shell arguments.

The runner announces three configurations and a hard cap of **three remote attempts per invocation**. It runs A, B and C sequentially and independently, with one send per profile. It overrides retry/concurrency policy only for its own provider instances (zero retries, concurrency one). An extra send counter independently prevents exceeding one send per profile or three overall. Both SDK and application retries are disabled even for 500/429 responses. JSON errors do not trigger repair or retries. No smoke test or inference preflight adds a fourth request. A DNS-only preflight uses no API inference quota.

The normal process concurrency gate remains in force. If a transport ignores abort and holds its slot, later cases may be rejected locally rather than overlap indefinitely. Reports distinguish dispatched counts from planned requests.

Reports are saved under ignored .local-reports with owner-only file permissions. They record:

- Model/profile/source identifiers and effective application generation settings; omitted settings are explicitly null.
- Configured timeout, attempt and operation durations, sanitized HTTP status/category, client abort observations, and available usage.
- jsonReturned, zodValid and sourceLiteralsValid, independently. No response means null; malformed JSON is false; schema-invalid JSON can have jsonReturned true and zodValid false.

The parser still accepts a direct JSON object or one complete Markdown fence. Unknown fields, missing required fields, invalid types and fabricated fee/deadline literals remain failures. Schema-valid output is needs-review, not automatically correct. Literal matching does not verify every civic claim or completeness. No response text, thoughts, credentials, raw provider exceptions or source contents are persisted by this comparison. Primary and backup secrets are redacted defensively.

Exit codes: 0 means completed without a detected failure; 1 means a failed request/validation/configuration; 2 means not run because synthetic confirmation or DNS connectivity is absent. Re-running the command is a new, explicit three-attempt budget.

## Actual result in this session

The command was executed with synthetic confirmation. Google API DNS resolution was unavailable (a credential-free connectivity check also returned ENOTFOUND). **Zero remote inference attempts were made.** All three rows are not run; duration, HTTP status and JSON/Zod results are unavailable rather than invented.

Report: `.local-reports/gemma-thinking-comparison-2026-10-17T06-16-47.524Z.json`.

| Profile    | Remote attempts | HTTP status | JSON returned | Passed Zod |
| ---------- | --------------- | ----------- | ------------- | ---------- |
| A minimal  | 0               | Unavailable | Unverified    | Unverified |
| B high     | 0               | Unavailable | Unverified    | Unverified |
| C existing | 0               | Unavailable | Unverified    | Unverified |

Offline verification on Node 24.22.0: 195 tests across six files, lint, typecheck, formatting and production build pass. The original 186 tests are preserved. New tests cover exact request equivalence/differences, SDK thinking serialization, three-call behavior through HTTP 500, no JSON repair, strict schema/literal checks, model refusal, timeout caps, sanitized reports and unchanged default thinking behavior. Mocked SDK/fetch behavior does not establish live model capability.

## Conclusion and smallest next change

No causal conclusion about thinking and HTTP 500 is justified without results from this comparison. Existing evidence supports a provider HTTP error, not an error created by local JSON parsing; it also shows HTTP 500 can affect basic text. No timeout, temperature, output-token, schema, provider or production thinking default change is justified by this session.

The smallest next step is to run the exact bounded command above from a machine with Google API connectivity and inspect the three rows. If minimal succeeds while the otherwise-identical high request fails, explicit MINIMAL on structured requests becomes a candidate change, subject to accuracy review; one sample each still cannot establish reliability or causation. Do not infer the backend default used by C. No additional live attempts or Phase 3 work were performed here.
