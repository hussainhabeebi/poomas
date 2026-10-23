// Application-side safety checks. The limits mirror the existing hotel route;
// supplier-specific stay horizons and child-age rules still need UAT confirmation.
export function realHotelDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function hotelStayIssues(input: { checkIn: string; checkOut: string }, now = new Date()): string[] {
  const issues: string[] = [];
  if (!realHotelDate(input.checkIn)) issues.push('checkIn: Enter a real calendar date in YYYY-MM-DD format.');
  if (!realHotelDate(input.checkOut)) issues.push('checkOut: Enter a real calendar date in YYYY-MM-DD format.');
  if (issues.length) return issues;
  // Compare date-only values without timezone conversion or DST arithmetic.
  if (input.checkIn < now.toISOString().slice(0, 10)) issues.push('checkIn: Check-in cannot be in the past (UTC date).');
  if (input.checkOut <= input.checkIn) issues.push('checkOut: Check-out must be after check-in.');
  return issues;
}
