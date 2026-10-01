"use client";

// "Describe your trip" box above the regular flight search form. Sends the
// traveller's own words (English, Malayalam, Hindi, Arabic…) to
// /api/ai/trip-search and fills the form with the answer. The regular form
// stays fully usable; nothing is searched until the traveller presses Search.

import { FormEvent, useEffect, useRef, useState } from "react";
import { canRecord, defaultVoiceLang, speechRecognition, startRecording, VOICE_LANGS, type Recognition } from "./voice";

export type AiTripFields = {
  origin: { code: string; city: string } | null;
  destination: { code: string; city: string } | null;
  departureDate: string | null;
  returnDate: string | null;
  tripType: "ONEWAY" | "ROUNDTRIP";
  adults: number; children: number; infants: number;
  cabinClass: "ECONOMY" | "PREMIUM_ECONOMY" | "BUSINESS" | "FIRST";
  fareType: "REGULAR" | "STUDENT" | "SENIOR_CITIZEN";
  directOnly: boolean; refundableOnly: boolean; withBaggage: boolean;
  sort: "best" | "price" | "duration" | "departure";
  currency: "INR" | "AED" | "USD" | null;
  language: string; summary: string;
  missing: ("origin" | "destination" | "departureDate" | "returnDate")[];
};

const EXAMPLES = [
  "Kochi to Dubai next Friday, 2 adults and a baby, back after a week, cheapest with baggage",
  "കോഴിക്കോട് നിന്ന് ദോഹയിലേക്ക് ഡിസംബർ 20, 2 പേർ",
  "दिल्ली से मुंबई कल सुबह, सबसे सस्ती फ्लाइट",
  "من دبي إلى كوتشي يوم الخميس القادم، شخصان",
];

const MISSING_LABEL: Record<string, string> = {
  origin: "where you’re flying from", destination: "where you’re going",
  departureDate: "your travel date", returnDate: "your return date",
};

