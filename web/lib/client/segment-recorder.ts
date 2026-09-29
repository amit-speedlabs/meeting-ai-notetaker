'use client';

export type SegmentMeta = { seq: number; startMs: number; durationMs: number; silent: boolean; mime: string };

/**
 * Records a MediaStream as a series of self-contained audio files. MediaRecorder timeslice chunks are
 * not independently decodable, so the recorder is stopped and restarted every `segmentMs`.
 */
export class SegmentRecorder {
  private rec: MediaRecorder | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private segStartWall = 0;
  private cur = { peak: 0, samples: 0 };
  private analyser: AnalyserNode | null = null;
  private ctx: AudioContext | null = null;
  private levelTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private pendingStop: Promise<void> = Promise.resolve();
  readonly mime: string;

  constructor(
    private stream: MediaStream,
    private opts: {
      segmentMs: number;
      meetingStartWall: number; // Date.now() at meeting start; offsets are wall-clock ms from it
      nextSeq: number;
      onSegment: (blob: Blob, meta: SegmentMeta) => void;
      onLevel?: (level: number) => void;
      silenceThreshold?: number;
    },
  ) {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    this.mime = candidates.find((c) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) || '';
  }

  start() {
    if (this.running) return;
    this.running = true;
    try {
      this.ctx = new AudioContext();
      // May start suspended under autoplay rules; metering then stays off and nothing is marked silent.
      this.ctx.resume().catch(() => {});
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      src.connect(this.analyser);
      const buf = new Float32Array(this.analyser.fftSize);
      this.levelTimer = setInterval(() => {
        if (!this.analyser) return;
        this.analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        const rms = Math.sqrt(sum / buf.length);
        if (this.running && this.ctx?.state === 'running') {
          this.cur.peak = Math.max(this.cur.peak, rms);
          this.cur.samples++;
        }
        this.opts.onLevel?.(Math.min(1, rms * 8));
      }, 100);
    } catch {
      /* level metering is optional */
    }
    this.startSegment();
  }

  private startSegment() {
    // 32 kbps Opus is plenty for speech and keeps stored audio small (roughly halving stored audio size).
    const rec = new MediaRecorder(this.stream, { ...(this.mime ? { mimeType: this.mime } : {}), audioBitsPerSecond: 32000 });
    const parts: Blob[] = [];
    const seq = this.opts.nextSeq++;
    const startWall = Date.now();
    this.segStartWall = startWall;
    const st = { peak: 0, samples: 0 };
    this.cur = st;
    const done = new Promise<void>((resolve) => {
      rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
      rec.onstop = () => {
        const durationMs = Date.now() - startWall;
        const blob = new Blob(parts, { type: rec.mimeType || this.mime || 'audio/webm' });
        // Only mark silence when the level meter actually ran for most of the segment; otherwise we
        // cannot tell, and the provider decides.
        const measured = st.samples * 100 >= durationMs * 0.6;
        const silent = measured && st.peak < (this.opts.silenceThreshold ?? 0.003);
        if (blob.size > 0 && durationMs > 300)
          this.opts.onSegment(blob, { seq, startMs: startWall - this.opts.meetingStartWall, durationMs, silent, mime: blob.type });
        resolve();
      };
    });
    this.pendingStop = done;
    rec.start();
    this.rec = rec;
    this.timer = setTimeout(() => this.rotate(), this.opts.segmentMs);
  }

  private rotate() {
    if (!this.running || !this.rec) return;
    this.rec.stop();
    this.startSegment();
  }

  /** Flushes the current segment and stops recording (used for pause and stop). */
  async stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.rec && this.rec.state !== 'inactive') this.rec.stop();
    await this.pendingStop;
    this.rec = null;
  }

  resume() {
    if (this.running) return;
    this.running = true;
    this.startSegment();
  }

  get nextSeq() {
    return this.opts.nextSeq;
  }

  dispose() {
    if (this.levelTimer) clearInterval(this.levelTimer);
    this.ctx?.close().catch(() => {});
  }
}
