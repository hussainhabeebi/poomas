export * from "./base.js";
export * from "./router.js";
export { RiyaAdapter }          from "./riya/adapter.js";
export { TripjackAdapter }      from "./tripjack/adapter.js";
export { TripjackClient }       from "./tripjack/client.js";
export { TripjackHotelAdapter } from "./tripjack/hotel-adapter.js";
export type {
  HotelSearchParams, NormalizedHotel, HotelPreBookResult,
  HotelBookParams, HotelBookResult, HotelCancelResult,
  RoomInfo, GuestInfo,
} from "./tripjack/hotel-types.js";
// Duffel and SERP adapters kept for future re-enablement
export { SerpAdapter }   from "./serp/adapter.js";
export { DuffelAdapter } from "./duffel/adapter.js";
