import { readFile } from "node:fs/promises";
import { fork } from "node:child_process";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  return { ...actual, fork: vi.fn(actual.fork) };
});
import { processDocument } from "../features/documents/processing/process-document";
it("isolates credentials and awaits real child cleanup before returning", async () => {
  vi.stubEnv("CIVIX_TEST_SECRET", "synthetic-test-value");
  const bytes = new Uint8Array(
    await readFile(
      new URL(
        "../features/documents/fixtures/files/municipal.pdf",
        import.meta.url,
      ),
    ),
  );
  try {
    const pending = processDocument({
      bytes,
      originalFilename: "municipal.pdf",
    });
    const call = vi.mocked(fork).mock.calls[0]!;
    const options = call[2]!;
    expect(options).toMatchObject({
      execArgv: ["--max-old-space-size=192"],
      serialization: "advanced",
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    expect(options.env).toEqual({
      PATH: process.env.PATH,
      NODE_ENV: "production",
    });
    expect(options.env).not.toHaveProperty("CIVIX_TEST_SECRET");
    const child = vi.mocked(fork).mock.results[0]!.value as ReturnType<
      typeof fork
    >;
    const kill = vi.spyOn(child, "kill");
    const closed = vi.fn();
    child.once("close", closed);
    expect((await pending).ok).toBe(true);
    expect(kill).toHaveBeenCalledWith("SIGKILL");
    expect(closed).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllEnvs();
  }
});
