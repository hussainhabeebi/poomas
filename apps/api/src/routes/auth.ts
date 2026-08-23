import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { SignJWT } from "jose";
import { users, userSessions } from "@poomas/db/schema";
import { eq, and } from "drizzle-orm";
import type { Env, Variables } from "../types.js";

export const authRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const loginSchema = z.object({
  email:    z.string().email().optional(),
  phone:    z.string().min(8).optional(),
  password: z.string().optional(),
  otp:      z.string().length(6).optional(),
}).refine((d) => d.email || d.phone, "email or phone required");

// Issue a JWT scoped to the resolved tenant (tenant_id from domain, not from request body)
const registerSchema = z.object({
  name:     z.string().min(2).max(100),
  email:    z.string().email(),
  password: z.string().min(8),
  phone:    z.string().min(8).optional(),
});

authRoutes.post("/register", zValidator("json", registerSchema), async (c) => {
  const body     = c.req.valid("json");
  const db       = c.get("db");
  const tenantId = c.get("tenantId");

  // Check duplicate email within tenant
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, body.email), eq(users.tenantId, tenantId)))
    .limit(1);

  if (existing) {
    throw new HTTPException(409, { message: "Email already registered" });
  }

  const passwordHash = await pbkdf2HashPassword(body.password);

  await db.insert(users).values({
    tenantId,
    name:         body.name,
    email:        body.email,
    phone:        body.phone ?? null,
    passwordHash,
    role:         "AGENT",
    isActive:     true,
    emailVerified: false,
  });

  return c.json({ ok: true }, 201);
});

authRoutes.post("/login", zValidator("json", loginSchema), async (c) => {
  const body     = c.req.valid("json");
  const db       = c.get("db");
  const tenantId = c.get("tenantId");

  const whereClause = body.email
    ? and(eq(users.email, body.email), eq(users.tenantId, tenantId))
    : and(eq(users.phone, body.phone!),  eq(users.tenantId, tenantId));

  const [user] = await db.select().from(users).where(whereClause).limit(1);

  if (!user || !user.isActive) {
    throw new HTTPException(401, { message: "Invalid credentials" });
  }

  // Verify password (argon2id stored as $argon2id$...) or OTP
  if (body.password && user.passwordHash) {
    const valid = await verifyPassword(body.password, user.passwordHash);
    if (!valid) throw new HTTPException(401, { message: "Invalid credentials" });
  } else if (body.otp) {
    const otpKey = `otp:${tenantId}:${user.id}`;
    const stored = await c.env.SESSIONS_KV.get(otpKey);
    if (!stored || stored !== body.otp) {
      throw new HTTPException(401, { message: "Invalid or expired OTP" });
    }
    await c.env.SESSIONS_KV.delete(otpKey);
  } else {
    throw new HTTPException(401, { message: "Password or OTP required" });
  }

  const secret = new TextEncoder().encode(c.env.JWT_SECRET);
  const token  = await new SignJWT({
    userId:   user.id,
    tenantId: user.tenantId,
    role:     user.role,
    agentId:  user.agentId ?? undefined,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(secret);

  // Store session in KV (fast lookup + revocation support)
  await c.env.SESSIONS_KV.put(`session:${user.id}`, JSON.stringify({
    userId: user.id, tenantId, role: user.role,
  }), { expirationTtl: 86400 });

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

  return c.json({ token, expiresIn: 86400, role: user.role });
});

authRoutes.post("/logout", async (c) => {
  const auth = c.req.header("Authorization") ?? "";
  if (auth.startsWith("Bearer ")) {
    // Invalidate session from KV
    const { jwtVerify } = await import("jose");
    try {
      const secret  = new TextEncoder().encode(c.env.JWT_SECRET);
      const { payload } = await jwtVerify(auth.slice(7), secret) as { payload: { userId: string } };
      await c.env.SESSIONS_KV.delete(`session:${payload.userId}`);
    } catch {}
  }
  return c.json({ ok: true });
});

// OTP request (sends via WhatsApp/SMS — returns success regardless to prevent enumeration)
const otpSchema = z.object({ phone: z.string().min(8) });
authRoutes.post("/otp/request", zValidator("json", otpSchema), async (c) => {
  const { phone } = c.req.valid("json");
  const db        = c.get("db");
  const tenantId  = c.get("tenantId");

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.phone, phone), eq(users.tenantId, tenantId)))
    .limit(1);

  if (user) {
    const otp    = Math.floor(100000 + Math.random() * 900000).toString();
    const otpKey = `otp:${tenantId}:${user.id}`;
    await c.env.SESSIONS_KV.put(otpKey, otp, { expirationTtl: 600 }); // 10 min TTL

    // Queue OTP delivery via NOTIFY_QUEUE
    await c.env.NOTIFY_QUEUE.send({
      type:    "NOTIFY_OTP",
      phone,
      otp,
      tenantId,
    });
  }

  // Always return 200 to prevent account enumeration
  return c.json({ ok: true, message: "OTP sent if account exists" });
});

async function pbkdf2HashPassword(password: string): Promise<string> {
  const iterations = 100_000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2Hash(password, salt, iterations);
  return `pbkdf2:sha256:${iterations}:${bytesToHex(salt)}:${hash}`;
}

// Password hashing/verification using Web Crypto (PBKDF2 — no native argon2 on CF Workers)
async function verifyPassword(password: string, hash: string): Promise<boolean> {
  // Hash format: pbkdf2:sha256:<iterations>:<salt_hex>:<hash_hex>
  const parts = hash.split(":");
  if (parts.length !== 5 || parts[0] !== "pbkdf2") return false;

  const [, , iters, saltHex, storedHash] = parts;
  const salt = hexToBytes(saltHex);
  const computed = await pbkdf2Hash(password, salt, Number(iters));

  return timingSafeEqual(computed, storedHash);
}

async function pbkdf2Hash(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key, 256,
  );
  return bytesToHex(new Uint8Array(bits));
}

function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return arr;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
