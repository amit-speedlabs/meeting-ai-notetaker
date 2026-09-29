import { z } from 'zod';
import { LLMProvider, NotesJSON, NotesRequest, NotesSchema, SYSTEM_PROMPT, buildUserPrompt } from './types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** OpenAI-compatible chat completions with a strict JSON schema (OpenAI, or Groq's OpenAI-compatible endpoint). */
export class OpenAINotes implements LLMProvider {
  readonly isHeuristic = false;
  constructor(
    private apiKey: string,
    private model: string,
    private baseUrl = 'https://api.openai.com/v1',
    readonly id = 'openai',
    readonly label = 'OpenAI',
  ) {}
  async generateNotes(req: NotesRequest): Promise<NotesJSON> {
    const schema = z.toJSONSchema(NotesSchema) as any;
    delete schema.$schema;
    // Free tiers rate-limit per minute; wait as instructed (briefly) and retry a couple of times.
    for (let attempt = 0; ; attempt++) {
      const res = await this.request(req, schema);
      if (res.status === 429 && attempt < 2) {
        const wait = Number(res.headers.get('retry-after')) || 10;
        if (wait <= 60) {
          await sleep(wait * 1000);
          continue;
        }
      }
      if (!res.ok) throw new Error(`${this.label} notes failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
      const data: any = await res.json();
      return NotesSchema.parse(JSON.parse(data.choices[0].message.content));
    }
  }
  private request(req: NotesRequest, schema: unknown) {
    return fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(req) },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'meeting_notes', strict: true, schema } },
        // gpt-oss reasoning tokens count against Groq's free-tier token limits; keep them low.
        ...(this.model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low', include_reasoning: false } : {}),
      }),
    });
  }
}
