import type { BookResult } from "@poomas/suppliers";

// HTTP success means the request was accepted, not necessarily ticketed.
export function normalizeBookingResponse(raw: unknown, sessionId: string): Omit<BookResult, "status"> & { status: BookResult["status"] | "PENDING" } {
  const root = raw as any;
  const data = root?.data ?? root?.result ?? root;
  const apiStatus = data?.status ?? root?.status;
  if (typeof apiStatus?.success !== "boolean") throw new Error("Booking response did not establish an outcome");
  const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
  const success = root?.status?.success !== false && apiStatus.success === true
    && !(root?.errors?.length || data?.errors?.length);
  const bookingRef = text(data?.bookingId) || (success ? sessionId : "");
  const pnr = text(data?.pnr) || text(data?.pnrDetails);
  const state = text(data?.bookingStatus).toUpperCase();
  const failed = ["FAILED", "CANCELLED", "REJECTED"].includes(state);
  return {
    success: success && !failed && !!bookingRef,
    bookingRef,
    pnr,
    status: !success || failed ? "FAILED"
      : pnr && state === "TICKETED" ? "TICKETED"
      : pnr && state === "CONFIRMED" ? "CONFIRMED" : "PENDING",
    ticketNumbers: [],
    raw,
  };
}
