export function isSyntheticModeEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.NODE_ENV === "development" && env.CIVIX_MOCK_ANALYSIS === "true";
}
