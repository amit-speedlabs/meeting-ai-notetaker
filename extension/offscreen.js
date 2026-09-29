// Offscreen document: holds the tab (+ optional mic) MediaStreams, keeps the tab audible, records
// self-contained segments and uploads them through a durable IndexedDB queue.
// Offscreen documents only have chrome.runtime, so server/token arrive in the start message.

let SEGMENT_MS = 20000;
let cfg = null; // { server, token, meetingId, startWall }
let tabStream = null, micStream = null, ctx = null, mixDest = null, analyser = null;
let recorder = null, segTimer = null, running = false, nextSeq = 0, curPeak = { v: 0 }, pendingStop = Promise.resolve();
let backoff = 1000, failures = 0, draining = false, retryTimer = null, lastError = null;

const report = (msg) => chrome.runtime.sendMessage(msg).catch(() => {});

// ---------- IndexedDB queue ----------
function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('meeting-ai-extension', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('segments', { keyPath: ['meetingId', 'seq'] });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function qAll() {
  const d = await db();
  return new Promise((res, rej) => {
    const r = d.transaction('segments').objectStore('segments').getAll();
    r.onsuccess = () => res(r.result.filter((i) => i.meetingId === cfg.meetingId).sort((a, b) => a.seq - b.seq));
    r.onerror = () => rej(r.error);
  });
}
async function qPut(item) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction('segments', 'readwrite');
    tx.objectStore('segments').put(item);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}
async function qDel(item) {
  const d = await db();
  return new Promise((res) => {
    const tx = d.transaction('segments', 'readwrite');
    tx.objectStore('segments').delete([item.meetingId, item.seq]);
    tx.oncomplete = res;
    tx.onerror = res;
  });
}

async function status() {
  const pending = (await qAll()).length;
  const s = !navigator.onLine || failures >= 3 ? 'DISCONNECTED' : pending ? 'BUFFERING' : 'CONNECTED';
  report({ type: 'queue-status', status: s, pending, lastError });
  return pending;
}

async function drain() {
  if (draining || !cfg) return;
  draining = true;
  try {
    for (;;) {
      const items = await qAll();
      await status();
      if (!items.length || !navigator.onLine) break;
      const it = items[0];
      const fd = new FormData();
      fd.append('audio', it.blob, `seg-${it.seq}.webm`);
      fd.append('seq', String(it.seq));
      fd.append('startMs', String(it.startMs));
      fd.append('durationMs', String(it.durationMs));
      fd.append('silent', it.silent ? '1' : '0');
      let res = null;
      try {
        res = await fetch(`${cfg.server}/api/meetings/${cfg.meetingId}/segments`, { method: 'POST', headers: { Authorization: `Bearer ${cfg.token}` }, body: fd });
      } catch {
        lastError = 'Network unavailable — audio is buffered in the extension';
      }
      if (res && res.ok) {
        await qDel(it);
        failures = 0;
        backoff = 1000;
        lastError = null;
        continue;
      }
      if (res && res.status >= 400 && res.status < 500 && ![408, 425, 429].includes(res.status)) {
        const b = await res.json().catch(() => ({}));
        lastError = `Segment rejected: ${b.error || res.status}`;
        await qDel(it);
        continue;
      }
      if (res) lastError = (await res.json().catch(() => ({}))).error || `Server error ${res.status} — retrying`;
      failures++;
      retryTimer = setTimeout(() => { retryTimer = null; drain(); }, backoff);
      backoff = Math.min(backoff * 2, 30000);
      break;
    }
  } finally {
    draining = false;
    await status();
  }
}
addEventListener('online', drain);
addEventListener('offline', status);

// ---------- Recording ----------
function mime() {
  return ['audio/webm;codecs=opus', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

function startSegment() {
  // 32 kbps Opus is plenty for speech and keeps stored audio small (roughly halving stored audio size).
  const rec = new MediaRecorder(mixDest.stream, { ...(mime() ? { mimeType: mime() } : {}), audioBitsPerSecond: 32000 });
  const parts = [];
  const seq = nextSeq++;
  const t0 = Date.now();
  const peak = { v: 0 };
  curPeak = peak;
  pendingStop = new Promise((resolve) => {
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    rec.onstop = async () => {
      const blob = new Blob(parts, { type: rec.mimeType || 'audio/webm' });
      const dur = Date.now() - t0;
      if (blob.size && dur > 300) {
        await qPut({ meetingId: cfg.meetingId, seq, blob, startMs: Math.max(0, t0 - cfg.startWall), durationMs: dur, silent: SEGMENT_MS >= 10000 && peak.v < 0.003 });
        drain();
      }
      resolve();
    };
  });
  rec.start();
  recorder = rec;
  segTimer = setTimeout(() => {
    if (!running) return;
    rec.stop();
    startSegment();
  }, SEGMENT_MS);
}

async function stopRecorder() {
  running = false;
  clearTimeout(segTimer);
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  await pendingStop;
}

async function start(msg) {
  cfg = { server: msg.server, token: msg.token, meetingId: msg.meetingId, startWall: msg.startWall };
  if (msg.segmentMs >= 2000) SEGMENT_MS = msg.segmentMs;
  // The tab stream id was granted by chrome.tabCapture for the tab the user chose.
  tabStream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: msg.streamId } },
    video: false,
  });
  ctx = new AudioContext();
  const tabSrc = ctx.createMediaStreamSource(tabStream);
  tabSrc.connect(ctx.destination); // keep the meeting audible to the user
  mixDest = ctx.createMediaStreamDestination();
  tabSrc.connect(mixDest);
  let mic = 'off';
  if (msg.includeMic) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      ctx.createMediaStreamSource(micStream).connect(mixDest);
      mic = 'on';
    } catch (e) {
      mic = 'denied';
    }
  }
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  ctx.createMediaStreamSource(mixDest.stream).connect(analyser);
  const buf = new Float32Array(2048);
  setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let s = 0;
    for (const v of buf) s += v * v;
    if (running) curPeak.v = Math.max(curPeak.v, Math.sqrt(s / buf.length));
  }, 100);
  for (const t of tabStream.getAudioTracks()) t.onended = () => report({ type: 'capture-ended' });
  const existing = await qAll().catch(() => []);
  nextSeq = existing.length ? existing[existing.length - 1].seq + 1 : 0;
  running = true;
  startSegment();
  drain();
  return { ok: true, mic };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'offscreen') return false;
  (async () => {
    switch (msg.type) {
      case 'start':
        return start(msg);
      case 'pause':
        await stopRecorder();
        return { ok: true };
      case 'resume':
        running = true;
        startSegment();
        return { ok: true };
      case 'stop': {
        await stopRecorder();
        // Wait up to 45 s for the queue to drain.
        const until = Date.now() + 45000;
        let pending = await status();
        while (pending && Date.now() < until) {
          if (!draining && !retryTimer) drain();
          await new Promise((r) => setTimeout(r, 500));
          pending = await status();
        }
        tabStream?.getTracks().forEach((t) => t.stop());
        micStream?.getTracks().forEach((t) => t.stop());
        ctx?.close();
        return { ok: true, pending };
      }
    }
  })()
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: e.message || String(e) }));
  return true;
});
