import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { ApiError, GenerateContentResponse } from "@google/genai";
import {
  createGemmaProvider,
  type GemmaConfig,
  type Generate,
} from "@/features/ai/google-gemma";
import { createGoogleClient } from "@/features/ai/google-client";
import { ConcurrencyGate } from "@/features/ai/resilience";
import { AIError } from "@/features/ai/errors";
import { CIVIC_SYSTEM, extractionPrompt } from "@/features/ai/prompts";
import {
  experimentMaxRetries,
  planExperiments,
  runExperimentPlan,
} from "@/features/ai/experiment-control";
import {
  redactAISecrets,
  sanitizeAIError,
  summarizeDiagnostics,
  type RequestDiagnostic,
  type TransportObservation,
} from "@/features/ai/diagnostics";

const config: GemmaConfig = {
  apiKey: "fake-secret-primary",
  model: "gemma-4-26b-a4b-it",
  timeoutMs: 100,
  maxRetries: 1,
  maxConcurrent: 1,
};
const value = {
  documentType: "notice",
  summary: "Submit proof.",
  requiredAction: "Submit proof",
  deadlineText: null,
  feeText: null,
  warnings: [],
};
function response(text = JSON.stringify(value)) {
  const result = new GenerateContentResponse();
  result.candidates = [{ content: { parts: [{ text }] } }];
  result.usageMetadata = {
    promptTokenCount: 10,
    candidatesTokenCount: 20,
    totalTokenCount: 30,
  };
  return result;
}
function setup() {
  const events: RequestDiagnostic[] = [];
  const send = vi.fn<Generate>().mockResolvedValue(response());
  const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue();
  const provider = createGemmaProvider({
    config: () => config,
    gate: new ConcurrencyGate(),
    client: () => send,
    sleep,
    random: () => 0,
    onDiagnostic: (event) => events.push(event),
  });
  return { provider, send, events, sleep };
}
const gatewayError = () =>
  new ApiError({ status: 504, message: "fake-secret-primary raw SDK detail" });
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("experiment isolation and budget", () => {
  it.each(["A-explicit-deadline", "image-png", "F-hindi"] as const)(
    "selects only %s using existing IDs",
    async (id) => {
      const plan = planExperiments(["--confirm-synthetic", "--only", id]);
      const execute = vi.fn().mockResolvedValue("observed");
      const rows = await runExperimentPlan(plan, execute);
      expect(plan.ids).toEqual([id]);
      expect(execute).toHaveBeenCalledExactlyOnceWith(id);
      expect(rows).toEqual([{ id, status: "observed", output: "observed" }]);
    },
  );
  it("retains synthetic confirmation for isolated experiments", async () => {
    const execute = vi.fn();
    expect(
      (
        await runExperimentPlan(
          planExperiments(["--only", "image-png"]),
          execute,
        )
      )[0]?.status,
    ).toBe("not run");
    expect(execute).not.toHaveBeenCalled();
  });
  it("runs explicitly selected independent experiments after a provider failure", async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(gatewayError())
      .mockResolvedValueOnce("image");
    const rows = await runExperimentPlan(
      planExperiments([
        "--confirm-synthetic",
        "--only",
        "A-explicit-deadline",
        "--only",
        "image-png",
      ]),
      execute,
    );
    expect(rows.map((row) => row.status)).toEqual(["failure", "observed"]);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(rows)).not.toContain(config.apiKey);
  });
  it("retains conservative stopping for the default full suite", async () => {
    const execute = vi.fn().mockRejectedValue(gatewayError());
    const rows = await runExperimentPlan(
      planExperiments(["--confirm-synthetic"]),
      execute,
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(rows[0]?.status).toBe("failure");
    expect(rows.slice(1).every((row) => row.status === "not run")).toBe(true);
  });
  it("continues full suite after a validation failure, preserving prior behavior", async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new AIError("AI_INVALID_OUTPUT"))
      .mockResolvedValue("observed");
    const rows = await runExperimentPlan(
      planExperiments(["--confirm-synthetic"]),
      execute,
    );
    expect(execute).toHaveBeenCalledTimes(8);
    expect(rows[1]?.status).toBe("observed");
  });
  it("bounds diagnostic mode to three explicitly selected requests and disables retries", () => {
    const plan = planExperiments([
      "--diagnostic",
      "--only",
      "A-explicit-deadline",
      "--only",
      "image-png",
      "--only",
      "F-hindi",
    ]);
    expect(plan.ids).toHaveLength(3);
    expect(experimentMaxRetries(plan, 3)).toBe(0);
    expect(experimentMaxRetries(planExperiments(["--only", "text"]), 3)).toBe(
      3,
    );
    expect(() => planExperiments(["--diagnostic"])).toThrow();
    expect(() =>
      planExperiments([
        "--diagnostic",
        "--only",
        "text",
        "--only",
        "image-png",
        "--only",
        "F-hindi",
        "--only",
        "A-explicit-deadline",
      ]),
    ).toThrow();
  });
  it("deduplicates repeated selections and does not run a hidden text request", () => {
    expect(
      planExperiments([
        "--only",
        "A-explicit-deadline",
        "--only",
        "A-explicit-deadline",
      ]).ids,
    ).toEqual(["A-explicit-deadline"]);
  });
  it.each([
    { args: ["--only"] },
    { args: ["--only", "fake-secret-primary"] },
    { args: ["--unknown"] },
    { args: ["--only", "sdk-json-mode"] },
  ])("rejects invalid selection without echoing arguments", ({ args }) => {
    expect(() => planExperiments(args)).toThrow();
    expect(() => planExperiments(args)).not.toThrow(config.apiKey);
  });
  it("keeps the optional MIME probe separately gated", () => {
    expect(planExperiments(["--probe-json-mode"]).ids).toHaveLength(9);
    expect(
      planExperiments(["--probe-json-mode", "--only", "sdk-json-mode"]).ids,
    ).toEqual(["sdk-json-mode"]);
  });
});

