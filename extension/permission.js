document.getElementById('grant').onclick = async () => {
  const msg = document.getElementById('msg');
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    msg.textContent = 'Microphone allowed. You can close this tab and start taking notes.';
    msg.className = 'small ok';
  } catch (e) {
    msg.textContent = `Microphone was not allowed (${e.name}). Notes will include only the Meet tab audio.`;
    msg.className = 'small err';
  }
};
