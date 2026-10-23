'use client';
import { useEffect, useState } from 'react';
import { apiCall, inr, readCustomerToken } from '../lib/customer-api';
export function HotelTrips() {
  const [bookings, setBookings] = useState<any[]>([]), [error, setError] = useState('');
  useEffect(() => { if (!readCustomerToken()) return; let active = true;
    apiCall<{ bookings: any[] }>('/api/profile/hotels/bookings').then(d => { if (active) setBookings(d.bookings); })
      .catch(() => { if (active) setError('Hotel bookings could not be loaded. Please try again.'); });
    return () => { active = false; };
  }, []);
  if (!bookings.length && !error) return null;
  return <section aria-label="Hotel bookings" style={{ margin: '24px 0' }}><h2>Hotel bookings</h2>
    {error && <p role="alert">{error}</p>}
    {bookings.map(b => <article key={b.id} style={{ padding: 20, margin: '12px 0', border: '1px solid #ddd', borderRadius: 12 }}>
      <h3>{b.quotation.hotelName || 'Hotel stay'}</h3><p>{b.selection.checkIn} – {b.selection.checkOut} · {b.selection.rooms.length} room(s)</p>
      <p>{b.status} · {inr(b.quotation.option.pricing.totalPrice, b.quotation.option.pricing.currency)}</p>
      <a href={`/hotels/book?attempt=${encodeURIComponent(b.id)}`}>View hotel booking status</a>
    </article>)}
  </section>;
}
