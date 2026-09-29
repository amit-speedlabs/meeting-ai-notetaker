import { ChunkedProvider, AudioChunk, TranscriptPiece, TranscriptionError } from './types';

/**
 * Deepgram pre-recorded API per segment with diarization. Speaker numbers are chunk-local:
 * Deepgram does not guarantee "speaker 0" in one request is "speaker 0" in the next.
 */
export class DeepgramTranscription extends ChunkedProvider {
  readonly id = 'deepgram';
  readonly label = 'Deepgram';
  readonly supportsDiarization = true;
  constructor(private apiKey: string, private model: string, private language: string) {
    super();
  }
  protected async transcribeChunk(chunk: AudioChunk): Promise<TranscriptPiece[]> {
    const params = new URLSearchParams({ model: this.model, diarize: 'true', smart_format: 'true', utterances: 'true', punctuate: 'true' });
    if (this.language) params.set('language', this.language);
    const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: 'POST',
      headers: { Authorization: `Token ${this.apiKey}`, 'Content-Type': chunk.mime.split(';')[0] },
      body: new Uint8Array(chunk.data),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new TranscriptionError(`Deepgram transcription failed (${res.status}): ${body.slice(0, 200)}`, res.status === 429 || res.status >= 500);
    }
    const data: any = await res.json();
    const utts: any[] = data?.results?.utterances || [];
    return utts
      .filter((u) => u.transcript?.trim())
      .map((u) => ({
        startMs: Math.round(u.start * 1000),
        endMs: Math.round(u.end * 1000),
        speaker: typeof u.speaker === 'number' ? `Speaker ${u.speaker + 1}` : null,
        text: u.transcript.trim(),
        confidence: typeof u.confidence === 'number' ? u.confidence : null,
      }));
  }
}