describe("request and timeout diagnostics", () => {
  it("keeps normal structured extraction prompt-based, sharing text generation settings", async () => {
    const { provider, send, events } = setup();
    await provider.generateText("Explain source");
    await provider.generateStructured("Submit proof");
    const text = send.mock.calls[0]![0];
    const structured = send.mock.calls[1]![0];
    expect(structured.model).toBe(text.model);
    for (const key of [
      "systemInstruction",
      "temperature",
      "maxOutputTokens",
      "httpOptions",
    ] as const)
      expect(structured.config?.[key]).toEqual(text.config?.[key]);
    expect(structured.config).toMatchObject({
      maxOutputTokens: 2048,
      httpOptions: { timeout: 100, retryOptions: { attempts: 1 } },
    });
    for (const key of [
      "responseMimeType",
      "responseSchema",
      "responseJsonSchema",
    ])
      expect(structured.config).not.toHaveProperty(key);
    expect(structured.contents).toEqual([
      { role: "user", parts: [{ text: extractionPrompt("Submit proof") }] },
    ]);
    expect(events[1]).toMatchObject({
      operation: "structured",
      responseMode: "prompt-json",
      promptChars: extractionPrompt("Submit proof").length,
      systemChars: CIVIC_SYSTEM.length,
      timeoutMs: 100,
      sdkMaxAttempts: 1,
    });
  });
  it("records 504 exhaustion as two bounded attempts without SDK details", async () => {
    const { provider, send, events, sleep } = setup();
    send.mockRejectedValue(gatewayError());
    await expect(provider.generateStructured("source")).rejects.toMatchObject({
      code: "AI_SERVICE_UNAVAILABLE",
      status: 504,
      attempts: 2,
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(
      events.map((event) => [
        event.attempt,
        event.httpStatus,
        event.errorCategory,
      ]),
    ).toEqual([
      [1, 504, "AI_SERVICE_UNAVAILABLE"],
      [2, 504, "AI_SERVICE_UNAVAILABLE"],
    ]);
    expect(
      events.every(
        (event) =>
          !event.applicationAbortRequested &&
          event.durationMs >= 0 &&
          event.usage === null,
      ),
    ).toBe(true);
    expect(JSON.stringify(events)).not.toMatch(
      /fake-secret-primary|raw SDK detail|source/,
    );
  });
  it("distinguishes 504 followed by timeout from two retried timeouts", async () => {
    vi.useFakeTimers();
    const { provider, send, events, sleep } = setup();
    send
      .mockRejectedValueOnce(gatewayError())
      .mockImplementationOnce(
        (request) =>
          new Promise((_, reject) =>
            request.config?.abortSignal?.addEventListener(
              "abort",
              () => reject(new DOMException("hidden", "AbortError")),
              { once: true },
            ),
          ),
      );
    const pending = expect(
      provider.generateStructured("source"),
    ).rejects.toMatchObject({ code: "AI_TIMEOUT", attempts: 2 });
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(send).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(events[0]).toMatchObject({
      httpStatus: 504,
      errorCategory: "AI_SERVICE_UNAVAILABLE",
    });
    expect(events[1]).toMatchObject({
      attempt: 2,
      httpStatus: null,
      errorCategory: "AI_TIMEOUT",
      applicationAbortRequested: true,
      timeoutSource: "application-deadline",
      durationMs: 100,
    });
  });
  it("does not retry a first-attempt timeout", async () => {
    vi.useFakeTimers();
    const { provider, send, events, sleep } = setup();
    send.mockImplementation(
      (request) =>
        new Promise((_, reject) =>
          request.config?.abortSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("hidden", "AbortError")),
            { once: true },
          ),
        ),
    );
    const pending = expect(
      provider.generateText("source"),
    ).rejects.toMatchObject({ code: "AI_TIMEOUT", attempts: 1 });
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(events).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
  it("verifies the actual SDK HTTP timeout reaches its fetch signal", async () => {
    vi.useFakeTimers();
    const remote = vi
      .fn<typeof fetch>()
      .mockImplementation(
        (_url, init) =>
          new Promise((_, reject) =>
            init?.signal?.addEventListener(
              "abort",
              () =>
                reject(new DOMException("fake-secret-primary", "AbortError")),
              { once: true },
            ),
          ),
      );
    vi.stubGlobal("fetch", remote);
    const caller = new AbortController();
    const observation: TransportObservation = {
      httpStatus: null,
      abortObserved: null,
    };
    const send = createGoogleClient(config);
    const pending = expect(
      send(
        {
          model: config.model,
          contents: "synthetic",
          config: {
            abortSignal: caller.signal,
            httpOptions: { timeout: 100, retryOptions: { attempts: 1 } },
          },
        },
        observation,
      ),
    ).rejects.toMatchObject({ code: "AI_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(remote).toHaveBeenCalledTimes(1);
    expect(caller.signal.aborted).toBe(false);
    expect(observation).toEqual({ httpStatus: null, abortObserved: true });
  });
  it("verifies the real SDK does not multiply application 504 retries", async () => {
    const remote = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ error: { code: 504, message: config.apiKey } }),
            { status: 504, headers: { "content-type": "application/json" } },
          ),
      );
    vi.stubGlobal("fetch", remote);
    const events: RequestDiagnostic[] = [];
    const provider = createGemmaProvider({
      config: () => config,
      gate: new ConcurrencyGate(),
      sleep: async () => {},
      onDiagnostic: (event) => events.push(event),
    });
    await expect(provider.generateStructured("source")).rejects.toMatchObject({
      code: "AI_SERVICE_UNAVAILABLE",
      attempts: 2,
    });
    expect(remote).toHaveBeenCalledTimes(2);
    expect(events.map((event) => event.httpStatus)).toEqual([504, 504]);
  });
  it("captures usage without request/response content and summarizes the experiment", async () => {
    const { provider, events } = setup();
    await provider.generateText("sensitive test prompt");
    const summary = summarizeDiagnostics(
      "A-explicit-deadline",
      config.model,
      config.timeoutMs,
      12.7,
      events,
    );
    expect(summary).toMatchObject({
      experimentId: "A-explicit-deadline",
      attempts: 1,
      durationMs: 13,
      timeoutMs: 100,
      errorCategory: null,
      timeoutSource: null,
      requestDurationMs: expect.any(Number),
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    });
    expect(JSON.stringify(summary)).not.toContain("sensitive test prompt");
    expect(JSON.stringify(summary)).not.toContain("Submit proof");
    expect(JSON.stringify(summary)).not.toContain(config.apiKey);
  });
  it("keeps final parse failures distinct from successful transport diagnostics", async () => {
    const { provider, send, events } = setup();
    send.mockResolvedValue(response("{"));
    await expect(provider.generateStructured("source")).rejects.toMatchObject({
      outputFailure: "json",
    });
    expect(events[0]?.errorCategory).toBeNull();
    expect(
      summarizeDiagnostics(
        "A-explicit-deadline",
        config.model,
        100,
        1,
        events,
        "AI_INVALID_OUTPUT",
      ).errorCategory,
    ).toBe("AI_INVALID_OUTPUT");
  });
  it("does not let a diagnostic callback failure retry successful inference", async () => {
    const send = vi.fn<Generate>().mockResolvedValue(response());
    await expect(
      createGemmaProvider({
        config: () => config,
        client: () => send,
        onDiagnostic: () => {
          throw new Error(config.apiKey);
        },
      }).generateText("source"),
    ).resolves.toHaveProperty("text");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("redacts both credential slots, including JSON escaping, from developer reports", () => {
    const env = {
      GEMINI_API_KEY: config.apiKey,
      GEMINI_API_KEY_BACKUP: 'backup-"\\-secret',
    };
    const serialized = redactAISecrets(
      {
        text: Object.values(env).join(" "),
        model: config.apiKey,
        error: sanitizeAIError(gatewayError()),
      },
      env,
    );
    expect(serialized).not.toContain(config.apiKey);
    expect(serialized).not.toContain("backup-");
    expect(serialized).not.toContain("raw SDK detail");
    expect(JSON.parse(serialized).model).toBe("[REDACTED]");
  });
});
