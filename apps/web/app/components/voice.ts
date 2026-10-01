// Voice input for the AI trip search.
//  1. Browser speech recognition (Chrome, Edge, Safari, Android, iOS) — free, on the device.
//  2. Otherwise record a short clip, convert it to 16 kHz mono WAV and send it to
//     /api/ai/transcribe (Cloudflare Workers AI Whisper).

export const VOICE_LANGS = [
  { code: "en-IN", label: "English" },
  { code: "ml-IN", label: "മലയാളം" },
  { code: "hi-IN", label: "हिन्दी" },
  { code: "ar-AE", label: "العربية" },
] as const;

export function defaultVoiceLang(): string {
  try {
    const saved = localStorage.getItem("voice_lang");
    if (saved && VOICE_LANGS.some((l) => l.code === saved)) return saved;
  } catch {}
  const nav = typeof navigator === "undefined" ? "en" : navigator.language.toLowerCase();
  if (nav.startsWith("ml")) return "ml-IN";
  if (nav.startsWith("hi")) return "hi-IN";
  if (nav.startsWith("ar")) return "ar-AE";
  return "en-IN";
}

// Minimal typing for the Web Speech API (not in TypeScript's DOM lib).
export interface Recognition {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

export function speechRecognition(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function canRecord() {
  return typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

// Starts recording; resolves the returned stop() into a 16 kHz mono WAV blob.
export async function startRecording(maxMs = 15_000): Promise<{ stop: () => Promise<Blob>; done: Promise<Blob> }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      try { resolve(await toWav16k(new Blob(chunks, { type: recorder.mimeType }))); } catch (err) { reject(err); }
    };
  });
  recorder.start();
  const timer = window.setTimeout(() => { if (recorder.state !== "inactive") recorder.stop(); }, maxMs);
  return {
    done,
    stop: () => { window.clearTimeout(timer); if (recorder.state !== "inactive") recorder.stop(); return done; },
  };
}

async function toWav16k(blob: Blob): Promise<Blob> {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  void ctx.close();
  const rate = 16_000;
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const pcm = (await offline.startRendering()).getChannelData(0);

  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + pcm.length * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}
