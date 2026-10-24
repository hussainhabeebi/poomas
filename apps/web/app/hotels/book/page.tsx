'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { API, apiCall, readCustomerToken, inr } from '../../lib/customer-api';
import { hotelGuestSlots, parseHotelRooms } from '../lib/occupancy';
import styles from './hotel-checkout.module.css';

type Guest = { title: string; type: 'ADULT' | 'CHILD'; firstName: string; lastName: string; pan?: string; passport?: string };
const terminal = ['SUCCESS', 'ON_HOLD', 'ABORTED', 'FAILED', 'CANCELLED'];
function OptionDetails({ option: o }: { option: any }) {
  return <><h3>{o.roomInfo.map((r: any) => r.name).join(' + ') || 'Supplier room option'}</h3>
    <p>{o.mealBasis || 'Meal plan not supplied'}</p><strong>{inr(o.pricing.totalPrice, o.pricing.currency)} total for all rooms</strong>
    <p>{[['basePrice','Base'],['taxes','Taxes'],['mf','Management fee'],['mft','Fee tax']].filter(([key]) => o.pricingFields?.includes(key)).map(([key,label]) => `${label}: ${inr(o.pricing[key], o.pricing.currency)}`).join(' · ')}</p>
    <p>{o.cancellation.isRefundable ? 'Refundable subject to the supplier cancellation terms below.' : 'Check the supplier cancellation terms below before booking.'}</p>
    {o.cancellation.penalties.length ? <ul>{o.cancellation.penalties.map((p: any, i: number) => <li key={i}>{p.from} to {p.to}: {inr(p.amount, o.pricing.currency)}</li>)}</ul> : <p>Cancellation terms were not supplied. Contact the team before proceeding.</p>}
    <small>Supplier cancellation times are in India Standard Time (UTC+05:30).</small>
    {o.bookingNotes && <p>{o.bookingNotes}</p>}
  </>;
}
function Journey() {
  useSearchParams();
  const [selection, setSelection] = useState<any>(null), [detail, setDetail] = useState<any>(null), [quote, setQuote] = useState<any>(null);
  const [rooms, setRooms] = useState<{ guests: Guest[] }[]>([]), [attempt, setAttempt] = useState<any>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [accepted, setAccepted] = useState(false);
  const [signedIn, setSignedIn] = useState(false); const submitting = useRef(false);
  function setUrl(key: string, value: string) { const url = new URL(window.location.href); url.searchParams.set(key, value); window.history.replaceState(null, '', url); }
  useEffect(() => {
    let active = true;
    async function load() {
      setError(''); setSignedIn(Boolean(readCustomerToken()));
      try {
        const p = new URLSearchParams(window.location.search);
        if (p.get('attempt')) { const a = await apiCall(`/api/profile/hotels/bookings/${encodeURIComponent(p.get('attempt')!)}`); if (active) setAttempt(a); return; }
        if (p.get('submission') && readCustomerToken()) {
          try { const a: any = await apiCall(`/api/profile/hotels/submissions/${encodeURIComponent(p.get('submission')!)}`); if (active) { setAttempt(a); setUrl('attempt', a.id); } return; }
          catch (e: any) { if (e.status !== 404) throw e; }
        }
        const context = { hid: p.get('hid'), correlationId: p.get('sid'), checkIn: p.get('checkIn'), checkOut: p.get('checkOut'),
          currency: p.get('currency') ?? 'INR', nationality: p.get('nat') ?? 'IN', rooms: parseHotelRooms(p.get('occupancy'), p.get('rooms') ?? '1', p.get('adults') ?? '1') };
        if (!context.hid || !context.correlationId) throw new Error('Search for a hotel and select a property first.');
        if (active) setSelection(context);
        if (p.get('quote') && readCustomerToken()) {
          const q: any = await apiCall(`/api/profile/hotels/quotes/${encodeURIComponent(p.get('quote')!)}`);
          if (active) { setQuote(q); setSelection(q.selection); initGuests(q.selection.rooms); } return;
        }
        const response = await fetch(`${API}/api/hotels/detail`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-tenant-slug': 'poomas' }, body: JSON.stringify(context) });
        const d = await response.json(); if (!response.ok) throw new Error(d.error || 'Rooms could not be loaded.');
        if (active) setDetail(d);
      } catch (e: any) { if (active) setError(e.message || 'Please search again.'); }
      finally { if (active) setLoading(false); }
    }
    void load(); return () => { active = false; };
  }, []);
  function initGuests(occupancy: any) { setRooms(hotelGuestSlots(occupancy).map(slots => ({ guests: slots.map(type => ({ type, title: type === 'CHILD' ? 'Master' : 'Mr', firstName: '', lastName: '' })) }))); }
  useEffect(() => {
    if (!attempt?.id || terminal.includes(attempt.status) || attempt.manualRecoveryRequired) return;
    let active = true;
    const timer = setTimeout(async () => {
      try { const a = await apiCall(`/api/profile/hotels/bookings/${encodeURIComponent(attempt.id)}`); if (active) setAttempt(a); }
      catch (e: any) { if (active) setError(`${e.message} Your attempt is saved; reload to check it. Do not make another booking.`); }
    }, Math.max(5000, Math.min(86400_000, Date.parse(attempt.nextCheckAt ?? "") - Date.now() || 5000)));
    return () => { active = false; clearTimeout(timer); };
  }, [attempt]);
  async function review(option: any) {
    if (!signedIn) { window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`; return; }
    setBusy(true); setError('');
    try {
      const q: any = await apiCall('/api/profile/hotels/review', { method: 'POST', body: JSON.stringify({ ...selection, optionId: option.optionId }) });
      setQuote(q); setAccepted(false); if (!rooms.length) initGuests(selection.rooms); setUrl('quote', q.quoteId);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  async function book(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (submitting.current || !accepted || !quote?.bookingEnabled) return;
    submitting.current = true; setBusy(true); setError('');
    const data = new FormData(e.currentTarget), p = new URLSearchParams(window.location.search);
    const key = p.get('submission') || crypto.randomUUID(); setUrl('submission', key);
    try {
      const a: any = await apiCall('/api/profile/hotels/book', { method: 'POST', body: JSON.stringify({ quoteId: quote.quoteId, acceptedQuote: true, idempotencyKey: key, rooms,
        contactEmail: data.get('email'), contactPhone: data.get('phone'), dialCode: data.get('dialCode') }) });
      setAttempt(a); setUrl('attempt', a.id);
    } catch (e: any) {
      setError(`${e.message} If submission may have reached the supplier, check My Trips or reload this page before trying again.`);
    } finally { setBusy(false); submitting.current = false; }
  }
  function guestValue(i: number, j: number, key: keyof Guest, value: string) {
    setRooms(old => old.map((r, ri) => ri === i ? { guests: r.guests.map((g, gi) => gi === j ? { ...g, [key]: value } : g) } : r));
  }
  return <main className={styles.page}><a href="/hotels">← Hotel search</a> · <a href="/trips">My Trips</a>
    <h1>{attempt ? 'Hotel booking status' : quote ? 'Guest details and price review' : 'Choose your rooms'}</h1>
    {loading && <p role="status">Loading hotel details…</p>}{error && <p className={styles.error} role="alert">{error}</p>}
    {attempt ? <section className={styles.panel} aria-live="polite"><h2>{attempt.status === 'SUCCESS' ? 'Booking confirmed' : attempt.status === 'ON_HOLD' ? 'On hold — not confirmed' : `Booking status: ${attempt.status}`}</h2>
      <p>Reference: {attempt.id}</p>{attempt.details?.confirmationNo && attempt.status === 'SUCCESS' && <p>Confirmation: {attempt.details.confirmationNo}</p>}
      {attempt.pending && <p>Confirmation has not been received. Your attempt is saved. Do not submit another booking.</p>}
      {attempt.manualRecoveryRequired && <p>Automatic checks have stopped. Contact the team to reconcile this booking; do not book again.</p>}
      <button onClick={() => window.location.reload()}>Check saved booking</button>
    </section> : quote ? <><section className={styles.panel}><h2>{quote.hotelName || 'Selected hotel'}</h2><OptionDetails option={quote.option} />
      <p>Quotation expires: {new Date(quote.expiresAt).toLocaleTimeString()}</p>{quote.priceChanged && <p role="status">The supplier price changed during review. Confirm the displayed total before continuing.</p>}
      <button disabled={busy} onClick={() => review(quote.option)}>Refresh quotation</button>{' '}<button onClick={() => { setQuote(null); const url = new URL(window.location.href); url.searchParams.delete('quote'); url.searchParams.delete('submission'); window.location.href = url.toString(); }}>Choose rooms or review again</button>
    </section><form className={styles.panel} onSubmit={book}>
      {rooms.map((r, i) => <fieldset key={i}><legend>Room {i + 1} — {selection?.rooms[i]?.adults} adults, {selection?.rooms[i]?.children ?? 0} children</legend>{r.guests.map((g, j) => <div className={styles.guest} key={j}><h3>{g.type === 'CHILD' ? 'Child' : 'Adult'} {j + 1}</h3>
        <label>Title<select value={g.title} onChange={e => guestValue(i,j,'title',e.target.value)}>{['Mr','Mrs','Ms','Miss','Master'].map(t => <option key={t}>{t}</option>)}</select></label>
        <label>First name<input required maxLength={80} autoComplete="given-name" value={g.firstName} onChange={e => guestValue(i,j,'firstName',e.target.value)} /></label>
        <label>Last name<input required maxLength={80} autoComplete="family-name" value={g.lastName} onChange={e => guestValue(i,j,'lastName',e.target.value)} /></label>
        {quote.option.compliance.panRequired && <label>PAN<input required={j === 0} pattern="[A-Za-z]{5}[0-9]{4}[A-Za-z]" value={g.pan ?? ''} onChange={e => guestValue(i,j,'pan',e.target.value)} /></label>}
        {quote.option.compliance.passportRequired && <label>Passport number<input required minLength={5} maxLength={30} value={g.passport ?? ''} onChange={e => guestValue(i,j,'passport',e.target.value)} /></label>}
      </div>)}</fieldset>)}
      <div className={styles.guest}><label>Email<input name="email" type="email" required autoComplete="email" /></label><label>Dial code<input name="dialCode" defaultValue="+91" pattern="[+]?[0-9]{1,4}" required /></label><label>Phone<input name="phone" type="tel" required pattern="[+]?[0-9 ()-]{6,22}" autoComplete="tel-national" /></label></div>
      <label><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} /> I accept this room combination, meal plan, total price and supplier cancellation terms.</label>
      {!quote.bookingEnabled && <p>Hotel booking and payment mode await approval. No booking or payment will be created.</p>}
      <button type="submit" disabled={!accepted || busy || !quote.bookingEnabled}>{busy ? 'Checking booking…' : 'Submit authorized UAT booking'}</button>
    </form></> : detail && <><h2>{detail.hotelName}</h2>{detail.hotel?.images?.length > 0 && <div className={styles.gallery}>{detail.hotel.images.map((src: string) => <img key={src} src={src} alt={detail.hotelName} loading="lazy" />)}</div>}
      {detail.hotel?.address && <p>{detail.hotel.address}</p>}{detail.hotel?.amenities?.length > 0 && <p>{detail.hotel.amenities.join(' · ')}</p>}<p>Select one complete rate combination covering all {selection.rooms.length} room(s). Availability is rechecked during review.</p>
      {!detail.options?.length && <p>No rooms available for this search. Change your dates or destination.</p>}
      {detail.options?.map((o: any) => <section className={styles.panel} key={o.optionId}><OptionDetails option={o} /><button disabled={busy} onClick={() => review(o)}>{busy ? 'Reviewing…' : signedIn ? 'Select and review' : 'Sign in to review'}</button></section>)}
    </>}
  </main>;
}
export default function HotelBookPage() { return <Suspense fallback={<p role="status">Loading hotel…</p>}><Journey /></Suspense>; }
