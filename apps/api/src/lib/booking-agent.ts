// BookingAgent — Cloudflare Durable Object
// Maintains per-user conversation state for the WhatsApp-style chat booking flow.
// Uses Google Gemini API for NLU. Accepts WebSocket (web chat) and HTTP POST (WhatsApp webhook).

import type { Env } from "../types.js";

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

interface AgentState {
  history: ConversationMessage[];
  context: {
    origin?: string;
    destination?: string;
    date?: string;
    adults?: number;
    currency?: string;
  };
}

const SYSTEM_PROMPT = `You are Poomas ✈️, a friendly travel assistant for POOMAS Traveldays — India & Gulf flight specialist.

Help users:
- Search flights between Indian cities (CCJ, COK, BLR, BOM, DEL, HYD, MAA, AMD…) and Gulf (DXB, AUH, SHJ, DOH, MCT, BAH, KWI, RUH, JED)
- Answer booking and PNR status questions
- Provide fare estimates and travel tips

Keep replies short and conversational — this is WhatsApp chat, not email.

When the user wants to search for flights, extract the details and respond with a JSON block EXACTLY like this (no other text around it):
<search>{"origin":"CCJ","destination":"DXB","date":"2026-09-15","adults":1,"currency":"INR"}</search>

If a field is missing, ask a follow-up question for only that field.
Do NOT invent flight data — only show results I give you.`;

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

function buildWelcome(): string {
  return "Hi! I'm Poomas ✈️ Your personal travel assistant.\n\nWhere would you like to fly today?";
}

export class BookingAgent {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env   = env;
    this.state.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket();
    }
    if (request.method === "POST" && url.pathname.endsWith("/message")) {
      return this.handleHttpMessage(request);
    }
    return new Response("BookingAgent — use WebSocket or POST /message", { status: 200 });
  }

  // ── WebSocket (web chat UI) ────────────────────────────────────────────────

  private async handleWebSocket(): Promise<Response> {
    const pair   = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.state.acceptWebSocket(server);

    const s = await this.getState();
    if (s.history.length === 0) {
      server.send(JSON.stringify({ type: "message", role: "assistant", text: buildWelcome() }));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    try {
      const data = JSON.parse(raw as string) as { text?: string; currency?: string };
      if (!data.text?.trim()) return;
      ws.send(JSON.stringify({ type: "typing" }));
      const reply = await this.processMessage(data.text, data.currency);
      ws.send(JSON.stringify({ type: "message", role: "assistant", text: reply }));
    } catch {
      ws.send(JSON.stringify({ type: "message", role: "assistant", text: "Something went wrong. Please try again 🙏" }));
    }
  }

  async webSocketClose(): Promise<void> {}
  async webSocketError(): Promise<void> {}

  // ── HTTP (WhatsApp webhook) ────────────────────────────────────────────────

  private async handleHttpMessage(request: Request): Promise<Response> {
    const { text, currency } = (await request.json()) as { text: string; currency?: string };
    if (!text?.trim()) return Response.json({ reply: "" });
    const reply = await this.processMessage(text, currency);
    return Response.json({ reply });
  }

  // ── Core Gemini loop ───────────────────────────────────────────────────────

  private async getState(): Promise<AgentState> {
    return (await this.state.storage.get<AgentState>("s")) ?? { history: [], context: {} };
  }

  private async saveState(s: AgentState): Promise<void> {
    if (s.history.length > 20) s.history = s.history.slice(-20);
    await this.state.storage.put("s", s);
  }

  private async processMessage(userText: string, currency = "INR"): Promise<string> {
    const s = await this.getState();
    s.history.push({ role: "user", content: userText });

    let reply = "I'm having trouble right now. Please try again in a moment 🙏";

    try {
      reply = await this.callGemini(s.history.slice(-12));
    } catch (err) {
      console.error("[BookingAgent] Gemini error", err);
    }

    // Detect <search> intent → fetch live fares
    const searchMatch = reply.match(/<search>([\s\S]*?)<\/search>/);
    if (searchMatch) {
      try {
        const params = JSON.parse(searchMatch[1]) as {
          origin: string; destination: string; date: string; adults: number; currency: string;
        };
        s.context = { ...s.context, ...params, currency };
        reply = reply.replace(/<search>[\s\S]*?<\/search>/, "").trim();

        const fares = await this.fetchFlights(params, currency);
        if (fares) reply = reply ? `${reply}\n\n${fares}` : fares;
      } catch {
        reply = reply.replace(/<search>[\s\S]*?<\/search>/, "").trim();
      }
    }

    s.history.push({ role: "assistant", content: reply });
    await this.saveState(s);
    return reply;
  }

  private async callGemini(history: ConversationMessage[]): Promise<string> {
    if (!this.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

    const contents = history.map((m) => ({
      role:  m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const res = await fetch(`${GEMINI_URL}?key=${this.env.GEMINI_API_KEY}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        generationConfig: { maxOutputTokens: 350, temperature: 0.7 },
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) throw new Error(`Gemini ${res.status}`);

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "I'm not sure. Could you rephrase?";
  }

  private async fetchFlights(
    params: { origin: string; destination: string; date: string; adults: number },
    currency: string,
  ): Promise<string | null> {
    try {
      const url = new URL("https://api.flypoomas.com/api/search");
      url.searchParams.set("origin",        params.origin);
      url.searchParams.set("destination",   params.destination);
      url.searchParams.set("departureDate", params.date);
      url.searchParams.set("adults",        String(params.adults || 1));
      url.searchParams.set("cabinClass",    "ECONOMY");
      url.searchParams.set("currency",      currency);
      url.searchParams.set("tripType",      "ONEWAY");

      const res = await fetch(url.toString(), {
        headers: { "x-tenant-slug": "poomas" },
        signal:  AbortSignal.timeout(8000),
      });

      if (!res.ok) return null;

      const data = (await res.json()) as {
        offers?: Array<{
          airline?: string; flightNumber?: string;
          departureTime?: string; arrivalTime?: string;
          totalAmount?: number; currency?: string;
        }>;
      };

      const offers = data.offers?.slice(0, 3);
      if (!offers?.length) {
        return `No flights found for ${params.origin} → ${params.destination} on ${params.date}. Try nearby dates?`;
      }

      const lines = offers.map(
        (o, i) =>
          `${i + 1}. ${o.airline ?? ""} ${o.flightNumber ?? ""} | ${o.departureTime ?? ""} → ${o.arrivalTime ?? ""} | *${o.currency ?? currency} ${o.totalAmount ?? ""}*`,
      );

      return `Here are the top fares I found ✈️\n\n${lines.join("\n")}\n\nReply with 1, 2 or 3 to proceed with booking.`;
    } catch {
      return "I couldn't fetch live fares right now. Please try again in a moment.";
    }
  }
}
