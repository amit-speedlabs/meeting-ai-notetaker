// Shared helpers for talking to the Meeting AI Notetaker server.
export async function getConfig() {
  const { server = '', token = '' } = await chrome.storage.local.get(['server', 'token']);
  return { server: server.replace(/\/$/, ''), token };
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const { server, token } = await getConfig();
  if (!server || !token) throw Object.assign(new Error('Extension is not connected to a server. Open the extension options.'), { code: 'not_configured' });
  const headers = { Authorization: `Bearer ${token}` };
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${server}${path}`, { method, headers, body: payload });
  return res;
}

export async function apiJson(path, opts) {
  const res = await api(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

export const MEET_RE = /^https:\/\/meet\.google\.com\/([a-z]{3,4}-[a-z]{3,4}-[a-z]{3,4})(?:[/?#]|$)/;

export const MEETING_TYPES = ['Internal Meeting', 'Client Meeting', 'School Meeting', 'Partner Meeting', 'Sales Meeting', 'Project Meeting', 'Interview', 'Brainstorming', 'Review Meeting', 'Other'];

export const UNAVAILABLE = 'Meet audio capture is unavailable in this browser configuration.';

export function fmtTimer(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
}
