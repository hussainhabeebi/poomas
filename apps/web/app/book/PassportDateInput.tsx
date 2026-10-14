"use client";

import { useEffect, useId, useRef, useState } from "react";
import { isPassportDate, normalizePassportDateEntry } from "../../../../packages/types/src/passport-dates";

export function PassportDateInput({ label, value, onChange, problem, required = false, min = "0001-01-01", max = "9999-12-31" }: {
  label: string; value: string; onChange: (value: string) => void;
  problem?: string; required?: boolean; min?: string; max?: string;
}) {
  const id = useId(), input = useRef<HTMLInputElement>(null), calendar = useRef<HTMLInputElement>(null);
  const [touched, setTouched] = useState(false);
  const [nativeFallback, setNativeFallback] = useState(false);
  const [calendarProblem, setCalendarProblem] = useState("");
  const normalized = normalizePassportDateEntry(value);
  const visibleProblem = touched ? problem || calendarProblem : undefined;
  useEffect(() => { input.current?.setCustomValidity(problem || calendarProblem || ""); }, [problem, calendarProblem, value]);

  function chooseDate() {
    const picker = calendar.current;
    if (!picker) return;
    // showPicker must run directly in the user's click gesture. The native
    // input below remains available on browsers that do not support this API.
    if (typeof picker.showPicker === "function") {
      try { picker.showPicker(); return; } catch { /* Use the native input. */ }
    }
    setNativeFallback(true);
  }

  return <label htmlFor={id}>
    {label}
    <span style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
      <input ref={input} id={id} type="text" inputMode="numeric" placeholder="YYYY-MM-DD"
        value={value} required={required} maxLength={10} autoComplete="off"
        style={{ flex: 1, minWidth: 0, width: "100%" }}
        aria-invalid={!!visibleProblem} aria-describedby={`${id}-hint${visibleProblem ? ` ${id}-error` : ""}`}
        onChange={(e) => { setCalendarProblem(""); onChange(e.target.value); }}
        onBlur={() => { setTouched(true); onChange(normalized); }}
        onInvalid={() => { setTouched(true); }}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData("text").trim();
          if (pasted.length > 10) { e.preventDefault(); setTouched(true); onChange(pasted); }
        }} />
      <button type="button" onClick={chooseDate} aria-label={`Choose ${label.toLowerCase()} from calendar`}
        style={{ minWidth: 44, height: 50, border: "1px solid #d0d5dd", borderRadius: 12, background: "#fff", fontSize: 20, cursor: "pointer" }}>▦</button>
    </span>
    <span id={`${id}-hint`} style={{ fontSize: 11, fontWeight: 400, color: "#667085" }}>YYYY-MM-DD · You can also enter YYYYMMDD.</span>
    <input ref={calendar} type="date" min={min} max={max} value={isPassportDate(normalized) ? normalized : ""}
      aria-label={`${label} calendar`} aria-describedby={`${id}-hint`}
      tabIndex={nativeFallback ? 0 : -1} aria-hidden={!nativeFallback}
      style={nativeFallback ? { height: 36, fontSize: 14, minWidth: 0, width: "100%" }
        : { position: "absolute", width: 1, height: 1, padding: 0, opacity: 0, pointerEvents: "none" }}
      onChange={(e) => {
        setTouched(true);
        if (e.target.validity.badInput) { setCalendarProblem(`${label} must be a complete valid date with a four-digit year.`); return; }
        setCalendarProblem(""); onChange(e.target.value);
      }} />
    {visibleProblem && <span id={`${id}-error`} role="alert" style={{ color: "#b42318", fontSize: 12, fontWeight: 400 }}>{visibleProblem}</span>}
  </label>;
}
