// Runs only on meet.google.com. Two jobs: report the meeting code/title to the popup, and show an
// always-visible recording badge on the Meet page while notes are being taken. It does not read
// participant names, chat or any other page content.
(() => {
  const codeMatch = location.pathname.match(/^\/([a-z]{3,4}-[a-z]{3,4}-[a-z]{3,4})/);

  function badge(rec) {
    let el = document.getElementById('meeting-ai-badge');
    const on = rec && (rec.status === 'recording' || rec.status === 'paused');
    if (!on) return el?.remove();
    if (!el) {
      el = document.createElement('div');
      el.id = 'meeting-ai-badge';
      document.documentElement.appendChild(el);
    }
    el.className = rec.status === 'paused' ? 'paused' : '';
    el.textContent = rec.status === 'paused' ? '❚❚ Meeting AI notes paused' : '● Recording — Meeting AI is taking notes';
  }

  chrome.runtime.onMessage.addListener((msg, _s, send) => {
    if (msg.type === 'meet-info') {
      const t = document.title.replace(/^Meet\s*[-–—]\s*/i, '').trim();
      send({ code: codeMatch?.[1] || null, title: t && !/^meet$/i.test(t) && t !== codeMatch?.[1] ? t : '' });
    } else if (msg.type === 'recording-state') {
      badge(msg.rec);
    }
  });

  chrome.runtime.sendMessage({ type: 'get-state' }).then((r) => r?.ok && badge(r.rec)).catch(() => {});
})();
