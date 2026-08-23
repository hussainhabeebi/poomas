"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName]       = useState("");
  const [email, setEmail]     = useState("");
  const [pass, setPass]       = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (pass !== confirm) { setError("Passwords do not match"); return; }
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/register`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name, email, password: pass }),
      });

      if (res.ok) {
        router.push("/login?registered=1");
      } else {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(data.error ?? "Registration failed. Please try again.");
      }
    } catch {
      setError("Could not connect to server. Please try again.");
    }

    setLoading(false);
  }

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#f9fafb",
    }}>
      <div style={{
        background: "white", borderRadius: 12, padding: "40px 48px",
        boxShadow: "0 4px 24px rgba(0,0,0,0.08)", width: "100%", maxWidth: 420,
      }}>
        <h1 style={{ textAlign: "center", marginBottom: 32, fontSize: 24, fontWeight: 700 }}>
          Agent Registration
        </h1>

        {error && (
          <div style={{
            background: "#FEE2E2", color: "#991B1B", padding: "10px 14px",
            borderRadius: 6, marginBottom: 20, fontSize: 14,
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleRegister} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <input
            type="text" placeholder="Full name" value={name}
            onChange={(e) => setName(e.target.value)} required
            style={inputStyle}
          />
          <input
            type="email" placeholder="Email address" value={email}
            onChange={(e) => setEmail(e.target.value)} required
            style={inputStyle}
          />
          <input
            type="password" placeholder="Password" value={pass}
            onChange={(e) => setPass(e.target.value)} required
            style={inputStyle}
          />
          <input
            type="password" placeholder="Confirm password" value={confirm}
            onChange={(e) => setConfirm(e.target.value)} required
            style={inputStyle}
          />
          <button
            type="submit" disabled={loading}
            style={{
              background: "var(--color-primary, #E31E24)", color: "white",
              border: "none", borderRadius: 8, padding: "13px",
              fontWeight: 700, fontSize: 15, cursor: "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Creating account…" : "Create Account"}
          </button>
        </form>

        <p style={{ textAlign: "center", marginTop: 24, fontSize: 14, color: "#6b7280" }}>
          Already have an account?{" "}
          <a href="/login" style={{ color: "var(--color-primary, #E31E24)", fontWeight: 500 }}>
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "12px 14px", border: "1.5px solid #e5e7eb",
  borderRadius: 8, fontSize: 15, width: "100%", boxSizing: "border-box",
};
