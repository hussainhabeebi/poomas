import type { KVNamespace, R2Bucket, Queue, Hyperdrive, DurableObjectNamespace } from "@cloudflare/workers-types";
import type { Db } from "@poomas/db";

// Cloudflare Worker bindings (matches wrangler.toml)
export interface Env {
  ENVIRONMENT:          string;
  PLATFORM_TENANT_SLUG: string;

  // KV
  SESSIONS_KV:      KVNamespace;
  TENANT_CACHE_KV:  KVNamespace;
  FARE_CACHE_KV:    KVNamespace;

  // R2
  DOCUMENTS_R2:     R2Bucket;
  PUBLIC_ASSETS_R2: R2Bucket;

  // Queues
  BOOKING_QUEUE:    Queue;
  NOTIFY_QUEUE:     Queue;

  // Hyperdrive (Neon Postgres)
  HYPERDRIVE:       Hyperdrive;

  // Durable Objects
  TENANT_RATE_LIMITER: DurableObjectNamespace;

  // Secrets (set via `wrangler secret put`)
  DATABASE_URL:           string;
  JWT_SECRET:             string;
  RIYA_API_KEY:           string;
  RIYA_API_SECRET:        string;
  RIYA_API_BASE_URL:      string;
  TRIPJACK_API_KEY:       string;
  TRIPJACK_API_BASE_URL:  string;
  SERP_API_KEY:           string;
  RAZORPAY_KEY_ID:        string;
  RAZORPAY_KEY_SECRET:    string;
  RAZORPAY_WEBHOOK_SECRET: string;
  NOMOD_API_KEY:          string;
  NOMOD_API_SECRET:       string;
  NOMOD_WEBHOOK_SECRET:   string;
}

// Per-request context variables (populated by middleware)
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
