export * from "./base.js";
export * from "./router.js";
export { RiyaAdapter }          from "./riya/adapter.js";
export { TripjackAdapter }      from "./tripjack/adapter.js";
export { TripjackClient }       from "./tripjack/client.js";
export { TripjackHotelAdapter } from "./tripjack/hotel-adapter.js";
export {
  TripjackHotelV3Client, TripjackHotelError, isHotelError, normalizeOption, normalizeContent,
  parseHotelBookingDetails, HOTEL_TERMINAL_STATUSES,
  type HotelV3Room, type HotelV3Option, type HotelV3Pricing, type HotelV3Content, type HotelV3ListingHotel,
} from "./tripjack/hotel-v3.js";
export type {
  HotelSearchParams, NormalizedHotel, HotelPreBookResult,
  HotelBookParams, HotelBookResult, HotelCancelResult,
  RoomInfo, GuestInfo,
} from "./tripjack/hotel-types.js";
// Duffel and SERP adapters kept for future re-enablement
export { SerpAdapter }   from "./serp/adapter.js";
export { DuffelAdapter } from "./duffel/adapter.js";
export type { SupplierExchange, ExchangeRecorder } from "./tripjack/client.js";
