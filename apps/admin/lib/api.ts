const API    = process.env.NEXT_PUBLIC_API_URL ?? "https://api.flypoomas.com";
const TENANT = "poomas";

export function getAuthToken(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(/(?:^|;\s*)poomas_admin_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

export function apiHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getAuthToken();
  return {
    "Content-Type":  "application/json",
    "x-tenant-slug": TENANT,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

export { API, TENANT };
