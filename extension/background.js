// Service worker: owns the recording state machine. Audio lives in the offscreen document because
// MV3 service workers cannot hold MediaStreams.
import { apiJson, getConfig, MEET_RE, UNAVAILABLE } from './api.js';

const IDLE = { status: 'idle' };

async function getState() {
  const { rec = IDLE } = await chrome.storage.session.get('rec');
  return rec;
}
async function setState(patch) {
  const next = patch === IDLE ? IDLE : { ...(await getState()), ...patch };
  await chrome.storage.session.set({ rec: next });
  await updateBadge(next);
  if (next.tabId) chrome.tabs.sendMessage(next.tabId, { type: 'recording-state', rec: next }).catch(() => {});
  chrome.runtime.sendMessage({ type: 'state-changed', rec: next }).catch(() => {});
  return next;
}

async function updateBadge(rec) {
  const on = rec.status === 'recording';
  const paused = rec.status === 'paused';
  await chrome.action.setBadgeText({ text: on ? 'REC' : paused ? '❚❚' : '' });
  await chrome.action.setBadgeBackgroundColor({ color: on ? '#e11d2e' : '#b54708' });
}

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Record the audio of the Google Meet tab the user chose, while the user sees a recording indicator.',
  });
}

async function closeOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length) await chrome.offscreen.closeDocument().catch(() => {});
}

function toOffscreen(msg) {
  return chrome.runtime.sendMessage({ ...msg, target: 'offscreen' });
}

function activeMs(rec) {
  return (rec.activeMs || 0) + (rec.resumedAt ? Date.now() - rec.resumedAt : 0);
}

// The tab URL is visible after the user clicks the toolbar button (activeTab). As a second signal,
// the content script (which only runs on meet.google.com) answers with the meeting code.
async function meetCode(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const m = tab.url && tab.url.match(MEET_RE);
  if (m) return m[1];
  try {
    const info = await chrome.tabs.sendMessage(tabId, { type: 'meet-info' });
    return info?.code || null;
  } catch {
    return null;
  }
}

async function start({ tabId, title, meetingType, participants, includeMic }) {
  const cur = await getState();
  if (cur.status === 'recording' || cur.status === 'paused') throw new Error('A meeting is already being recorded.');
  const code = await meetCode(tabId);
  if (!code) throw new Error('The active tab is not a Google Meet call.');

  // 1) Ask Chrome for a capture stream id for THIS tab only. Requires that the user invoked the
  //    extension on this tab (activeTab); fails if policy forbids capture or it is already captured.
  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  } catch (e) {
    throw Object.assign(new Error(`${UNAVAILABLE} (${e.message || e})`), { code: 'capture_unavailable' });
  }

  // 2) Create the meeting on the server (consent was confirmed in the popup).
  const { meeting } = await apiJson('/api/meetings', {
    method: 'POST',
    body: {
      title, meetingType, mode: 'meet', consent: true, meetCode: code,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      participants: participants.map((name) => ({ name })),
    },
  });
  const started = await apiJson(`/api/meetings/${meeting.id}/state`, { method: 'POST', body: { action: 'start' } });
  const startWall = new Date(started.meeting.start_time).getTime();

  // 3) Start capture in the offscreen document.
  await ensureOffscreen();
  const { server, token } = await getConfig();
  const { debugSegmentMs } = await chrome.storage.local.get('debugSegmentMs'); // test hook
  const res = await toOffscreen({ type: 'start', streamId, meetingId: meeting.id, includeMic, startWall, server, token, segmentMs: debugSegmentMs });
  if (!res || !res.ok) {
    await apiJson(`/api/meetings/${meeting.id}/state`, { method: 'POST', body: { action: 'fail', reason: res?.error || 'Capture failed' } }).catch(() => {});
    await closeOffscreen();
    throw Object.assign(new Error(`${UNAVAILABLE} ${res?.error || ''}`.trim()), { code: 'capture_unavailable' });
  }
  return setState({
    status: 'recording', meetingId: meeting.id, tabId, title, startWall, activeMs: 0, resumedAt: Date.now(),
    mic: res.mic, audio: 'CONNECTED', pending: 0, error: null, lastError: null,
  });
}

