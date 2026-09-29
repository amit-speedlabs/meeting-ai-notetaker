const $ = (id) => document.getElementById(id);
chrome.storage.local.get(['server', 'token']).then(({ server = '', token = '' }) => {
  $('server').value = server;
  $('token').value = token;
});
$('save').onclick = async () => {
  const server = $('server').value.trim().replace(/\/$/, '');
  const token = $('token').value.trim();
  $('msg').textContent = 'Testing…';
  try {
    const r = await fetch(`${server}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(b.error || `HTTP ${r.status}`);
    await chrome.storage.local.set({ server, token });
    $('msg').textContent = `Connected as ${b.user.name}. Saved.`;
    $('msg').className = 'small ok';
  } catch (e) {
    $('msg').textContent = `Could not connect: ${e.message}`;
    $('msg').className = 'small err';
  }
};
