import type { NormalizedFare } from "../base.js";

export function normalizeTripjackFare(r: Record<string, unknown>, counts = { ADULT: 1, CHILD: 0, INFANT: 0 }): NormalizedFare {
  const segments = (r.sI as Record<string, unknown>[]) ?? [];
  const fi = segments[0] ?? {};
  const last = segments[segments.length - 1] ?? fi;
  const totalPriceInfo = (r.totalPriceInfo as {
    fd?: Record<string, any>;
  }) ?? {};
  const fd = totalPriceInfo.fd ?? {};
  const sum = (key: string) => fd.fC ? Number(fd.fC[key] ?? 0) :
    Object.entries(counts).reduce((total, [type, count]) => total + count * Number(fd[type]?.fC?.[key] ?? 0), 0);
  const adult = fd.ADULT ?? fd;
  const totalFare = sum("TF");
  return {
    id:            r.id as string,
    supplier:      "TRIPJACK",
    isBookable:    Boolean(r.id) && Number.isFinite(totalFare) && totalFare > 0,
    airline:       (fi.fD as Record<string, Record<string, string>>)?.aI?.code ?? "",
    airlineName:   (fi.fD as Record<string, Record<string, string>>)?.aI?.name ?? "",
    flightNumber:  (fi.fD as Record<string, unknown>)?.fN as string ?? "",
    origin:        (fi.da as Record<string, string>)?.code ?? "",
    destination:   (last.aa as Record<string, string>)?.code ?? "",
    departureTime: fi.dt as string ?? "",
    arrivalTime:   last.at as string ?? "",
    duration:      segments.reduce((n, s, i) => n + Number(s.duration ?? 0) + (i < segments.length - 1 ? Number(s.cT ?? 0) : 0), 0),
    stops:         Math.max(0, segments.length - 1),
    stopDetails:   [],
    cabinClass:    r.cabinClass as string ?? "ECONOMY",
    baseFare:      sum("BF"),
    taxes:         sum("TAF"),
    totalFare,
    currency:      "INR",
    isRefundable:  adult.rT === 1,
    baggage: {
      cabin:   adult.bI?.cB ?? "",
      checked: adult.bI?.iB ?? "",
    },
    fareClass:  r.fareIdentifier as string ?? "",
    seatsLeft:  r.seatsAvailable as number,
    raw:        r,
  };
}
