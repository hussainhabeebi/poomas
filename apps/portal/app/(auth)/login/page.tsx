"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail]   = useState("");
  const [pass, setPass]     = useState("");
  const [error, setError]   = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/login`, {
      method:      "POST",
      credentials: "include",
      headers:     { "Content-Type": "application/json" },
      body:        JSON.stringify({ email, password: pass }),
    });

    if (res.ok) {
      const { token } = await res.json() as { token: string };
      document.cookie = `poomas_token=${token}; Path=/; SameSite=Lax; Secure`;
      router.push("/dashboard");
    } else {
      const { error } = await res.json() as { error: string };
      setError(error ?? "Login failed");
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
          Agent Portal Login
        </h1>

        {error && (
          <div style={{
            background: "#FEE2E2", color: "#991B1B", padding: "10px 14px",
            borderRadius: 6, marginBottom: 20, fontSize: 14,
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
          <button
            type="submit" disabled={loading}
            style={{
              background: "var(--color-primary, #E31E24)", color: "white",
              border: "none", borderRadius: 8, padding: "13px",
              fontWeight: 700, fontSize: 15, cursor: "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <p style={{ textAlign: "center", marginTop: 24, fontSize: 14, color: "#6b7280" }}>
          New agent?{" "}
          <a href="/register" style={{ color: "var(--color-primary, #E31E24)", fontWeight: 500 }}>
            Register here
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
