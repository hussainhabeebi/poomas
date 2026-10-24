import type { Db } from "@poomas/db";
import { supplierApiLogs } from "@poomas/db/schema";
import { supplierLogBody, supplierLogCode, supplierLogSummary } from './supplier-log-redaction.js';

export interface SupplierCallLog {
  tenantId:       string;
  supplier:       "TRIPJACK" | "RIYA" | "DUFFEL" | "GOOGLE_SERP";
  endpoint:       string;
  httpStatus?:    number;
  level:          "INFO" | "WARN" | "ERROR";
  requestId?:     string;
  requestSummary?: Record<string, unknown>;
  responseSnippet?: string;
  errorCode?:     string;
  errorMessage?:  string;
  durationMs?:    number;
}

export async function logSupplierCall(db: Db, entry: SupplierCallLog): Promise<void> {
  try {
    await db.insert(supplierApiLogs).values({
      tenantId:        entry.tenantId,
      supplier:        entry.supplier,
      endpoint:        entry.endpoint,
      httpStatus:      entry.httpStatus ?? null,
      level:           entry.level,
      requestId:       entry.requestId ?? null,
      requestSummary:  supplierLogSummary(entry.requestSummary),
      responseSnippet: entry.responseSnippet ? JSON.stringify(supplierLogBody(entry.responseSnippet)) : null,
      errorCode:       entry.errorCode ? supplierLogCode(entry.errorCode) : null,
      errorMessage:    entry.errorMessage ? 'Supplier operation failed; inspect the sanitized code and request ID.' : null,
      durationMs:      entry.durationMs ?? null,
    });
  } catch (err) {
    console.error("[supplier-logger] sanitized diagnostic insert failed");
  }
}
