// Stores sanitized diagnostic exchanges. Raw credentials and guest/payment
// payloads must never be retained, including for certification or error analysis.

import type { ExchangeRecorder, SupplierExchange } from "@poomas/suppliers";
import { supplierExchanges } from "@poomas/db/schema";
import type { Env, Variables } from "../types.js";
import { supplierLogBody, supplierLogHeaders, supplierLogUrl } from './supplier-log-redaction.js';

export interface ExchangeCollector { recorder: ExchangeRecorder; exchanges: SupplierExchange[] }

export function collectExchanges(): ExchangeCollector {
  const exchanges: SupplierExchange[] = [];
  return { exchanges, recorder: (x) => { exchanges.push(x); } };
}

export async function persistExchanges(
  env: Pick<Env, "DOCUMENTS_R2">,
  db: Variables["db"],
  tenantId: string,
  exchanges: SupplierExchange[],
  link: { bookingId?: string | null; searchId?: string | null; requestId?: string | null },
): Promise<void> {
  if (!exchanges.length) return;
  const scope = link.bookingId ? `booking-${link.bookingId}` : link.searchId ? `search-${link.searchId}` : `request-${link.requestId ?? "unlinked"}`;
  const prefix = `api-logs/${tenantId}/${scope}`;
  for (const [i, x] of exchanges.entries()) {
    try {
      const stamp = x.startedAt.replace(/[:.]/g, "-");
      const slug = x.endpoint.replace(/^\//, "").replace(/[^a-zA-Z0-9]+/g, "-");
      const base = `${prefix}/${stamp}-${String(i + 1).padStart(2, "0")}-${slug}`;

      const requestKey = `${base}-request.json`;
      await env.DOCUMENTS_R2.put(requestKey, JSON.stringify({
        method: x.method, url: supplierLogUrl(x.url), headers: supplierLogHeaders(x.requestHeaders), body: supplierLogBody(x.requestBody), sentAt: x.startedAt,
      }, null, 2), { httpMetadata: { contentType: "application/json" } });

      let responseKey: string | null = null;
      if (x.responseBody !== null) {
        responseKey = `${base}-response.json`;
        await env.DOCUMENTS_R2.put(responseKey, JSON.stringify(supplierLogBody(x.responseBody)), {
          httpMetadata: { contentType: "application/json" },
          customMetadata: { httpStatus: String(x.status ?? ""), responseHeaders: JSON.stringify(supplierLogHeaders(x.responseHeaders)) },
        });
      }

      await db.insert(supplierExchanges).values({
        tenantId, bookingId: link.bookingId ?? null, searchId: link.searchId ?? null, requestId: link.requestId ?? null,
        supplier: x.supplier, endpoint: x.endpoint, url: supplierLogUrl(x.url), httpStatus: x.status, durationMs: x.durationMs,
        error: x.error ? 'SUPPLIER_REQUEST_FAILED' : null, requestKey, responseKey, startedAt: new Date(x.startedAt),
      });
    } catch (err) {
      console.error('[api-exchanges] failed to store sanitized diagnostic log');
    }
  }
}

// Keeps the write alive after the response when a Worker execution context exists.
export function persistInBackground(c: { executionCtx: { waitUntil(p: Promise<unknown>): void } }, work: Promise<void>) {
  try { c.executionCtx.waitUntil(work); } catch { void work; }
}
