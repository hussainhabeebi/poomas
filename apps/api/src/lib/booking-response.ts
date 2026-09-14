import type { BookResult } from "@poomas/suppliers";

// HTTP success means the request was accepted, not necessarily ticketed.
export function normalizeBookingResponse(raw: unknown, sessionId: string): Omit<BookResult, "status"> & { status: BookResult["status"] | "PENDING" } {
  const root = raw as any;
  const data = root?.data ?? root?.result ?? root;
  const apiStatus = data?.status ?? root?.status;
  const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

  // Coerce success to boolean — TripJack may return string "true"/"false" or omit the field.
  const successFlag = apiStatus?.success;
  const bookingRef = text(data?.bookingId) || text(root?.bookingId);

  // Throw only when there is genuinely no way to establish the outcome.
  if (successFlag == null && !bookingRef) {
    console.error("[book-normalize] Unrecognized booking response", JSON.stringify(root).slice(0, 500));
    throw new Error("Booking response did not establish an outcome");
  }

  const isSuccess = successFlag === true || successFlag === "true";
  const success = isSuccess && root?.status?.success !== false
    && !(root?.errors?.length || data?.errors?.length);
  const resolvedRef = bookingRef || (success ? sessionId : "");
  const pnr = text(data?.pnr) || text(data?.pnrDetails) || text(root?.pnrDetails);
  const state = text(data?.bookingStatus).toUpperCase();
  const failed = ["FAILED", "CANCELLED", "REJECTED"].includes(state);
  return {
    success: success && !failed && !!resolvedRef,
    bookingRef: resolvedRef,
    pnr,
    status: !success || failed ? "FAILED"
      : pnr && state === "TICKETED" ? "TICKETED"
      : pnr && state === "CONFIRMED" ? "CONFIRMED" : "PENDING",
    ticketNumbers: [],
    raw,
  };
}
