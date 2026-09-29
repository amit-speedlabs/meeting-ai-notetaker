'use client';
// Holds a microphone stream granted on the "new meeting" page so the record page can start
// immediately after client-side navigation (no second permission prompt).
let pending: { meetingId: string; stream: MediaStream } | null = null;
export function setPendingStream(meetingId: string, stream: MediaStream) {
  pending = { meetingId, stream };
}
export function takePendingStream(meetingId: string): MediaStream | null {
  if (pending && pending.meetingId === meetingId) {
    const s = pending.stream;
    pending = null;
    return s;
  }
  return null;
}

export function describeMediaError(e: any): string {
  const name = e?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Microphone access was denied. Allow microphone access for this site in your browser settings (the lock icon in the address bar), then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found. Connect a microphone and try again.';
  if (name === 'NotReadableError') return 'The microphone is in use by another application or could not be started.';
  if (typeof navigator !== 'undefined' && !navigator.mediaDevices) return 'Microphone capture requires a secure (HTTPS) page and a supported browser.';
  return `Could not start the microphone: ${e?.message || name || 'unknown error'}`;
}
