'use client';

/** Decodes an uploaded audio/video file and splits it into 16 kHz mono WAV chunks. */
export async function fileToWavChunks(file: File, chunkSeconds = 60, onProgress?: (p: number) => void): Promise<{ blob: Blob; startMs: number; durationMs: number; silent: boolean }[]> {
  const buf = await file.arrayBuffer();
  const ctx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(buf);
  } catch {
    throw new Error('This file could not be decoded by the browser. Try an MP3, M4A, WAV, WebM or MP4 file.');
  } finally {
    ctx.close();
  }
  const rate = 16000;
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const mono = (await off.startRendering()).getChannelData(0);
  const per = chunkSeconds * rate;
  const out = [];
  for (let i = 0; i < mono.length; i += per) {
    const slice = mono.subarray(i, Math.min(i + per, mono.length));
    let peak = 0;
    for (let j = 0; j < slice.length; j += 64) peak = Math.max(peak, Math.abs(slice[j]));
    out.push({ blob: encodeWav(slice, rate), startMs: Math.round((i / rate) * 1000), durationMs: Math.round((slice.length / rate) * 1000), silent: peak < 0.01 });
    onProgress?.(Math.min(1, (i + per) / mono.length));
  }
  return out;
}

function encodeWav(samples: Float32Array, rate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buffer);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
