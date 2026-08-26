import type { KVNamespace, R2Bucket, Queue, Hyperdrive, DurableObjectNamespace } from "@cloudflare/workers-types";
import type { Db } from "@poomas/db";

export interface Env {
  ENVIRONMENT:          string;
  PLATFORM_TENANT_SLUG: string;
  SESSIONS_KV:      KVNamespace;
  TENANT_CACHE_KV:  KVNamespace;
  FARE_CACHE_KV:    KVNamespace;
  DOCUMENTS_R2:     R2Bucket;
  PUBLIC_ASSETS_R2: R2Bucket;
  BOOKING_QUEUE:    Queue;
  NOTIFY_QUEUE:     Queue;
  HYPERDRIVE:       Hyperdrive;
  TENANT_RATE_LIMITER: DurableObjectNamespace;
  DATABASE_URL:           string;
  JWT_SECRET:             string;
  RIYA_API_KEY:           string;
  RIYA_API_SECRET:        string;
  RIYA_API_BASE_URL:      string;
  TRIPJACK_API_KEY:       string;
  TRIPJACK_API_BASE_URL:  string;
  SERP_API_KEY:           string;
  DUFFEL_API_KEY:         string;
  POOMAS_INTEGRATION_KEY: string;
  RAZORPAY_KEY_ID:        string;
  RAZORPAY_KEY_SECRET:    string;
  RAZORPAY_WEBHOOK_SECRET: string;
  NOMOD_API_KEY:          string;
  NOMOD_API_SECRET:       string;
  NOMOD_WEBHOOK_SECRET:   string;
  RESEND_API_KEY:         string;

  // One-time admin bootstrap (set in Cloudflare dashboard, unset after first use)
  PLATFORM_ADMIN_EMAIL?:    string;
  PLATFORM_ADMIN_PASSWORD?: string;

  // Leadvyne WhatsApp gateway
  LEADVYNE_API_KEY:       string;
  LEADVYNE_API_SECRET:    string;
  LEADVYNE_BASE_URL:      string;
  LEADVYNE_INSTANCE_ID:   string;
  LEADVYNE_WEBHOOK_SECRET: string;
}

export interface Variables {
  db:       Db;
  tenantId: string;
  tenant:   TenantContext;
  userId?:  string;
  userRole?: string;
  agentId?: string;
}

export interface TenantContext {
  id:              string;
  slug:            string;
  name:            string;
  plan:            string;
  region:          string;
  defaultCurrency: string;
  searchRpmLimit:  number;
  bookingRpmLimit: number;
  supplierConfigs: SupplierConfigEntry[];
  paymentConfig:   PaymentConfig | null;
}

export interface SupplierConfigEntry {
  supplier:    string;
  isEnabled:   boolean;
  priority:    number;
  credentials: Record<string, string> | null;
  timeoutMs:   number;
  maxRetries:  number;
}

export interface PaymentConfig {
  razorpay?: { keyId: string; keySecret: string };
  nomod?:    { apiKey: string; apiSecret: string };
}
