export function fmtDuration(sec: number) {
  if (!sec) return '—';
  const m = Math.round(sec / 60);
  if (m < 60) return `${Math.max(1, m)} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
export function fmtTimer(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
}
export function fmtDay(d: string | Date | null, tz?: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', ...(tz ? { timeZone: tz } : {}) });
}
export function fmtDeadline(date: string | null, text: string) {
  if (!date) return text || 'Not specified';
  const d = new Date(String(date).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return text && text !== 'Not specified' && !/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${d} (${text})` : d;
}
export function clock(start: string | null, offsetMs: number, tz: string) {
  if (!start) return fmtTimer(offsetMs);
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(new Date(start).getTime() + offsetMs));
  } catch {
    return fmtTimer(offsetMs);
  }
}
export const STATUS_BADGE: Record<string, string> = {
  COMPLETED: 'ok', RECORDING: 'err', PAUSED: 'warn', PROCESSING: '', FAILED: 'err', NOT_STARTED: 'gray',
  pending: 'warn', in_progress: '', completed: 'ok', cancelled: 'gray',
};
export function statusLabel(s: string) {
  return s.replace('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}
