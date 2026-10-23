export type HotelRoom = { adults: number; children: number; childAge: number[] };
export function parseHotelRooms(value: string | null | undefined, roomCount = '1', adults = '1'): HotelRoom[] {
  if (value && value.length > 6000) throw new Error('Room selection is too large.');
  if (!value && (!Number.isInteger(Number(roomCount)) || Number(roomCount) < 1 || Number(roomCount) > 9)) throw new Error('Select between one and nine rooms.');
  const raw = value ? JSON.parse(value) : Array.from({ length: Number(roomCount) }, () => ({ adults: Number(adults), children: 0, childAge: [] }));
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 9) throw new Error('Select between one and nine rooms.');
  return raw.map(r => {
    const ages = r.childAge ?? [];
    if (!Number.isInteger(r.adults) || r.adults < 1 || r.adults > 6 || !Number.isInteger(r.children) || r.children < 0 || r.children > 4
      || !Array.isArray(ages) || ages.length !== r.children || ages.some(a => !Number.isInteger(a) || a < 0 || a > 17)) throw new Error('Each room needs 1–6 adults and an age (0–17) for each child.');
    return { adults: r.adults, children: r.children, childAge: ages };
  });
}
export function hotelGuestSlots(rooms: HotelRoom[]) {
  return rooms.map(r => [...Array.from({ length: r.adults }, () => 'ADULT' as const), ...Array.from({ length: r.children }, () => 'CHILD' as const)]);
}
