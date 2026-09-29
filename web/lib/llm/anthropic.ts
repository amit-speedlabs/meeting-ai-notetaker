import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { LLMProvider, NotesJSON, NotesRequest, NotesSchema, SYSTEM_PROMPT, buildUserPrompt } from './types';

export class AnthropicNotes implements LLMProvider {
  readonly id = 'anthropic';
  readonly label = 'Claude (Anthropic)';
  readonly isHeuristic = false;
  private client: Anthropic;
  constructor(apiKey: string, private model: string) {
    this.client = new Anthropic({ apiKey });
  }
  async generateNotes(req: NotesRequest): Promise<NotesJSON> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: req.mode === 'incremental' ? 'low' : 'medium', format: zodOutputFormat(NotesSchema) },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(req) }],
    } as any);
    const msg: any = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new Error('The model declined to process this transcript.');
    if (msg.stop_reason === 'max_tokens') throw new Error('Notes output was truncated (max_tokens).');
    const text = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    return NotesSchema.parse(JSON.parse(text));
  }
}
