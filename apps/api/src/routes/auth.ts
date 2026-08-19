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

  // TODO: verify password hash or OTP
  // For now, placeholder — actual implementation uses argon2 + OTP via WhatsApp/SMS

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
  // TODO: queue OTP dispatch via NOTIFY_QUEUE → Leadvyne WhatsApp or SMS
  return c.json({ ok: true, message: "OTP sent if account exists" });
});
