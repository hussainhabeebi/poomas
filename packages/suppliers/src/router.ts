import type { NormalizedFare, SearchParams, SupplierAdapter, SupplierCredentials } from "./base.js";
import { RiyaAdapter } from "./riya/adapter.js";
import { TripjackAdapter } from "./tripjack/adapter.js";
import { SerpAdapter } from "./serp/adapter.js";

export interface SupplierConfig {
  name:        "RIYA" | "TRIPJACK" | "GOOGLE_SERP";
  isEnabled:   boolean;
  priority:    number;  // 1 = first, higher = later fallback
  credentials: SupplierCredentials | null;
  timeoutMs:   number;
  maxRetries:  number;
}

export interface SearchResult {
  fares:          NormalizedFare[];
  usedSuppliers:  ("RIYA" | "TRIPJACK" | "GOOGLE_SERP")[];
  isIndicative:   boolean;   // true if results came from SERP (non-bookable)
  errors:         Record<string, string>;
}

// Creates an adapter instance from config, falling back to platform env vars if no credentials
function buildAdapter(config: SupplierConfig): SupplierAdapter {
  const creds = config.credentials ?? {};
  switch (config.name) {
    case "RIYA":        return new RiyaAdapter(creds);
    case "TRIPJACK":    return new TripjackAdapter(creds);
    case "GOOGLE_SERP": return new SerpAdapter(creds);
  }
}

// Wraps a supplier search with per-supplier timeout + retry
async function searchWithTimeout(
  adapter: SupplierAdapter,
  params: SearchParams,
  timeoutMs: number,
  maxRetries: number,
): Promise<NormalizedFare[]> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const results = await adapter.search(params);
        clearTimeout(timer);
        return results;
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }

  throw lastError ?? new Error("Unknown supplier error");
}

// Deduplicates by flight number + departure time (same physical flight from both suppliers)
function deduplicate(fares: NormalizedFare[]): NormalizedFare[] {
  const seen = new Map<string, NormalizedFare>();

  for (const fare of fares) {
    const key = `${fare.flightNumber}_${fare.departureTime}_${fare.cabinClass}`;
    const existing = seen.get(key);

    if (!existing || fare.totalFare < existing.totalFare) {
      seen.set(key, fare);  // Keep cheapest when same flight appears from both suppliers
    }
  }

  return Array.from(seen.values()).sort((a, b) => a.totalFare - b.totalFare);
}

// Primary search router: tries suppliers in priority order, combines bookable results.
// Falls back to SERP only if all bookable suppliers fail AND context is WhatsApp.
export async function searchFares(
  params: SearchParams,
  supplierConfigs: SupplierConfig[],
  options: { allowSerpFallback?: boolean } = {},
): Promise<SearchResult> {
  const sorted = supplierConfigs
    .filter((c) => c.isEnabled)
    .sort((a, b) => a.priority - b.priority);

  const bookableConfigs = sorted.filter((c) => c.name !== "GOOGLE_SERP");
  const serpConfig      = sorted.find((c) => c.name === "GOOGLE_SERP");

  const allFares: NormalizedFare[]              = [];
  const usedSuppliers: SearchResult["usedSuppliers"] = [];
  const errors: Record<string, string>          = {};

  // Try all bookable suppliers concurrently (Riya + Tripjack in parallel)
  const results = await Promise.allSettled(
    bookableConfigs.map(async (config) => {
      const adapter = buildAdapter(config);
      const fares   = await searchWithTimeout(adapter, params, config.timeoutMs, config.maxRetries);
      return { supplier: config.name, fares };
    }),
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      allFares.push(...result.value.fares);
      usedSuppliers.push(result.value.supplier as "RIYA" | "TRIPJACK");
    } else {
      const config = bookableConfigs[results.indexOf(result)];
      errors[config.name] = result.reason?.message ?? "Unknown error";
    }
  }

  // If we have bookable results, deduplicate and return
  if (allFares.length > 0) {
    return {
      fares:         deduplicate(allFares),
      usedSuppliers,
      isIndicative:  false,
      errors,
    };
  }

  // All bookable suppliers failed — fall back to SERP if allowed (WhatsApp context only)
  if (options.allowSerpFallback && serpConfig) {
    try {
      const adapter = buildAdapter(serpConfig);
      const fares   = await searchWithTimeout(adapter, params, serpConfig.timeoutMs, 1);
      return {
        fares:         fares.sort((a, b) => a.totalFare - b.totalFare),
        usedSuppliers: ["GOOGLE_SERP"],
        isIndicative:  true,  // Caller must display disclaimer
        errors,
      };
    } catch (err) {
      errors["GOOGLE_SERP"] = err instanceof Error ? err.message : "SERP failed";
    }
  }

  return { fares: [], usedSuppliers: [], isIndicative: false, errors };
}

// Gets the right bookable adapter for post-search operations (hold, book, cancel)
// Always uses the supplier that generated the fare (stored in fare.supplier)
export function getBookableAdapter(
  supplierName: "RIYA" | "TRIPJACK",
  configs: SupplierConfig[],
): SupplierAdapter {
  const config = configs.find((c) => c.name === supplierName && c.isEnabled);
  if (!config) throw new Error(`Supplier ${supplierName} not available`);
  return buildAdapter(config);
}
