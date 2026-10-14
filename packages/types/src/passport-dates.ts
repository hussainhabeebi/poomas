/** Passport dates are calendar dates, never local-time instants. */
export type PassportDateFields = { passportIssueDate?: string; passportExpiry?: string };
export type PassportDateProblems = Partial<Record<keyof PassportDateFields, string>>;

export function isPassportDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

// Numeric mobile keyboards need not provide a hyphen. Convert exactly eight
// digits on blur/submission; never truncate, guess locale order or roll dates.
export function normalizePassportDateEntry(value: string): string {
  const raw = value.trim();
  return /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
}

export function passportToday(now = new Date()): string {
  return `${now.getUTCFullYear().toString().padStart(4, "0")}-${(now.getUTCMonth() + 1).toString().padStart(2, "0")}-${now.getUTCDate().toString().padStart(2, "0")}`;
}

export function passportDateProblems(p: PassportDateFields, today = passportToday()): PassportDateProblems {
  const problems: PassportDateProblems = {};
  for (const [field, label] of [["passportIssueDate", "Passport issue date"], ["passportExpiry", "Passport expiry date"]] as const) {
    const value = p[field];
    if (value && !isPassportDate(value)) problems[field] = `${label} must be a valid date in YYYY-MM-DD format with a four-digit year.`;
  }
  if (p.passportIssueDate && !problems.passportIssueDate && p.passportIssueDate > today)
    problems.passportIssueDate = "Passport issue date cannot be in the future.";
  if (p.passportIssueDate && p.passportExpiry && isPassportDate(p.passportIssueDate) && isPassportDate(p.passportExpiry) && p.passportExpiry <= p.passportIssueDate)
    problems.passportExpiry = "Passport expiry date must be later than the issue date.";
  return problems;
}

export function normalizedPassportDates(p: PassportDateFields): PassportDateFields {
  return {
    passportIssueDate: p.passportIssueDate ? normalizePassportDateEntry(p.passportIssueDate) : undefined,
    passportExpiry: p.passportExpiry ? normalizePassportDateEntry(p.passportExpiry) : undefined,
  };
}
