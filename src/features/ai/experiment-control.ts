import { AppError } from "@/lib/errors/app-error";
import { civicExperiments } from "./experiments";
import { sanitizeAIError } from "./diagnostics";

export const experimentIds = [
  "text",
  ...civicExperiments.map((item) => item.id),
  "image-png",
  "sdk-json-mode",
] as const;
export type ExperimentId = (typeof experimentIds)[number];
export type ExperimentPlan = {
  ids: ExperimentId[];
  confirmed: boolean;
  diagnostic: boolean;
  explicitlySelected: boolean;
  probeJSON: boolean;
};
export function experimentMaxRetries(
  plan: ExperimentPlan,
  configured: number,
): number {
  return plan.diagnostic ? 0 : configured;
}
function invalidOptions(): never {
  throw new AppError(
    "VALIDATION_ERROR",
    "Invalid experiment options. Use --only with a documented ID; diagnostic mode permits at most three selected experiments.",
  );
}
export function planExperiments(args: readonly string[]): ExperimentPlan {
  const only: ExperimentId[] = [];
  let confirmed = false,
    diagnostic = false,
    probeJSON = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--confirm-synthetic") confirmed = true;
    else if (arg === "--diagnostic") diagnostic = true;
    else if (arg === "--probe-json-mode") probeJSON = true;
    else if (arg === "--only") {
      const id = args[++index];
      const known = experimentIds.find((item) => item === id);
      if (!known) invalidOptions();
      if (!only.includes(known)) only.push(known);
    } else invalidOptions();
  }
  if (only.includes("sdk-json-mode") && !probeJSON) invalidOptions();
  // Diagnostic continuation is explicit and bounded, never an unlimited full suite.
  if (diagnostic && (only.length === 0 || only.length > 3)) invalidOptions();
  return {
    ids: only.length
      ? only
      : experimentIds.filter((id) => probeJSON || id !== "sdk-json-mode"),
    confirmed,
    diagnostic,
    explicitlySelected: only.length > 0,
    probeJSON,
  };
}
type SafeError = ReturnType<typeof sanitizeAIError>;
export type ExperimentRow<T> =
  | { id: ExperimentId; status: "observed"; output: T }
  | {
      id: ExperimentId;
      status: "failure";
      assessment: "fail";
      error: SafeError;
    }
  | { id: ExperimentId; status: "not run"; reason: string };

/** CLI orchestration only; caller supplies fixed synthetic operations. */
export async function runExperimentPlan<T>(
  plan: ExperimentPlan,
  execute: (id: ExperimentId) => Promise<T>,
): Promise<ExperimentRow<T>[]> {
  const rows: ExperimentRow<T>[] = [];
  let stopped = false;
  for (const id of plan.ids) {
    if (!plan.confirmed || stopped) {
      rows.push({
        id,
        status: "not run",
        reason: !plan.confirmed
          ? "Explicit --confirm-synthetic opt-in required."
          : "Stopped after provider failure to protect quota.",
      });
      continue;
    }
    try {
      rows.push({ id, status: "observed", output: await execute(id) });
    } catch (error) {
      const safeError = sanitizeAIError(error);
      rows.push({
        id,
        status: "failure",
        assessment: "fail",
        error: safeError,
      });
      if (
        !plan.explicitlySelected &&
        !plan.diagnostic &&
        !["AI_INVALID_OUTPUT", "AI_EMPTY_RESPONSE"].includes(safeError.code)
      )
        stopped = true;
    }
  }
  return rows;
}
