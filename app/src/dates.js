export const TIME_ZONE = process.env.APP_TIMEZONE || 'Asia/Ho_Chi_Minh';
export function companyDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export const validTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export function addDays(date, days) {
  const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
export function nextOccurrence(date, cadence, anchorDay = 0) {
  if (cadence === 'daily' || cadence === 'weekly') return addDays(date, cadence === 'daily' ? 1 : 7);
  const d = new Date(date + 'T12:00:00Z');
  const day = anchorDay || d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last)); return d.toISOString().slice(0, 10);
}
export function dueInstant(date, time = '') {
  if (!validDate(date)) return NaN;
  // Find the timezone offset at this date instead of depending on the server's TZ.
  const wall = Date.parse(date + 'T' + (time || '23:59') + ':00Z');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(wall)).map(p => [p.type, p.value]));
  const localAsUTC = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
  return wall - (localAsUTC - wall);
}
export const REMIND_MS = { '0d': 0, '5m': 300000, '15m': 900000, '1h': 3600000, '1d': 86400000, '2d': 172800000, '7d': 604800000 };
