import { ChunkedProvider, AudioChunk, TranscriptPiece } from './types';

/**
 * DEMO ONLY. Does not analyse the audio at all: for each non-silent segment it emits the next lines
 * of a scripted sample conversation so the capture → transcript → notes pipeline can be exercised
 * without API keys. The UI shows a "Demo transcription" banner whenever this provider is active.
 */
export const DEMO_SCRIPT: Array<[string, string]> = [
  ['Speaker 1', "Let's get started. Today we need to finalise the AI Olympiad school outreach plan."],
  ['Speaker 2', "So far we've contacted 240 schools and 180 kits have been distributed."],
  ['Speaker 3', 'Registrations are at 120 schools. Gujarat numbers are still not confirmed.'],
  ['Speaker 1', "Let's prioritise schools where kits have already been distributed."],
  ['Speaker 2', 'Agreed. We will use the CoE channel for the selected schools.'],
  ['Speaker 3', 'I will share the updated state-wise list by tomorrow.'],
  ['Speaker 1', 'Vivek, please follow up with the pending Maharashtra schools by Friday.'],
  ['Speaker 2', "The risk is that some schools won't confirm before the registration deadline."],
  ['Speaker 3', 'Do we have a budget for a second batch of kits? That is still open.'],
  ['Speaker 1', 'We also need someone to update the registration tracker.'],
  ['Speaker 2', "Let's review progress again before the next meeting."],
  ['Speaker 1', 'Great, that covers everything. Thanks everyone.'],
];

export class MockTranscription extends ChunkedProvider {
  readonly id = 'mock';
  readonly label = 'Demo transcription (not real speech-to-text)';
  readonly supportsDiarization = true;
  readonly sendsAudioToThirdParty = false;
  readonly isDemo = true;
  protected async transcribeChunk(chunk: AudioChunk): Promise<TranscriptPiece[]> {
    if (process.env.MOCK_TRANSCRIPTION_FAIL === '1') throw new Error('Simulated transcription failure');
    const [speaker, text] = DEMO_SCRIPT[chunk.seq % DEMO_SCRIPT.length];
    return [{ startMs: 0, endMs: chunk.durationMs, speaker, text, confidence: 0.99 }];
  }
}
