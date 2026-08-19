import type { NormalizedFare } from "../base.js";

export function normalizeTripjackFare(r: Record<string, unknown>): NormalizedFare {
  const fi = (r.sI as Record<string, unknown>[])?.[0] ?? {};
  const totalPriceInfo = (r.totalPriceInfo as Record<string, Record<string, number>>) ?? {};
  return {
    id:            r.id as string,
    supplier:      "TRIPJACK",
    isBookable:    true,
    airline:       (fi.fD as Record<string, Record<string, string>>)?.aI?.code ?? "",
    airlineName:   (fi.fD as Record<string, Record<string, string>>)?.aI?.name ?? "",
    flightNumber:  (fi.fD as Record<string, unknown>)?.fN as string ?? "",
    origin:        (fi.da as Record<string, string>)?.code ?? "",
    destination:   (fi.aa as Record<string, string>)?.code ?? "",
    departureTime: fi.dt as string ?? "",
    arrivalTime:   fi.at as string ?? "",
    duration:      fi.duration as number ?? 0,
    stops:         (r.sI as unknown[]).length - 1,
    stopDetails:   [],
    cabinClass:    r.cabinClass as string ?? "ECONOMY",
    baseFare:      totalPriceInfo.fd?.fC?.BF ?? 0,
    taxes:         totalPriceInfo.fd?.fC?.TAF ?? 0,
    totalFare:     totalPriceInfo.fd?.fC?.TF ?? 0,
    currency:      "INR",
    isRefundable:  (r.fareIdentifier as string) !== "NONREFUNDABLE",
    baggage: {
      cabin:   "7 KG",
      checked: "15 KG",
    },
    fareClass:  r.fareIdentifier as string ?? "",
    seatsLeft:  r.seatsAvailable as number,
    raw:        r,
  };
}
