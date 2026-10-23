// Durable state transitions are intentionally conservative: no uncertain supplier
// submission is ever retried. Booking Details is the only recovery operation.
export const HOTEL_QUOTE_TTL_MS = 120_000; // local safety policy, not a supplier SLA
export const HOTEL_POLL_WINDOW_MS = 180_000;
export const HOTEL_MAX_CHECKS = 36; // documentation: 5 seconds for up to 180 seconds
export const HOTEL_SETTLED = ['SUCCESS', 'ON_HOLD', 'ABORTED', 'FAILED', 'CANCELLED'];
export function hotelRateEqual(a: any, b: any): boolean {
  return a?.optionId === b?.optionId && a?.pricing?.currency === b?.pricing?.currency
    && Number.isFinite(a?.pricing?.totalPrice) && a.pricing.totalPrice > 0
    && a.pricing.totalPrice === b?.pricing?.totalPrice
    && JSON.stringify(a?.roomInfo) === JSON.stringify(b?.roomInfo)
    && a?.mealBasis === b?.mealBasis
    && JSON.stringify(a?.cancellation) === JSON.stringify(b?.cancellation);
}
export function validateHotelGuests(selection: any, option: any, rooms: any[]): string | null {
  if (selection.rooms.length !== rooms.length) return 'Provide guest details for every selected room.';
  const leads = new Set<string>();
  for (let i = 0; i < rooms.length; i++) {
    const guests = rooms[i].guests;
    if (guests.filter((g: any) => g.type === 'ADULT').length !== selection.rooms[i].adults
      || guests.filter((g: any) => g.type === 'CHILD').length !== (selection.rooms[i].children ?? 0)) return 'Guest counts must match the selected rooms.';
    const lead = guests.find((g: any) => g.type === 'ADULT');
    const name = `${lead.firstName} ${lead.lastName}`.toLowerCase();
    if (leads.has(name)) return 'Lead guest names must be different across rooms.';
    leads.add(name);
    if (option.compliance?.panRequired && !lead.pan) return 'A valid PAN is required for each room’s lead guest for this rate.';
    if (option.compliance?.passportRequired && guests.some((g: any) => !g.passport)) return 'A passport is required for each guest for this rate.';
  }
  return null;
}
export async function hotelRequestHash(value: unknown) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(buffer), x => x.toString(16).padStart(2, '0')).join('');
}
export function hotelRecoveryState(previous: string, incoming: string): string {
  // Supplier snapshots have no documented ordering token. Progress is therefore
  // monotonic locally; unknown/regressive snapshots never clear admin intent.
  if (['CANCELLED', 'ABORTED', 'FAILED'].includes(previous)) return previous;
  if (previous === 'CANCELLATION_PENDING') return incoming === 'CANCELLED' ? incoming : previous;
  if (incoming === 'CANCELLATION_PENDING' || incoming === 'CANCELLED') return incoming;
  if (previous === 'CONFIRM_PENDING') return ['SUCCESS', 'FAILED', 'ABORTED'].includes(incoming) ? incoming : previous;
  if (previous === 'SUCCESS') return previous;
  return HOTEL_SETTLED.includes(incoming) ? incoming : previous === 'ON_HOLD' ? previous : 'UNKNOWN';
}
