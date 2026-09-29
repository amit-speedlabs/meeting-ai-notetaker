import { z } from 'zod';
import { after } from 'next/server';
import { route, json, preflight } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { requireMeeting } from '@/lib/meetings';
import { appendText } from '@/lib/ingest';
import { runIncremental } from '@/lib/notes-engine';

type Ctx = { params: Promise<{ id: string }> };
export const OPTIONS = preflight;

/** Paginated transcript; with ?q= returns matching segments (in-meeting search). ?around=seq centres a page on a segment. */
export const GET = route(async (req, { params }: Ctx) => {
  const u = await requireUser();
  const m = await requireMeeting(u, (await params).id);
  const s = new URL(req.url).searchParams;
  const limit = Math.min(Number(s.get('limit')) || 200, 500);
  const search = s.get('q')?.trim();
  if (search) {
    const rows = await q(
      `select seq, offset_ms, speaker, text, confidence,
         ts_headline('english', text, plainto_tsquery('english', $2), 'StartSel=«, StopSel=», HighlightAll=true') as highlight
       from transcript_segments where meeting_id = $1 and (tsv @@ plainto_tsquery('english', $2) or text ilike '%' || $2 || '%')
       order by seq limit $3`,
      [m.id, search, limit],
    );
    return json({ results: rows });
  }
  let after_ = Number(s.get('after') ?? -1);
  const around = s.get('around');
  if (around !== null) {
    const r = await q<{ seq: number }>(
      `select seq from transcript_segments where meeting_id = $1 and seq < $2 order by seq desc offset $3 limit 1`,
      [m.id, Number(around), Math.floor(limit / 4)],
    );
    after_ = r[0] ? r[0].seq - 1 : -1;
  }
  const rows = await q(
    `select seq, offset_ms, speaker, text, confidence from transcript_segments where meeting_id = $1 and seq > $2 order by seq limit $3`,
    [m.id, after_, limit + 1],
  );
  const total = await q<{ n: number }>('select count(*)::int as n from transcript_segments where meeting_id = $1', [m.id]);
  return json({ segments: rows.slice(0, limit), hasMore: rows.length > limit, total: total[0].n });
});

const Append = z.object({
  items: z.array(z.object({ seq: z.number().int().min(0), offsetMs: z.number().int().min(0), text: z.string().max(5000), confidence: z.number().min(0).max(1).nullable() })).max(100),
});

/** Text transcribed in the browser (Web Speech API mode). */
export const POST = route(async (req, { params }: Ctx) => {
  const u = await requireUser();
  const m = await requireMeeting(u, (await params).id);
  const b = Append.parse(await req.json());
  const rows = await appendText(m, b.items);
  if (rows.length) after(() => runIncremental(m.id));
  return json({ segments: rows });
});

// Long AI/transcription calls and after() work run inside this budget (Vercel Hobby max).
export const maxDuration = 300;
