// Stand-in for an OpenAI-compatible API (Groq / OpenAI) used by tests/e2e/free-stack.spec.ts.
// It checks request shape, answers with canned data, and records what it received at GET /__log.
// The first chat request gets a 429 with retry-after: 1 to exercise the retry path.
import http from 'node:http';

const port = Number(process.env.PORT || 4010);
const log = [];
let chatCalls = 0;

const notes = {
  summary: 'The team agreed the budget review and assigned the report.',
  discussion_points: ['Budget review'],
  decisions: ['Use the revised budget'],
  action_items: [{ task: 'Send the budget report', owner: 'Priya', deadline_text: 'by Friday', source_quote: 'Priya will send the budget report by Friday.' }],
  open_questions: [],
  risks: [],
  follow_ups: [],
  important_numbers: [],
  topics: ['Budget'],
  next_steps: ['Priya sends the report'],
};

http
  .createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const send = (status, obj, headers = {}) => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
        res.end(JSON.stringify(obj));
      };
      if (req.method === 'GET' && req.url === '/__log') return send(200, log);
      const auth = req.headers.authorization;
      if (req.url.endsWith('/audio/transcriptions')) {
        const text = body.toString('latin1');
        const model = /name="model"\r\n\r\n([^\r]+)/.exec(text)?.[1];
        const format = /name="response_format"\r\n\r\n([^\r]+)/.exec(text)?.[1];
        log.push({ path: req.url, auth, model, format, bytes: body.length });
        return send(200, {
          text: 'Priya will send the budget report by Friday.',
          segments: [{ start: 0.5, end: 3.2, text: ' Priya will send the budget report by Friday.', avg_logprob: -0.1 }],
        });
      }
      if (req.url.endsWith('/chat/completions')) {
        const j = JSON.parse(body.toString('utf8'));
        chatCalls++;
        log.push({ path: req.url, auth, model: j.model, reasoning_effort: j.reasoning_effort, include_reasoning: j.include_reasoning, strict: j.response_format?.json_schema?.strict, call: chatCalls });
        if (chatCalls === 1) return send(429, { error: { message: 'rate limited' } }, { 'retry-after': '1' });
        return send(200, { choices: [{ message: { content: JSON.stringify(notes) } }] });
      }
      send(404, { error: 'not found' });
    });
  })
  .listen(port, () => console.log(`fake OpenAI-compatible API on :${port}`));
