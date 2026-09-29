export type TranscriptPiece = {
  startMs: number; // relative to the start of the chunk
  endMs: number;
  speaker: string | null; // provider label, e.g. "Speaker 1"; null = unknown
  text: string;
  confidence: number | null;
};

export type AudioChunk = { seq: number; data: Buffer; mime: string; startMs: number; durationMs: number };

/**
 * Provider abstraction (PRD §25). Chunk-based providers do the work in sendAudioChunk and hand results
 * back through receiveTranscript(); streaming providers would push results as they arrive.
 */
export interface TranscriptionProvider {
  readonly id: string;
  readonly label: string;
  readonly supportsDiarization: boolean;
  readonly sendsAudioToThirdParty: boolean;
  readonly isDemo: boolean;
  start(ctx: { meetingId: string; language?: string }): Promise<void>;
  sendAudioChunk(chunk: AudioChunk): Promise<void>;
  receiveTranscript(): Promise<TranscriptPiece[]>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<TranscriptPiece[]>;
}

export class TranscriptionError extends Error {
  constructor(message: string, public retryable: boolean) {
    super(message);
  }
}

/** Base for request/response providers: buffers pieces produced by transcribeChunk(). */
export abstract class ChunkedProvider implements TranscriptionProvider {
  abstract readonly id: string;
  abstract readonly label: string;
  abstract readonly supportsDiarization: boolean;
  readonly sendsAudioToThirdParty: boolean = true;
  readonly isDemo: boolean = false;
  protected ctx: { meetingId: string; language?: string } | null = null;
  private pending: TranscriptPiece[] = [];
  private paused = false;

  async start(ctx: { meetingId: string; language?: string }) {
    this.ctx = ctx;
  }
  async sendAudioChunk(chunk: AudioChunk) {
    if (this.paused) return;
    this.pending.push(...(await this.transcribeChunk(chunk)));
  }
  async receiveTranscript() {
    const out = this.pending;
    this.pending = [];
    return out;
  }
  async pause() {
    this.paused = true;
  }
  async resume() {
    this.paused = false;
  }
  async stop() {
    return this.receiveTranscript();
  }
  protected abstract transcribeChunk(chunk: AudioChunk): Promise<TranscriptPiece[]>;
}
