import { ChunkedProvider, AudioChunk, TranscriptPiece, TranscriptionError } from './types';

/**
 * OpenAI-compatible speech-to-text (OpenAI, or Groq via its OpenAI-compatible endpoint), one request per
 * audio segment. No diarization → speaker is unknown.
 */
export class OpenAITranscription extends ChunkedProvider {
  readonly supportsDiarization = false;
  constructor(
    private apiKey: string,
    private model: string,
    private language: string,
    private baseUrl = 'https://api.openai.com/v1',
    readonly id = 'openai',
    readonly label = 'OpenAI',
  ) {
    super();
  }
  protected async transcribeChunk(chunk: AudioChunk): Promise<TranscriptPiece[]> {
    const form = new FormData();
    const ext = chunk.mime.includes('wav') ? 'wav' : chunk.mime.includes('mp4') ? 'mp4' : chunk.mime.includes('ogg') ? 'ogg' : 'webm';
    form.append('file', new Blob([new Uint8Array(chunk.data)], { type: chunk.mime.split(';')[0] }), `chunk-${chunk.seq}.${ext}`);
    form.append('model', this.model);
    if (this.language) form.append('language', this.language);
    const whisper = this.model.startsWith('whisper');
    form.append('response_format', whisper ? 'verbose_json' : 'json');
    const res = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new TranscriptionError(`${this.label} transcription failed (${res.status}): ${body.slice(0, 200)}`, res.status === 429 || res.status >= 500);
    }
    const data: any = await res.json();
    if (whisper && Array.isArray(data.segments)) {
      return data.segments
        .filter((s: any) => s.text?.trim())
        .map((s: any) => ({
          startMs: Math.round(s.start * 1000),
          endMs: Math.round(s.end * 1000),
          speaker: null,
          text: s.text.trim(),
          confidence: typeof s.avg_logprob === 'number' ? Math.max(0, Math.min(1, Math.exp(s.avg_logprob))) : null,
        }));
    }
    const text = (data.text || '').trim();
    return text ? [{ startMs: 0, endMs: chunk.durationMs, speaker: null, text, confidence: null }] : [];
  }
}
