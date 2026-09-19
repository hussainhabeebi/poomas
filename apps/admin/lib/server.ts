export const SERVER_API =
  process.env.API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "https://api.flypoomas.com";

export const SERVER_TOKEN = process.env.ADMIN_SERVICE_TOKEN ?? "";
