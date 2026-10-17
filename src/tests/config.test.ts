import { describe, expect, it, vi } from "vitest";

// Only replace Next's build-time boundary marker; validate the real config module.
vi.mock("server-only", () => ({}));
import {
  DEFAULT_AI_MODEL,
  getAIConfig,
  getRuntimeConfig,
} from "@/lib/config/env";
import { AppError, errorCodes, toPublicError } from "@/lib/errors/app-error";

describe("server configuration", () => {
  it("imports and reads runtime config without future credentials", () => {
    expect(getRuntimeConfig({})).toEqual({ nodeEnv: "development" });
  });
  it.each(["development", "test", "production"])(
    "accepts NODE_ENV=%s",
    (nodeEnv) =>
      expect(getRuntimeConfig({ NODE_ENV: nodeEnv })).toEqual({ nodeEnv }),
  );
  it("rejects invalid runtime environment without leaking it", () => {
    expect(() => getRuntimeConfig({ NODE_ENV: "private-value" })).toThrow(
      AppError,
    );
    expect(() => getRuntimeConfig({ NODE_ENV: "private-value" })).not.toThrow(
      "private-value",
    );
  });
  it("requires a key only when future AI configuration is requested", () => {
    expect(() => getAIConfig({})).toThrow("GEMINI_API_KEY");
    expect(() => getAIConfig({ GEMINI_API_KEY: "  " })).toThrow(AppError);
  });
  it("uses the documented future default and permits model overrides", () => {
    expect(getAIConfig({ GEMINI_API_KEY: "test-only-key" })).toEqual({
      apiKey: "test-only-key",
      model: DEFAULT_AI_MODEL,
    });
    expect(
      getAIConfig({ GEMINI_API_KEY: "test-only-key", AI_MODEL: "other" }).model,
    ).toBe("other");
  });
  it("rejects empty models without exposing a supplied key", () => {
    try {
      getAIConfig({ GEMINI_API_KEY: "do-not-disclose", AI_MODEL: " " });
      expect.fail("Expected configuration error");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(String(error)).not.toContain("do-not-disclose");
      expect(String(error)).toContain("AI_MODEL");
    }
  });
  it("does not accept public-prefixed credentials", () =>
    expect(() =>
      getAIConfig({ NEXT_PUBLIC_GEMINI_API_KEY: "public-key" }),
    ).toThrow("GEMINI_API_KEY"));
});

describe("public errors", () => {
  it.each(errorCodes)("sanitizes %s", (code) => {
    const output = toPublicError(new AppError(code, "private internal detail"));
    expect(output.code).toBe(code);
    expect(output.message).not.toContain("private internal detail");
    expect(Object.keys(output)).toEqual(["code", "message"]);
  });
  it("sanitizes unknown exceptions", () =>
    expect(toPublicError(new Error("secret"))).toEqual({
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
    }));
});
