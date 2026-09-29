import { route, HttpError, json } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { requireMeeting, logActivity } from '@/lib/meetings';
import { loadReport, toMarkdown, toText, actionsText } from '@/lib/report';
import { toDocx, toPdf } from '@/lib/export-binary';

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (req, { params }: Ctx) => {
  const u = await requireUser();
  const m = await requireMeeting(u, (await params).id);
  const s = new URL(req.url).searchParams;
  const format = s.get('format') || 'md';
  const report = await loadReport(m, { includeTranscript: s.get('transcript') === '1' });
  const base = m.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'meeting';
  const file = (body: BodyInit, type: string, ext: string) =>
    new Response(body, { headers: { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${base}.${ext}"` } });
  if (format !== 'copy' && format !== 'copy-actions') await logActivity(m.id, u.id, 'exported', { format });
  switch (format) {
    case 'md':
      return file(toMarkdown(report), 'text/markdown; charset=utf-8', 'md');
    case 'txt':
      return file(toText(report), 'text/plain; charset=utf-8', 'txt');
    case 'docx':
      return file(new Uint8Array(await toDocx(report)), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx');
    case 'pdf':
      return file(new Uint8Array(await toPdf(report)), 'application/pdf', 'pdf');
    case 'copy':
      return json({ text: toMarkdown(report) });
    case 'copy-actions':
      return json({ text: actionsText(report) });
    default:
      throw new HttpError(400, 'Unknown format');
  }
});

// Long AI/transcription calls and after() work run inside this budget (Vercel Hobby max).
export const maxDuration = 300;
