// Supplier interface — every adapter implements this.
// Only RIYA and TRIPJACK implement book/PNR/cancel flows.
// GOOGLE_SERP implements search only and always returns isBookable: false.

export interface SearchParams {
  origin:       string;  // IATA code
  destination:  string;
  departureDate: string; // YYYY-MM-DD
  returnDate?:  string;
  adults:       number;
  children:     number;
  infants:      number;
  cabinClass:   "ECONOMY" | "PREMIUM_ECONOMY" | "BUSINESS" | "FIRST";
  tripType:     "ONEWAY" | "ROUNDTRIP" | "MULTICITY";
  currency:     "INR" | "AED" | "USD";
  sessionId?:   string;
}

export interface NormalizedFare {
  id:            string;         // Supplier-specific fare key (used for hold/book)
  supplier:      "RIYA" | "TRIPJACK" | "GOOGLE_SERP";
  isBookable:    boolean;        // false for SERP results
  airline:       string;         // IATA airline code
  airlineName:   string;
  flightNumber:  string;
  origin:        string;
  destination:   string;
  departureTime: string;         // ISO 8601
  arrivalTime:   string;
  duration:      number;         // minutes
  stops:         number;
  stopDetails:   StopDetail[];
  cabinClass:    string;
  baseFare:      number;
  taxes:         number;
  totalFare:     number;
  currency:      string;
  isRefundable:  boolean;
  baggage:       BaggageInfo;
  fareClass:     string;
  seatsLeft?:    number;
  fareRules?:    FareRule[];
  raw:           unknown;        // Original supplier response (kept for debugging)
}

export interface StopDetail {
  airport:      string;
  arrivalTime:  string;
  departureTime: string;
  layoverMinutes: number;
}

export interface BaggageInfo {
  cabin:   string;   // "7 KG" | "Hand bag only"
  checked: string;   // "15 KG" | "20 KG" | "Not included"
}

export interface FareRule {
  category:    string;
  description: string;
}

export interface HoldParams {
  fareId:    string;
  sessionId?: string;
  passengers: PassengerInfo[];
}

export interface PassengerInfo {
  type:          "ADULT" | "CHILD" | "INFANT";
  firstName:     string;
  lastName:      string;
  dob?:          string;
  gender?:       string;
  nationality?:  string;
  passportNumber?: string;
  passportExpiry?: string;
}

export interface HoldResult {
  success:       boolean;
  holdId:        string;
  pnr?:          string;
  expiresAt:     string;   // ISO 8601
  fareSnapshot:  NormalizedFare;
}

export interface BookParams extends HoldParams {
  holdId:       string;
  contactEmail: string;
  contactPhone: string;
  paymentRef:   string;
}

export interface BookResult {
  success:       boolean;
  bookingRef:    string;
  pnr:           string;
  status:        "CONFIRMED" | "TICKETED" | "FAILED";
  ticketNumbers: string[];
  raw:           unknown;
}

export interface PNRStatusResult {
  pnr:          string;
  status:       string;
  passengers:   { name: string; ticketNumber: string; status: string }[];
  itinerary:    unknown;
}

export interface CancelResult {
  success:      boolean;
  refundAmount: number;
  penalty:      number;
  status:       string;
}

// Core supplier interface — every adapter implements search()
export interface SupplierAdapter {
  readonly name: "RIYA" | "TRIPJACK" | "GOOGLE_SERP";

  search(params: SearchParams): Promise<NormalizedFare[]>;
  getFareRules?(fareId: string, sessionId?: string): Promise<FareRule[]>;

  // Bookable suppliers only
  hold?(params: HoldParams): Promise<HoldResult>;
  book?(params: BookParams): Promise<BookResult>;
  getPNRStatus?(pnr: string): Promise<PNRStatusResult>;
  cancel?(bookingRef: string, pnr: string): Promise<CancelResult>;
  reissue?(bookingRef: string, params: unknown): Promise<unknown>;
}

export interface SupplierCredentials {
  apiKey?:    string;
  secretKey?: string;
  baseUrl?:   string;
  [key: string]: unknown;
}
