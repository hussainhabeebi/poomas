"use client";

import { useEffect, useId, useRef, useState } from "react";
import { displayPassengerDate, maskPassengerDate, passengerCalendarMonth, passengerDateFromDisplay, passportToday, pastedPassengerDate, shiftPassengerDate } from "../../../../packages/types/src/passport-dates";
import styles from "./PassengerDateInput.module.css";

const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const isoDay = (year: number, month: number, day: number) => `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

export function PassengerDateInput({ label, value, onChange, problem, required = false, min = "0001-01-01", max = "9999-12-31", historical = false }: {
  label: string; value: string; onChange: (value: string) => void; problem?: string;
  required?: boolean; min?: string; max?: string; historical?: boolean;
}) {
  const id = useId(), root = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null), toggle = useRef<HTMLButtonElement>(null);
  const emitted = useRef(value);
  const pendingFocus = useRef("");
  const [draft, setDraft] = useState(displayPassengerDate(value));
  const [touched, setTouched] = useState(false), [entryProblem, setEntryProblem] = useState("");
  const [open, setOpen] = useState(false);
  const today = passportToday(), currentYear = Number(today.slice(0, 4));
  const [view, setView] = useState(today.slice(0, 7));
  const [year, month] = view.split("-").map(Number);
  const selected = passengerDateFromDisplay(draft);
  const formatProblem = draft && !selected ? `${label} must be a real date in DD/MM/YYYY format with a four-digit year.` : "";
  const validation = entryProblem || formatProblem || problem?.replace("YYYY-MM-DD", "DD/MM/YYYY") || (required && !draft ? `${label} is required.` : "");
  const visibleProblem = touched || (draft.length >= 10 && !!formatProblem) ? validation : "";
  const earliestYear = Math.max(Number(min.slice(0, 4)), Math.min(currentYear - (historical ? 120 : 10), Number((selected || today).slice(0, 4))));
  const latestYear = Math.min(Number(max.slice(0, 4)), Math.max(currentYear + (historical ? 0 : 30), Number((selected || today).slice(0, 4))));
  const normalStart = Math.max(Number(min.slice(0, 4)), currentYear - (historical ? 120 : 10));
  const normalEnd = Math.min(Number(max.slice(0, 4)), currentYear + (historical ? 0 : 30));
  // Include an imported/manual historical year without rendering thousands of options.
  const years = [...new Set([...Array.from({ length: Math.max(0, normalEnd - normalStart + 1) }, (_, i) => normalStart + i), year, Number((selected || today).slice(0, 4))])]
    .filter(y => y >= earliestYear && y <= latestYear).sort((a, b) => b - a);
  const calendar = passengerCalendarMonth(year, month);

  useEffect(() => {
    if (value !== emitted.current) { emitted.current = value; setDraft(displayPassengerDate(value)); setEntryProblem(""); }
  }, [value]);
  useEffect(() => { input.current?.setCustomValidity(validation); }, [validation]);
  useEffect(() => {
    if (!open || !pendingFocus.current) return;
    root.current?.querySelector<HTMLButtonElement>(`[aria-label="${displayPassengerDate(pendingFocus.current)}"]`)?.focus();
    pendingFocus.current = "";
  }, [view, open]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); toggle.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    root.current?.querySelector<HTMLSelectElement>("select")?.focus();
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  function change(next: string) {
    setDraft(next); setEntryProblem("");
    const canonical = passengerDateFromDisplay(next) ?? next;
    emitted.current = canonical;
    onChange(canonical); // Incomplete/invalid drafts replace stale valid parent state.
  }
  function rejectEntry() { setTouched(true); setEntryProblem(`${label}: enter DD/MM/YYYY using a four-digit year.`); }
  function openCalendar() {
    const anchor = selected && selected >= min && selected <= max ? selected : today < min ? min : today > max ? max : today;
    setView(anchor.slice(0, 7)); setOpen(true);
  }
  function moveMonth(delta: number) {
    const index = year * 12 + month - 1 + delta;
    setView(`${String(Math.floor(index / 12)).padStart(4, "0")}-${String(index % 12 + 1).padStart(2, "0")}`);
  }
  const previousMonth = isoDay(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1, 1).slice(0, 7);
  const nextMonth = isoDay(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1).slice(0, 7);

  return <div ref={root} className={styles.field} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { setTouched(true); setOpen(false); } }}>
    <label htmlFor={id}>{label}</label>
    <div className={styles.control}>
      <input ref={input} id={id} type="text" inputMode="numeric" autoComplete="off" placeholder="DD/MM/YYYY"
        value={draft} required={required} maxLength={10} aria-invalid={!!visibleProblem}
        aria-describedby={`${id}-hint${visibleProblem ? ` ${id}-error` : ""}`}
        onInvalid={() => setTouched(true)}
        onKeyDown={(e) => {
          const target = e.currentTarget;
          const cursor = target.selectionStart ?? 0;
          if (target.selectionStart === target.selectionEnd && ((e.key === "Backspace" && draft[cursor - 1] === "/") || (e.key === "Delete" && draft[cursor] === "/"))) {
            e.preventDefault();
            const digit = e.key === "Backspace" ? cursor - 2 : cursor + 1;
            const next = maskPassengerDate(draft.slice(0, digit) + draft.slice(digit + 1));
            if (next !== undefined) change(next);
            requestAnimationFrame(() => input.current?.setSelectionRange(digit, digit));
          }
          if (/^\d$/.test(e.key) && !e.ctrlKey && !e.metaKey && draft.replace(/\D/g, "").length >= 8 && target.selectionStart === target.selectionEnd) {
            e.preventDefault(); rejectEntry();
          }
          if (e.key === "ArrowDown" && e.altKey) { e.preventDefault(); openCalendar(); }
        }}
        onChange={(e) => {
          const raw = e.target.value, cursor = e.target.selectionStart ?? raw.length;
          const next = maskPassengerDate(raw);
          if (next === undefined) { rejectEntry(); return; }
          const digitCount = raw.slice(0, cursor).replace(/\D/g, "").length;
          change(next);
          const position = digitCount + (digitCount > 2 ? 1 : 0) + (digitCount > 4 ? 1 : 0);
          requestAnimationFrame(() => input.current?.setSelectionRange(position, position));
        }}
        onPaste={(e) => {
          e.preventDefault();
          const raw = e.clipboardData.getData("text");
          const target = e.currentTarget;
          const replacingAll = target.selectionStart === 0 && target.selectionEnd === draft.length;
          const next = !draft || replacingAll ? pastedPassengerDate(raw)
            : maskPassengerDate(draft.slice(0, target.selectionStart ?? 0) + raw + draft.slice(target.selectionEnd ?? draft.length));
          if (next === undefined) { rejectEntry(); return; }
          change(next); setTouched(true);
        }} />
      <button ref={toggle} type="button" className={styles.toggle} aria-label={`Choose ${label.toLowerCase()} from calendar`}
        aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-calendar`}
        onClick={() => { if (open) setOpen(false); else openCalendar(); }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-12 4h3"/></svg>
      </button>
    </div>
    <span id={`${id}-hint`} className={styles.hint}>DD/MM/YYYY</span>
    <span id={`${id}-error`} className={styles.error} role={visibleProblem ? "alert" : undefined}>{visibleProblem || "\u00a0"}</span>
    {open && <div id={`${id}-calendar`} role="dialog" aria-label={`${label} calendar`} className={styles.calendar}>
      <div className={styles.navigation}>
        <button type="button" aria-label="Previous month" disabled={previousMonth < min.slice(0, 7) || year < earliestYear || (year === earliestYear && month === 1)} onClick={() => moveMonth(-1)}>‹</button>
        <select aria-label="Calendar month" value={month} onChange={(e) => setView(`${String(year).padStart(4, "0")}-${e.target.value.padStart(2, "0")}`)}>
          {months.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
        </select>
        <select aria-label="Calendar year" value={year} onChange={(e) => setView(`${e.target.value.padStart(4, "0")}-${String(month).padStart(2, "0")}`)}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <button type="button" aria-label="Next month" disabled={nextMonth > max.slice(0, 7) || year > latestYear || (year === latestYear && month === 12)} onClick={() => moveMonth(1)}>›</button>
      </div>
      <div className={styles.days}>
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => <span key={day} aria-hidden="true">{day}</span>)}
        {Array.from({ length: calendar.weekday }, (_, i) => <span key={`blank${i}`} />)}
        {Array.from({ length: calendar.days }, (_, i) => {
          const day = isoDay(year, month, i + 1);
          return <button key={day} type="button" disabled={day < min || day > max} aria-label={displayPassengerDate(day)}
            aria-pressed={day === selected} onClick={() => { change(displayPassengerDate(day)); setTouched(true); setOpen(false); toggle.current?.focus(); }}
            onKeyDown={(e) => {
              const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
              if (!offset) return;
              e.preventDefault();
              const target = shiftPassengerDate(day, offset);
              if (target < min || target > max || Number(target.slice(0, 4)) < earliestYear || Number(target.slice(0, 4)) > latestYear) return;
              if (target.slice(0, 7) !== view) { pendingFocus.current = target; setView(target.slice(0, 7)); }
              else root.current?.querySelector<HTMLButtonElement>(`[aria-label="${displayPassengerDate(target)}"]`)?.focus();
            }}>{i + 1}</button>;
        })}
      </div>
      <button type="button" className={styles.close} onClick={() => { setOpen(false); toggle.current?.focus(); }}>Close calendar</button>
    </div>}
  </div>;
}