export function AiTripSearch({ onApply, onSearchNow }: { onApply: (f: AiTripFields) => void; onSearchNow: () => void }) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "https://api.flypoomas.com";
  const [enabled, setEnabled] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AiTripFields | null>(null);
  const [example, setExample] = useState(0);
  // Voice: "device" = browser speech recognition (free), "server" = record + Whisper.
  const [voiceMode, setVoiceMode] = useState<"device" | "server" | null>(null);
  const [voiceLang, setVoiceLang] = useState("en-IN");
  const [voice, setVoice] = useState<"idle" | "listening" | "transcribing">("idle");
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    fetch(`${apiUrl}/api/ai/status`, { headers: { "x-tenant-slug": "poomas" } })
      .then((r) => r.json())
      .then((d) => {
        setEnabled(Boolean(d?.tripSearch));
        if (d?.tripSearch) setVoiceMode(speechRecognition() ? "device" : d?.voiceTranscribe && canRecord() ? "server" : null);
      })
      .catch(() => setEnabled(false));
    setVoiceLang(defaultVoiceLang());
  }, [apiUrl]);

  useEffect(() => () => stopRef.current?.(), []);

  // Rotate the placeholder through the four languages.
  useEffect(() => {
    if (text) return;
    const t = window.setInterval(() => setExample((i) => (i + 1) % EXAMPLES.length), 4000);
    return () => window.clearInterval(t);
  }, [text]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    await run(text);
  }

  async function run(query: string) {
    if (query.trim().length < 3 || busy) return;
    setBusy(true); setError(""); setResult(null);
    try {
      const timeZone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } })();
      const res = await fetch(`${apiUrl}/api/ai/trip-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-tenant-slug": "poomas" },
        body: JSON.stringify({ text: query.trim(), ...(timeZone ? { timeZone } : {}) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.fields) { setError(typeof d.error === "string" ? d.error : "We couldn't read that. Please use the search form below."); return; }
      setResult(d.fields);
      onApply(d.fields);
    } catch {
      setError("We couldn't reach the server. Please use the search form below.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleVoice() {
    if (voice !== "idle") { stopRef.current?.(); return; }
    setError(""); setResult(null);
    const SR = voiceMode === "device" ? speechRecognition() : null;
    if (SR) {
      const rec: Recognition = new SR();
      rec.lang = voiceLang; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
      let finalText = "";
      rec.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
        }
        setText((finalText + interim).trim());
      };
      rec.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") setError("Allow microphone access to search by voice.");
        else if (e.error === "no-speech") setError("We didn't hear anything — tap the mic and speak.");
        else if (e.error !== "aborted") setError("Voice search didn't work — please type your trip.");
      };
      rec.onend = () => {
        stopRef.current = null; setVoice("idle");
        if (finalText.trim().length >= 3) void run(finalText);
      };
      stopRef.current = () => rec.stop();
      setVoice("listening");
      try { rec.start(); } catch { setVoice("idle"); stopRef.current = null; }
      return;
    }
    // No speech recognition in this browser: record and transcribe on the server.
    try {
      const rec = await startRecording();
      stopRef.current = () => { void rec.stop(); };
      setVoice("listening");
      const wav = await rec.done;
      stopRef.current = null;
      setVoice("transcribing");
      const form = new FormData();
      form.append("audio", wav, "voice.wav");
      const res = await fetch(`${apiUrl}/api/ai/transcribe`, { method: "POST", headers: { "x-tenant-slug": "poomas" }, body: form });
      const d = await res.json().catch(() => ({}));
      setVoice("idle");
      if (!res.ok || typeof d.text !== "string") { setError(typeof d.error === "string" ? d.error : "Voice search didn't work — please type your trip."); return; }
      setText(d.text);
      void run(d.text);
    } catch (err) {
      stopRef.current = null; setVoice("idle");
      setError((err as Error)?.name === "NotAllowedError" ? "Allow microphone access to search by voice." : "Voice search didn't work — please type your trip.");
    }
  }

  if (!enabled) return null;
  const ready = result && result.missing.length === 0;

  return (
    <div className="ai-search">
      <form onSubmit={submit} className="ai-search-row">
        <span className="ai-search-icon" aria-hidden="true">✨</span>
        <input
          dir="auto"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={EXAMPLES[example]}
          aria-label="Describe your trip in your own words"
          maxLength={400}
          className="ai-search-input"
        />
        {voiceMode && (
          <button type="button" onClick={() => void toggleVoice()} disabled={busy || voice === "transcribing"}
            className={`ai-search-mic${voice === "listening" ? " is-listening" : ""}`}
            aria-label={voice === "listening" ? "Stop listening" : "Search by voice"} aria-pressed={voice === "listening"}>
            {voice === "transcribing" ? <i className="search-spinner" aria-hidden="true" /> : (
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            )}
          </button>
        )}
        <button type="submit" className="ai-search-btn" disabled={busy || text.trim().length < 3}>
          {busy ? <><i className="search-spinner" aria-hidden="true" /> Reading…</> : "Fill search"}
        </button>
      </form>
      <p className="ai-search-hint">
        {voice === "listening" ? <b className="ai-search-live">🎙 Listening… speak your trip, then pause</b>
          : voice === "transcribing" ? <b className="ai-search-live">Understanding what you said…</b>
          : <>Type{voiceMode ? " or say" : ""} your trip in English, മലയാളം, हिन्दी or العربية — we’ll fill in the form for you.</>}
        {voiceMode === "device" && voice === "idle" && (
          <select className="ai-search-lang" value={voiceLang} aria-label="Voice language"
            onChange={(e) => { setVoiceLang(e.target.value); try { localStorage.setItem("voice_lang", e.target.value); } catch {} }}>
            {VOICE_LANGS.map((l) => <option key={l.code} value={l.code}>🎙 {l.label}</option>)}
          </select>
        )}
      </p>
      {error && <p className="ai-search-error" role="alert">{error}</p>}
      {result && (
        <div className={ready ? "ai-search-result ai-search-ready" : "ai-search-result"} role="status">
          <div dir="auto">
            <b>{result.summary || "Search filled in"}</b>
            {result.missing.length > 0 && (
              <small>Please add {result.missing.map((m) => MISSING_LABEL[m]).join(" and ")} below.</small>
            )}
          </div>
          {ready && <button type="button" className="ai-search-go" onClick={onSearchNow}>Search now →</button>}
        </div>
      )}
    </div>
  );
}
