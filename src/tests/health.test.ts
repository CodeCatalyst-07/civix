import { expect, it } from "vitest";
import { GET } from "@/app/api/health/route";
import { version } from "../../package.json";

it("returns a minimal health response with the canonical version", async () => {
  const response = GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(await response.json()).toEqual({
    status: "ok",
    service: "civix",
    version,
  });
});