async function pause() {
  const rec = await getState();
  if (rec.status !== 'recording') return rec;
  await toOffscreen({ type: 'pause' });
  const ms = activeMs(rec);
  await apiJson(`/api/meetings/${rec.meetingId}/state`, { method: 'POST', body: { action: 'pause', durationSeconds: Math.round(ms / 1000) } }).catch((e) => setState({ lastError: e.message }));
  return setState({ status: 'paused', activeMs: ms, resumedAt: null });
}

async function resume() {
  const rec = await getState();
  if (rec.status !== 'paused') return rec;
  await toOffscreen({ type: 'resume' });
  await apiJson(`/api/meetings/${rec.meetingId}/state`, { method: 'POST', body: { action: 'resume', durationSeconds: Math.round(rec.activeMs / 1000) } }).catch((e) => setState({ lastError: e.message }));
  return setState({ status: 'recording', resumedAt: Date.now() });
}

async function stop(reason) {
  const rec = await getState();
  if (rec.status !== 'recording' && rec.status !== 'paused') return rec;
  const ms = activeMs(rec);
  await setState({ status: 'stopping', activeMs: ms, resumedAt: null, note: reason || null });
  const r = await toOffscreen({ type: 'stop' }).catch(() => ({ pending: -1 }));
  if (r && r.pending > 0) await setState({ lastError: `${r.pending} audio segment(s) could not be uploaded before stopping.` });
  await closeOffscreen();
  try {
    await apiJson(`/api/meetings/${rec.meetingId}/state`, { method: 'POST', body: { action: 'stop', durationSeconds: Math.round(ms / 1000) } });
    return setState({ status: 'finished', meetingId: rec.meetingId, title: rec.title, tabId: rec.tabId });
  } catch (e) {
    return setState({ status: 'finished', error: `Could not finish on the server: ${e.message}. Open the web app to finish the meeting.` });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target === 'offscreen') return false;
  (async () => {
    switch (msg.type) {
      case 'get-state':
        return getState();
      case 'start':
        return start(msg);
      case 'pause':
        return pause();
      case 'resume':
        return resume();
      case 'stop':
        return stop();
      case 'reset':
        return setState(IDLE);
      // Reports from the offscreen document
      case 'queue-status':
        return setState({ audio: msg.status, pending: msg.pending, lastError: msg.lastError });
      case 'capture-ended':
        // Tab closed, meeting left, or capture revoked: finish with what we have.
        return stop('Capture ended (the Meet tab was closed or sharing stopped). The meeting was finished with the audio captured so far.');
      case 'mic-status':
        return setState({ mic: msg.mic });
      default:
        return null;
    }
  })()
    .then((r) => sendResponse({ ok: true, rec: r }))
    .catch((e) => sendResponse({ ok: false, error: e.message, code: e.code }));
  return true;
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const rec = await getState();
  if (rec.tabId === tabId && (rec.status === 'recording' || rec.status === 'paused')) stop('The Meet tab was closed. The meeting was finished with the audio captured so far.');
});

chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (!info.url) return;
  const rec = await getState();
  if (rec.tabId === tabId && (rec.status === 'recording' || rec.status === 'paused') && !MEET_RE.test(info.url)) {
    stop('You left the Meet call. The meeting was finished with the audio captured so far.');
  }
});

// Service worker restarted while the offscreen document is gone (e.g. browser crash): clear stale state.
chrome.runtime.onStartup.addListener(async () => {
  const rec = await getState();
  if (rec.status !== 'idle') await setState({ ...rec, status: 'finished', error: 'The browser restarted during recording. Open the web app to recover the meeting.' });
});
