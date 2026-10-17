import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  ApiError,
  GenerateContentResponse,
  ThinkingLevel,
} from "@google/genai";
import {
  createGemmaProvider,
  type Generate,
  type GemmaConfig,
} from "@/features/ai/google-gemma";
import {
  assessComparisonJSON,
  comparisonPlan,
  comparisonProfiles,
  comparisonSource,
  minimalJSONPrompt,
  runThinkingComparison,
} from "@/features/ai/thinking-comparison";
import { extractionPrompt, CIVIC_SYSTEM } from "@/features/ai/prompts";

const settings: GemmaConfig = {
  apiKey: "comparison-fake-key",
  model: "gemma-4-26b-a4b-it",
  timeoutMs: 100,
  maxRetries: 3,
  maxConcurrent: 4,
};
const data = {
  documentType: "notice",
  summary: "An incomplete fictional notice asks for a response.",
  requiredAction: null,
  deadlineText: "as soon as possible",
  feeText: null,
  warnings: ["Issuing authority and required materials are unclear."],
};
function response(text = JSON.stringify(data)) {
  const result = new GenerateContentResponse();
  result.candidates = [{ content: { parts: [{ text }] } }];
  result.usageMetadata = {
    promptTokenCount: 12,
    candidatesTokenCount: 20,
    totalTokenCount: 32,
  };
  return result;
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("bounded Gemma thinking comparison", () => {
  it("compares identical A/B requests except thinking level and preserves C/default settings", async () => {
    const send = vi.fn<Generate>().mockResolvedValue(response());
    const configs: GemmaConfig[] = [];
    const before = { ...settings };
    const result = await runThinkingComparison(settings, {
      client: (config) => {
        configs.push(config);
        return send;
      },
    });
    expect(send).toHaveBeenCalledTimes(3);
    expect(result.totalRemoteAttempts).toBe(3);
    expect(
      result.rows.every(
        (row) =>
          row.remoteAttempts === 1 &&
          row.jsonReturned === true &&
          row.zodValid === true &&
          row.sourceLiteralsValid === true,
      ),
    ).toBe(true);
    const [a, b, c] = send.mock.calls.map((call) => call[0]);
    expect(a!.contents).toEqual(b!.contents);
    expect(a!.model).toBe(settings.model);
    expect(b!.model).toBe(settings.model);
    expect(c!.model).toBe(settings.model);
    const {
      abortSignal: aSignal,
      thinkingConfig: aThinking,
      ...aConfig
    } = a!.config!;
    const {
      abortSignal: bSignal,
      thinkingConfig: bThinking,
      ...bConfig
    } = b!.config!;
    const { abortSignal: cSignal, ...cConfig } = c!.config!;
    expect(aThinking).toEqual({ thinkingLevel: ThinkingLevel.MINIMAL });
    expect(bThinking).toEqual({ thinkingLevel: ThinkingLevel.HIGH });
    expect(aConfig).toEqual(bConfig);
    expect(aConfig).toEqual(cConfig);
    expect(
      [aSignal, bSignal, cSignal].every(
        (signal) => signal instanceof AbortSignal,
      ),
    ).toBe(true);
    expect(c!.contents).toEqual([
      { role: "user", parts: [{ text: extractionPrompt(comparisonSource) }] },
    ]);
    expect(c!.config).not.toHaveProperty("thinkingConfig");
    expect(aConfig).toMatchObject({
      systemInstruction: CIVIC_SYSTEM,
      temperature: 0,
      maxOutputTokens: 2048,
      httpOptions: { timeout: 100, retryOptions: { attempts: 1 } },
    });
    for (const request of [a, b, c])
      for (const key of [
        "responseMimeType",
        "responseSchema",
        "responseJsonSchema",
      ])
        expect(request!.config).not.toHaveProperty(key);
    expect(
      configs.every(
        (config) => config.maxRetries === 0 && config.maxConcurrent === 1,
      ),
    ).toBe(true);
    expect(settings).toEqual(before);
    expect(
      result.profiles.map(
        (profile) => profile.effectiveGenerationSettings.thinkingConfig,
      ),
    ).toEqual([{ thinkingLevel: "MINIMAL" }, { thinkingLevel: "HIGH" }, null]);
  });
  it("uses SDK serializer thinking fields and exactly three fetch calls despite HTTP 500", async () => {
    const payloads: Record<string, unknown>[] = [];
    const remote = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, init) => {
        payloads.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({ error: { code: 500, message: settings.apiKey } }),
          { status: 500, headers: { "content-type": "application/json" } },
        );
      });
    vi.stubGlobal("fetch", remote);
    const result = await runThinkingComparison(settings);
    expect(remote).toHaveBeenCalledTimes(3);
    expect(result.totalRemoteAttempts).toBe(3);
    expect(
      payloads.map(
        (body) =>
          (body.generationConfig as Record<string, unknown>).thinkingConfig,
      ),
    ).toEqual([
      { thinkingLevel: "MINIMAL" },
      { thinkingLevel: "HIGH" },
      undefined,
    ]);
    expect(
      result.rows.every(
        (row) =>
          row.error?.code === "AI_SERVICE_UNAVAILABLE" &&
          row.diagnostics.httpStatus === 500 &&
          row.remoteAttempts === 1 &&
          row.jsonReturned === null &&
          row.zodValid === null,
      ),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain(settings.apiKey);
  });
  it("never repairs malformed JSON or retries schema-invalid results", async () => {
    const send = vi
      .fn<Generate>()
      .mockResolvedValueOnce(response("{"))
      .mockResolvedValueOnce(response("{}"))
      .mockResolvedValueOnce(
        response(JSON.stringify({ ...data, fabricated: true })),
      );
    const result = await runThinkingComparison(settings, {
      client: () => send,
    });
    expect(send).toHaveBeenCalledTimes(3);
    expect(result.rows.map((row) => [row.jsonReturned, row.zodValid])).toEqual([
      [false, false],
      [true, false],
      [true, false],
    ]);
    expect(
      result.rows.every((row) => row.error?.code === "AI_INVALID_OUTPUT"),
    ).toBe(true);
  });
  it("maintains strict schema and separate literal validation", () => {
    expect(
      assessComparisonJSON(JSON.stringify({ ...data, feeText: 0 })),
    ).toMatchObject({ jsonReturned: true, zodValid: false });
    expect(
      assessComparisonJSON(JSON.stringify({ ...data, feeText: "₹0" })),
    ).toMatchObject({
      jsonReturned: true,
      zodValid: true,
      sourceLiteralsValid: false,
    });
    expect(
      assessComparisonJSON("```json\n" + JSON.stringify(data) + "\n```"),
    ).toMatchObject({
      jsonReturned: true,
      zodValid: true,
      sourceLiteralsValid: true,
    });
    expect(assessComparisonJSON(null)).toMatchObject({
      jsonReturned: null,
      zodValid: null,
    });
  });
  it("does not switch models or send anything for an unexpected model", async () => {
    const send = vi.fn<Generate>();
    await expect(
      runThinkingComparison(
        { ...settings, model: "gemma-4-31b-it" },
        { client: () => send },
      ),
    ).rejects.toMatchObject({ code: "CONFIGURATION_ERROR" });
    expect(send).not.toHaveBeenCalled();
  });
  it("records each independent timeout once without increasing its configured budget", async () => {
    vi.useFakeTimers();
    const send = vi
      .fn<Generate>()
      .mockImplementation(
        (request) =>
          new Promise((_, reject) =>
            request.config?.abortSignal?.addEventListener(
              "abort",
              () => reject(new DOMException("hidden", "AbortError")),
              { once: true },
            ),
          ),
      );
    const pending = runThinkingComparison(settings, { client: () => send });
    await vi.advanceTimersByTimeAsync(300);
    const result = await pending;
    expect(send).toHaveBeenCalledTimes(3);
    expect(result.totalRemoteAttempts).toBe(3);
    expect(
      result.rows.every(
        (row) =>
          row.error?.code === "AI_TIMEOUT" &&
          row.diagnostics.timeoutMs === 100 &&
          row.remoteAttempts === 1,
      ),
    ).toBe(true);
  });
  it("does not persist response, source, thoughts or arbitrary SDK exceptions in metadata reports", async () => {
    const text = JSON.stringify({
      ...data,
      summary: "Response-only sentinel text",
    });
    const send = vi
      .fn<Generate>()
      .mockResolvedValueOnce(response(text))
      .mockRejectedValueOnce(
        new ApiError({
          status: 500,
          message: "raw SDK sentinel " + settings.apiKey,
        }),
      )
      .mockResolvedValueOnce(response(text));
    const result = await runThinkingComparison(settings, {
      client: () => send,
    });
    const serialized = JSON.stringify(result);
    for (const secret of [
      settings.apiKey,
      "raw SDK sentinel",
      "Response-only sentinel text",
      comparisonSource,
      minimalJSONPrompt,
    ])
      expect(serialized).not.toContain(secret);
    expect(result.rows[0]?.diagnostics.usage).toEqual({
      inputTokens: 12,
      outputTokens: 20,
      totalTokens: 32,
    });
  });
  it("keeps normal provider calls unchanged when comparison override is absent", async () => {
    const send = vi.fn<Generate>().mockResolvedValue(response());
    await createGemmaProvider({
      config: () => settings,
      client: () => send,
    }).generateText("synthetic");
    expect(send.mock.calls[0]![0].config).not.toHaveProperty("thinkingConfig");
  });
  it("reports known and omitted generation settings without inventing provider defaults", () => {
    const plan = comparisonPlan(30000);
    expect(plan.maxRemoteAttempts).toBe(3);
    expect(plan.applicationRetries).toBe(0);
    expect(plan.sdkMaxAttempts).toBe(1);
    expect(comparisonProfiles[0].prompt).toBe(comparisonProfiles[1].prompt);
    expect(
      plan.profiles.every(
        (profile) =>
          profile.timeoutMs === 30000 &&
          profile.effectiveGenerationSettings.maxOutputTokens === 2048 &&
          profile.effectiveGenerationSettings.responseSchema === null,
      ),
    ).toBe(true);
    expect(
      plan.profiles[2]?.effectiveGenerationSettings.thinkingConfig,
    ).toBeNull();
  });
});
