import { getConfig, apiJson, MEET_RE, MEETING_TYPES, fmtTimer } from './api.js';

const $ = (id) => document.getElementById(id);
const views = ['config', 'nomeet', 'ready', 'consent', 'active', 'stopping', 'finished', 'error'];
const show = (v) => views.forEach((x) => $(`v-${x}`).classList.toggle('hidden', x !== v));
const send = (msg) => chrome.runtime.sendMessage(msg);

let tab = null, rec = null, cfg = null, cursor = -1, pollTimer = null, tickTimer = null;

async function openApp(path) {
  chrome.tabs.create({ url: `${cfg.server}${path}` });
}
document.querySelectorAll('[data-app]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); openApp(a.dataset.app); }));
$('open-options').onclick = () => chrome.runtime.openOptionsPage();
$('grant-mic').onclick = (e) => { e.preventDefault(); chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') }); };
MEETING_TYPES.forEach((t) => $('type').append(new Option(t, t)));

async function micGranted() {
  try {
    return (await navigator.permissions.query({ name: 'microphone' })).state === 'granted';
  } catch {
    return false;
  }
}
async function refreshMicNote() {
  const want = $('mic').checked;
  $('mic-extra').classList.toggle('hidden', !want);
  $('mic-note').classList.toggle('hidden', !want || (await micGranted()));
}
$('mic').onchange = refreshMicNote;

function showError(msg) {
  $('err-text').textContent = msg;
  show('error');
}
$('err-back').onclick = (e) => { e.preventDefault(); init(); };

async function init() {
  cfg = await getConfig();
  if (!cfg.server || !cfg.token) return show('config');
  const r = await send({ type: 'get-state' });
  rec = r.rec;
  if (rec.status === 'recording' || rec.status === 'paused') return renderActive();
  if (rec.status === 'stopping') return show('stopping');
  if (rec.status === 'finished') return renderFinished();
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  // Title suggestion from the Meet page (document title only; no participant scraping). The content
  // script only runs on meet.google.com, so an answer also confirms this is a Meet tab.
  let info = null;
  try {
    info = await chrome.tabs.sendMessage(tab.id, { type: 'meet-info' });
  } catch {}
  const code = tab?.url?.match(MEET_RE)?.[1] || info?.code;
  if (!code) return show('nomeet');
  $('title').value = info?.title || `Google Meet ${code}`;
  try {
    const h = await apiJson('/api/health');
    $('provider').textContent = h.transcription.isDemo ? 'DEMO mode (server is not transcribing real audio)' : `${h.transcription.label} (audio is sent to this provider)`;
  } catch (e) {
    $('provider').textContent = `server unreachable (${e.message})`;
  }
  await refreshMicNote();
  show('ready');
}

$('start').onclick = () => {
  if (!$('title').value.trim()) return $('title').focus();
  show('consent');
};
$('consent-cancel').onclick = () => show('ready');
$('consent-ok').onclick = async () => {
  $('consent-ok').disabled = true;
  const includeMic = $('mic').checked && (await micGranted());
  const r = await send({
    type: 'start',
    tabId: tab.id,
    title: $('title').value.trim(),
    meetingType: $('type').value,
    participants: $('people').value.split(',').map((s) => s.trim()).filter(Boolean),
    includeMic,
  });
  $('consent-ok').disabled = false;
  if (!r.ok) return showError(r.error);
  rec = r.rec;
  renderActive();
};

function renderActive() {
  show('active');
  $('a-title').textContent = rec.title;
  const paused = rec.status === 'paused';
  $('rec-ind').classList.toggle('paused', paused);
  $('rec-label').textContent = paused ? 'Paused' : '● Recording';
  $('pause').classList.toggle('hidden', paused);
  $('resume').classList.toggle('hidden', !paused);
  $('t-status').textContent = paused ? 'Paused' : 'Active';
  $('audio-status').textContent = rec.audio || 'CONNECTED';
  $('audio-status').className = rec.audio === 'CONNECTED' ? 'ok' : rec.audio === 'BUFFERING' ? 'warn' : 'err';
  $('pending').textContent = rec.pending ? `(${rec.pending} segment(s) buffered)` : '';
  $('mic-state').textContent = rec.mic === 'on' ? 'Microphone: included' : rec.mic === 'denied' ? 'Microphone: permission denied — only tab audio is captured' : 'Microphone: not included (your own voice is not captured)';
  $('a-error').classList.toggle('hidden', !rec.lastError);
  $('a-error').textContent = rec.lastError || '';
  const tick = () => ($('timer').textContent = fmtTimer((rec.activeMs || 0) + (rec.resumedAt ? Date.now() - rec.resumedAt : 0)));
  tick();
  clearInterval(tickTimer);
  tickTimer = setInterval(tick, 500);
  if (!pollTimer) {
    poll();
    pollTimer = setInterval(poll, 3000);
  }
}

async function poll() {
  if (!rec?.meetingId) return;
  try {
    const d = await apiJson(`/api/meetings/${rec.meetingId}/live?after=${cursor}`);
    const box = $('lines');
    if (d.segments.length) {
      if (cursor === -1) box.textContent = '';
      for (const s of d.segments) {
        const div = document.createElement('div');
        const who = document.createElement('b');
        who.textContent = `${(s.speaker && d.meeting.speaker_map?.[s.speaker]) || s.speaker || 'Unknown Speaker'}: `;
        div.append(who, document.createTextNode(s.text));
        box.append(div);
      }
      cursor = d.segments[d.segments.length - 1].seq;
      box.scrollTop = box.scrollHeight;
    }
    $('n-status').textContent = d.meeting.error ? 'Delayed' : d.notes ? `Updated ${new Date(d.notes.updated_at).toLocaleTimeString()}` : 'Generating';
    if (d.meeting.error) $('t-status').textContent = d.meeting.error.startsWith('Transcription') ? 'Error — retrying' : $('t-status').textContent;
  } catch {}
}

function renderFinished() {
  show('finished');
  $('f-note').textContent = rec.error || rec.note || '';
}

$('pause').onclick = async () => { const r = await send({ type: 'pause' }); rec = r.rec; renderActive(); };
$('resume').onclick = async () => { const r = await send({ type: 'resume' }); rec = r.rec; renderActive(); };
$('stop').onclick = async () => {
  show('stopping');
  const r = await send({ type: 'stop' });
  rec = r.rec || rec;
  renderFinished();
};
$('open-live').onclick = (e) => { e.preventDefault(); openApp(`/meetings/${rec.meetingId}/record`); };
$('open-summary').onclick = () => openApp(`/meetings/${rec.meetingId}`);
$('new-meeting').onclick = async (e) => { e.preventDefault(); await send({ type: 'reset' }); cursor = -1; init(); };

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'state-changed') return;
  rec = msg.rec;
  if (rec.status === 'recording' || rec.status === 'paused') renderActive();
  else if (rec.status === 'finished') renderFinished();
});

init();
