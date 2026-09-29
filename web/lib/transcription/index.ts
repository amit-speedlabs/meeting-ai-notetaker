import 'server-only';
import { config } from '../config';
import { TranscriptionProvider } from './types';
import { OpenAITranscription } from './openai';
import { DeepgramTranscription } from './deepgram';
import { MockTranscription } from './mock';

export type ProviderInfo = { id: string; label: string; ready: boolean; isDemo: boolean; sendsAudioToThirdParty: boolean; problem?: string };

export function transcriptionProviderInfo(): ProviderInfo {
  const id = config.transcriptionProvider;
  if (id === 'openai') return { id, label: 'OpenAI', ready: !!config.openaiKey, isDemo: false, sendsAudioToThirdParty: true, problem: config.openaiKey ? undefined : 'OPENAI_API_KEY is not set' };
  if (id === 'groq') return { id, label: 'Groq (Whisper)', ready: !!config.groqKey, isDemo: false, sendsAudioToThirdParty: true, problem: config.groqKey ? undefined : 'GROQ_API_KEY is not set' };
  if (id === 'deepgram') return { id, label: 'Deepgram', ready: !!config.deepgramKey, isDemo: false, sendsAudioToThirdParty: true, problem: config.deepgramKey ? undefined : 'DEEPGRAM_API_KEY is not set' };
  return { id: 'mock', label: 'Demo transcription (not real speech-to-text)', ready: true, isDemo: true, sendsAudioToThirdParty: false };
}

export function createTranscriptionProvider(): TranscriptionProvider {
  const info = transcriptionProviderInfo();
  if (!info.ready) throw new Error(`Transcription provider "${info.id}" is not configured: ${info.problem}`);
  switch (info.id) {
    case 'openai':
      return new OpenAITranscription(config.openaiKey, config.openaiTranscribeModel, config.language, config.openaiBaseUrl);
    case 'groq':
      return new OpenAITranscription(config.groqKey, config.groqTranscribeModel, config.language, config.groqBaseUrl, 'groq', 'Groq');
    case 'deepgram':
      return new DeepgramTranscription(config.deepgramKey, config.deepgramModel, config.language);
    default:
      return new MockTranscription();
  }
}
