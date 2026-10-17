const MONTHS: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};
function validDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}
function dateFromText(text: string): string | null {
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) {
    const value = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return validDate(value) ? value : null;
  }
  const named =
    /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i.exec(
      text,
    );
  if (named) {
    const value = `${named[3]}-${MONTHS[named[2]!.toLowerCase()]}-${named[1]!.padStart(2, "0")}`;
    return validDate(value) ? value : null;
  }
  return null;
}
function duration(text: string) {
  const match =
    /\b(?:within|in)\s+(\d+)\s+(days?|weeks?|months?|years?)\s+(?:of|from)\s+(.+?)(?:[.,;]|$)/i.exec(
      text,
    );
  if (!match) return null;
  const unitWord = match[2]!.toLowerCase();
  const unit = unitWord.startsWith("day")
    ? "days"
    : unitWord.startsWith("week")
      ? "weeks"
      : unitWord.startsWith("month")
        ? "months"
        : "years";
  return { value: Number(match[1]), unit, event: match[3]!.trim() } as const;
}
export function interpretDeadline(
  expression: string,
  referenceDate?: string,
  semantics?: "elapsed_days",
) {
  const explicitDate = dateFromText(expression);
  if (explicitDate)
    return {
      deadlineType: "explicit" as const,
      explicitDate,
      relativeDuration: null,
      referenceEvent: null,
      resolvedDate: null,
    };
  const relative = duration(expression);
  if (relative) {
    let resolvedDate: string | null = null;
    if (
      referenceDate &&
      semantics === "elapsed_days" &&
      validDate(referenceDate) &&
      relative.unit === "days"
    ) {
      const date = new Date(`${referenceDate}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + relative.value);
      resolvedDate = date.toISOString().slice(0, 10);
    }
    return {
      deadlineType: "relative" as const,
      explicitDate: null,
      relativeDuration: { value: relative.value, unit: relative.unit },
      referenceEvent: relative.event,
      resolvedDate,
    };
  }
  return {
    deadlineType: "ambiguous" as const,
    explicitDate: null,
    relativeDuration: null,
    referenceEvent: null,
    resolvedDate: null,
  };
}
