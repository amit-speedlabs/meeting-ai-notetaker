import 'server-only';
import { config } from '../config';
import { LLMProvider } from './types';
import { AnthropicNotes } from './anthropic';
import { OpenAINotes } from './openai';
import { HeuristicNotes } from './heuristic';

export function llmProviderInfo() {
  const id = config.llmProvider;
  if (id === 'anthropic') return { id, label: 'Claude (Anthropic)', ready: !!config.anthropicKey, problem: config.anthropicKey ? undefined : 'ANTHROPIC_API_KEY is not set', isHeuristic: false };
  if (id === 'openai') return { id, label: 'OpenAI', ready: !!config.openaiKey, problem: config.openaiKey ? undefined : 'OPENAI_API_KEY is not set', isHeuristic: false };
  if (id === 'groq') return { id, label: 'Groq', ready: !!config.groqKey, problem: config.groqKey ? undefined : 'GROQ_API_KEY is not set', isHeuristic: false };
  return { id: 'heuristic', label: 'Rule-based extractor (no AI model)', ready: true, problem: undefined, isHeuristic: true };
}

export function createLLMProvider(): LLMProvider {
  const info = llmProviderInfo();
  if (!info.ready) throw new Error(`AI provider "${info.id}" is not configured: ${info.problem}`);
  if (info.id === 'anthropic') return new AnthropicNotes(config.anthropicKey, config.anthropicModel);
  if (info.id === 'openai') return new OpenAINotes(config.openaiKey, config.openaiLlmModel, config.openaiBaseUrl);
  if (info.id === 'groq') return new OpenAINotes(config.groqKey, config.groqLlmModel, config.groqBaseUrl, 'groq', 'Groq');
  return new HeuristicNotes();
}
