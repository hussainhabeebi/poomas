"use client";
import { useEffect, useState, type FormEvent } from "react";
import styles from "./wallet.module.css";

// Recharge the wallet by bank transfer: pay into a company account, upload the
// screenshot, and staff credit the wallet once they've checked the payment.

interface Bank { id: string; label: string; bankName: string; accountName: string; accountNumber: string; iban: string; swift: string; ifsc: string; branch: string; currency: string; instructions: string }
interface Deposit { id: string; amount: number; currency: string; creditAmount: number | null; reference: string | null; status: string; adminNote: string | null; createdAt: string; bankAccount: { label: string } | null }

const STATUS_LABEL: Record<string, string> = { PENDING: "Waiting for approval", APPROVED: "Credited", REJECTED: "Not approved" };
const fmt = (n: number, cur: string) => {
  try { return new Intl.NumberFormat("en-IN", { style: "currency", currency: cur, maximumFractionDigits: 2 }).format(n); } catch { return `${cur} ${n.toFixed(2)}`; }
};

export default function BankRecharge({ api, token, onChange }: { api: string; token: string; onChange: () => void }) {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [bankId, setBankId] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const headers = { "x-tenant-slug": "poomas", Authorization: `Bearer ${token}` };

  async function load() {
    const [b, d] = await Promise.all([
      fetch(`${api}/api/profile/wallet/bank-accounts`, { headers }).then((r) => r.json()).catch(() => ({})),
      fetch(`${api}/api/profile/wallet/deposits`, { headers }).then((r) => r.json()).catch(() => ({})),
    ]);
    const list: Bank[] = (b as any).accounts ?? [];
    setBanks(list);
    setBankId((cur) => cur || list[0]?.id || "");
    setDeposits((d as any).deposits ?? []);
  }
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const bank = banks.find((b) => b.id === bankId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(""); setNotice("");
    if (!bank) { setError("Choose the bank account you paid into."); return; }
    if (!(Number(amount) > 0)) { setError("Enter the amount you paid."); return; }
    if (!file) { setError("Attach the payment screenshot or receipt."); return; }
    const form = new FormData();
    form.append("amount", amount);
    form.append("bankAccountId", bank.id);
    form.append("reference", reference);
    form.append("paidOn", paidOn);
    form.append("receipt", file);
    setBusy(true);
    try {
      const res = await fetch(`${api}/api/profile/wallet/deposits`, { method: "POST", headers, body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any).error ?? `Something went wrong (${res.status})`);
      setNotice((data as any).message ?? "Recharge submitted.");
      setAmount(""); setReference(""); setFile(null); setFileKey((k) => k + 1);
      await load();
      onChange();
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  function copy(text: string) { navigator.clipboard?.writeText(text).catch(() => {}); }

  if (!banks.length && !deposits.length) return null;

  return (
    <section className={styles.panel} id="recharge">
      <div className={styles.panelHeading}>
        <h2>Recharge by bank transfer</h2>
        <p>Transfer to the account below, then upload the payment screenshot. Your wallet is credited once our team checks the payment (amounts paid in AED are credited in INR at the day&apos;s rate).</p>
      </div>

      {banks.length > 0 && (
        <>
          <div className={styles.bankGrid} role="radiogroup" aria-label="Bank account you paid into">
            {banks.map((b) => (
              <div key={b.id} className={styles.bankCard} role="radio" aria-checked={b.id === bankId} tabIndex={0} onClick={() => setBankId(b.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setBankId(b.id); } }}>
                <strong>{b.label}</strong>
                <span className={styles.bankRow}>Account name <b>{b.accountName}</b></span>
                <span className={styles.bankRow}>Bank <b>{b.bankName}</b></span>
                <span className={styles.bankRow}>Account no. <b>{b.accountNumber}<button type="button" className={styles.copyButton} onClick={(e) => { e.stopPropagation(); copy(b.accountNumber); }}>Copy</button></b></span>
                {b.iban && <span className={styles.bankRow}>IBAN <b>{b.iban}<button type="button" className={styles.copyButton} onClick={(e) => { e.stopPropagation(); copy(b.iban); }}>Copy</button></b></span>}
                {b.swift && <span className={styles.bankRow}>SWIFT <b>{b.swift}</b></span>}
                {b.ifsc && <span className={styles.bankRow}>IFSC <b>{b.ifsc}</b></span>}
                <span className={styles.bankRow}>Currency <b>{b.currency}</b></span>
              </div>
            ))}
          </div>
          <form className={styles.rechargeForm} onSubmit={submit}>
            <label>Amount paid{bank ? ` (${bank.currency})` : ""}
              <input type="number" min="1" step="0.01" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label>Transfer reference (optional)
              <input maxLength={80} placeholder="Bank reference / UTR" value={reference} onChange={(e) => setReference(e.target.value)} />
            </label>
            <label>Paid on
              <input type="date" value={paidOn} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setPaidOn(e.target.value)} />
            </label>
            <label className={styles.full}>Payment screenshot or receipt (image or PDF, up to 8 MB)
              <input key={fileKey} type="file" accept="image/*,application/pdf" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            {error && <div className={`${styles.message} ${styles.error} ${styles.full}`} role="alert">{error}</div>}
            {notice && <div className={`${styles.message} ${styles.notice} ${styles.full}`} role="status">{notice}</div>}
            <div className={styles.full}><button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? "Uploading…" : "Submit for approval"}</button></div>
          </form>
        </>
      )}

      {deposits.length > 0 && (
        <div className={styles.list}>
          {deposits.map((d) => (
            <div key={d.id} className={styles.codeRow}>
              <div className={styles.codeDetails}>
                <strong>{fmt(d.amount, d.currency)}{d.status === "APPROVED" && d.creditAmount !== null ? ` → ${fmt(d.creditAmount, "INR")} credited` : ""}</strong>
                <span>{new Date(d.createdAt).toLocaleString("en-IN")}{d.bankAccount ? ` · ${d.bankAccount.label}` : ""}{d.reference ? ` · ref ${d.reference}` : ""}{d.status === "REJECTED" && d.adminNote ? ` · ${d.adminNote}` : ""}</span>
              </div>
              <span className={styles.statusPill} data-status={d.status}>{STATUS_LABEL[d.status] ?? d.status}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
