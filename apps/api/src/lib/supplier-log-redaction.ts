// Persist diagnostic metadata, never raw supplier bodies. A denylist cannot
// reliably remove personal data echoed in arbitrary provider error strings.
const KNOWN_CODES = new Set([
  'TIMEOUT', 'NETWORK_ERROR', 'NOT_CONFIGURED', 'INVALID_RESPONSE', 'PRICE_CHANGED',
  'SEARCH_SESSION_EXPIRED', 'OPTION_SOLD_OUT', 'CITY_INDEX_MISSING', 'CITY_NOT_FOUND',
  'NATIONALITY_UNSUPPORTED', 'UNSUPPORTED_TRIPJACK_ROUTE', 'PAN_REQUIRED',
  'UNAUTHORIZED', 'FORBIDDEN', 'API_KEY_SUSPENDED', 'INVALID_HOTEL_ID',
]);

export function supplierLogCode(value: unknown): string {
  if (typeof value === 'number' && Number.isInteger(value)) value = String(value);
  if (typeof value !== 'string') return 'SUPPLIER_ERROR';
  return KNOWN_CODES.has(value) || /^\d{1,6}$/.test(value) || /^HTTP_[1-5]\d{2}$/.test(value)
    ? value : 'SUPPLIER_ERROR';
}

export function supplierLogBody(raw: string | null): Record<string, unknown> {
  let body: any;
  try { body = raw === null ? null : JSON.parse(raw); } catch { return { redacted: true, format: 'non-json' }; }
  const result: Record<string, unknown> = { redacted: true };
  if (!body || typeof body !== 'object' || Array.isArray(body)) return result;
  if (typeof body.status?.success === 'boolean') result.success = body.status.success;
  if (Number.isInteger(body.status?.httpStatus) && body.status.httpStatus >= 100 && body.status.httpStatus <= 599) result.httpStatus = body.status.httpStatus;
  if (typeof body.correlationId === 'string' && /^[a-f0-9]{32}$/i.test(body.correlationId)) result.correlationId = body.correlationId;
  if (Array.isArray(body.errors)) result.errorCodes = body.errors.slice(0, 10).map((e: any) => supplierLogCode(e?.errCode));
  const counts: Record<string, number> = {};
  for (const key of ['hotels', 'options', 'rooms', 'nationalityInfos']) {
    if (Array.isArray(body[key])) counts[key] = body[key].length;
  }
  if (Object.keys(counts).length) result.counts = counts;
  return result;
}

export function supplierLogHeaders(headers: Record<string, string>): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (['accept', 'content-type'].includes(lower) && ['application/json', 'text/plain', 'text/plain; charset=utf-8', '*/*'].includes(value.toLowerCase())) safe[lower] = value;
  }
  return safe;
}

export function supplierLogSummary(input: Record<string, unknown> | undefined): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of ['rooms', 'guests', 'paxCount', 'candidates', 'hotelCount', 'optionCount', 'count']) {
    const value = input?.[key];
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) result[key] = value;
  }
  if (typeof input?.correlationId === 'string' && /^[a-f0-9]{32}$/i.test(input.correlationId)) result.correlationId = input.correlationId;
  return result;
}

export function supplierLogUrl(value: string): string {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? `${url.origin}${url.pathname}` : '[redacted-url]';
  } catch { return '[redacted-url]'; }
}
