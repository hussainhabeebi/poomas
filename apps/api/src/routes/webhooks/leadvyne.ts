// POST /webhooks/leadvyne — inbound messages from Leadvyne WhatsApp gateway
// Verifies HMAC-SHA256 signature, classifies intent via keyword matching,
// and routes to the BookingAgent or notification queue accordingly.

import type { Handler } from "hono";
import type { Env, Variables } from "../../types.js";

export const leadvyneWebhook: Handler<{ Bindings: Env; Variables: Variables }> = async (c) => {
  const rawBody   = await c.req.text();
  const signature = c.req.header("X-Leadvyne-Signature") ?? "";

  if (c.env.LEADVYNE_WEBHOOK_SECRET && signature) {
    const secret   = new TextEncoder().encode(c.env.LEADVYNE_WEBHOOK_SECRET);
    const data     = new TextEncoder().encode(rawBody);
    const key      = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const sigBytes = Uint8Array.from(Buffer.from(signature.replace("sha256=", ""), "hex"));
    const valid    = await crypto.subtle.verify("HMAC", key, sigBytes, data);
    if (!valid) return c.json({ error: "Invalid signature" }, 400);
  }

  const event = JSON.parse(rawBody) as {
    event:       string;
    instanceId:  string;
    from:        string;
    messageId:   string;
    timestamp:   number;
    type:        "text" | "image" | "document" | "audio" | "button";
    text?:       string;
    media?:      { url: string; mimeType: string; caption?: string };
    button?:     { id: string; title: string };
  };

  const incomingText = event.text ?? event.button?.title ?? "";

  // Keyword-based intent classification
  const lower = incomingText.toLowerCase();
  const isFlightSearch = /\b(fly|flight|book|ticket|travel|from|to|going)\b/.test(lower) ||
    /\b(dxb|auh|shj|doh|mct|bah|kwi|ruh|jed|ccj|cok|blr|bom|del|hyd|maa)\b/i.test(incomingText);
  const intent = isFlightSearch ? "FLIGHT_SEARCH" : "GENERAL";

  if (intent === "FLIGHT_SEARCH" && incomingText) {
    try {
      const agentId = c.env.BOOKING_AGENT.idFromName(`wa:${event.from}`);
      const stub    = c.env.BOOKING_AGENT.get(agentId);

      const agentRes = await stub.fetch("https://agent/message", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ text: incomingText }),
      });

      const { reply } = (await agentRes.json()) as { reply: string };

      if (reply && c.env.LEADVYNE_API_KEY) {
        await fetch(`${c.env.LEADVYNE_BASE_URL ?? "https://api.leadvyne.com"}/v1/messages/send`, {
          method:  "POST",
          headers: {
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${c.env.LEADVYNE_API_KEY}`,
            "X-Instance-ID": c.env.LEADVYNE_INSTANCE_ID ?? "",
          },
          body: JSON.stringify({ to: event.from, message: reply }),
        });
      }
    } catch (err) {
      console.error("[leadvyne] agent routing error", err);
      await c.env.NOTIFY_QUEUE.send({
        type: "WHATSAPP_INBOUND", from: event.from, messageId: event.messageId,
        text: incomingText, timestamp: event.timestamp, intent,
      });
    }
  } else {
    await c.env.NOTIFY_QUEUE.send({
      type:      "WHATSAPP_INBOUND",
      from:      event.from,
      messageId: event.messageId,
      text:      incomingText,
      media:     event.media,
      button:    event.button,
      timestamp: event.timestamp,
      intent,
    });
  }

  return c.json({ ok: true });
};
