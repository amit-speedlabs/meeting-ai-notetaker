// Server-only configuration. Never import this from client components.
import 'server-only';

function int(name: string, def: number) {
  const v = process.env[name];
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : def;
}

export const config = {
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:5432/notetaker',
  appUrl: (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
  authSecret: process.env.AUTH_SECRET || 'dev-insecure-secret',
  transcriptionProvider: (process.env.TRANSCRIPTION_PROVIDER || 'mock').toLowerCase(),
  llmProvider: (process.env.LLM_PROVIDER || 'heuristic').toLowerCase(),
  openaiKey: process.env.OPENAI_API_KEY || '',
  openaiBaseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
  // Groq: OpenAI-compatible API with a free tier (Whisper transcription + open-weight chat models).
  groqKey: process.env.GROQ_API_KEY || '',
  groqBaseUrl: (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, ''),
  groqTranscribeModel: process.env.GROQ_TRANSCRIBE_MODEL || 'whisper-large-v3-turbo',
  groqLlmModel: process.env.GROQ_LLM_MODEL || 'openai/gpt-oss-120b',
  openaiTranscribeModel: process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe',
  openaiLlmModel: process.env.OPENAI_LLM_MODEL || 'gpt-4.1-mini',
  deepgramKey: process.env.DEEPGRAM_API_KEY || '',
  deepgramModel: process.env.DEEPGRAM_MODEL || 'nova-3',
  language: process.env.TRANSCRIPTION_LANGUAGE || 'en',
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-opus-5',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  audioDir: process.env.AUDIO_STORAGE_DIR || './data/audio',
  // "local" (disk) or "postgres" (in the database; needed on serverless hosts with no persistent disk).
  audioStore: (process.env.AUDIO_STORE || (process.env.VERCEL ? 'postgres' : 'local')).toLowerCase(),
  // How often live notes refresh. Groq's free tier has a daily token cap, so refresh less often there.
  notesIntervalSegments: int('NOTES_INTERVAL_SEGMENTS', (process.env.LLM_PROVIDER || '').toLowerCase() === 'groq' ? 15 : 6),
  notesMaxWaitMs: int('NOTES_MAX_WAIT_SECONDS', (process.env.LLM_PROVIDER || '').toLowerCase() === 'groq' ? 300 : 180) * 1000,
  // Groq's free tier caps a single request at a few thousand tokens, so use smaller windows there.
  finalPassMaxChars: int('FINAL_PASS_MAX_CHARS', (process.env.LLM_PROVIDER || '').toLowerCase() === 'groq' ? 16000 : 120000),
  // Comma-separated emails allowed to create an account. Empty = anyone can sign up.
  allowedEmails: (process.env.ALLOWED_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  extensionOrigins: (process.env.EXTENSION_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  isProd: process.env.NODE_ENV === 'production',
};
