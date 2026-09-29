/**
 * Creates clearly-labelled DEMO meetings (internal, school, project). Usage:
 *   npm run seed                      -> demo user demo@example.com / demo12345
 *   npm run seed -- you@company.com   -> adds demo meetings to an existing account
 */
import crypto from 'node:crypto';
import { Client } from 'pg';
import { resolveDeadline } from '../lib/deadline';

type Line = [number, string, string]; // seconds offset, speaker label, text
type Demo = {
  title: string; type: string; daysAgo: number; hour: number; minutes: number; speakers: Record<string, string>;
  participants: [string, string, string][]; lines: Line[];
  notes: { summary: string; key_points: string[]; decisions: string[]; open_questions: string[]; risks: string[]; follow_ups: string[]; important_numbers: string[]; topics: string[]; next_steps: string[] };
  actions: [string, string, string, string][]; // task, owner, deadline phrase, status
};

const DEMOS: Demo[] = [
  {
    title: 'AI Olympiad Planning Meeting', type: 'Internal Meeting', daysAgo: 0, hour: 10, minutes: 48,
    speakers: { 'Speaker 1': 'Amit', 'Speaker 2': 'Vivek', 'Speaker 3': 'Praveen' },
    participants: [['Amit', 'amit@example.com', 'SpeedLabs'], ['Vivek', 'vivek@example.com', 'SpeedLabs'], ['Praveen', 'praveen@example.com', 'SpeedLabs']],
    lines: [
      [0, 'Speaker 1', "Let's get started. We need to finalise the AI Olympiad school outreach plan by Friday."],
      [14, 'Speaker 2', "Let's target the pending schools first, especially where kits have already been distributed."],
      [27, 'Speaker 3', 'So far we have contacted 240 schools, 180 kits are distributed and 120 schools have registered.'],
      [45, 'Speaker 1', 'We need to close the Maharashtra school list today.'],
      [61, 'Speaker 3', 'I will share the updated state-wise list by 6 PM.'],
      [80, 'Speaker 2', 'Registration numbers for Gujarat are still not confirmed. That is an open question.'],
      [96, 'Speaker 1', 'Agreed, we will use the CoE channel for the selected schools.'],
      [115, 'Speaker 2', 'The risk is that some schools will not confirm before the registration deadline.'],
      [133, 'Speaker 1', 'Vivek, please follow up with the pending schools by tomorrow.'],
      [150, 'Speaker 3', 'We also need someone to update the registration tracker.'],
      [168, 'Speaker 1', 'School registration should be tracked weekly from now on.'],
      [185, 'Speaker 2', "Let's review progress before the next meeting."],
    ],
    notes: {
      summary: 'The team reviewed progress on the AI Olympiad school outreach. 240 schools have been contacted, 180 kits distributed and 120 schools registered. The group agreed to prioritise schools that already have kits and to route selected schools through the CoE channel. The Maharashtra list must close today, and Gujarat registration numbers are still unconfirmed. Follow-ups with pending schools and an updated state-wise list were assigned.',
      key_points: ['AI Olympiad school outreach plan', 'Pending schools where kits are distributed', 'Registration numbers by state', 'Maharashtra school list closure'],
      decisions: ['Finalise the outreach plan by Friday', 'Prioritise schools where kits have already been distributed', 'Use the CoE channel for selected schools', 'Track school registration weekly'],
      open_questions: ['Registration numbers for Gujarat are not confirmed'],
      risks: ['Some schools may not confirm before the registration deadline'],
      follow_ups: ['Follow up with pending schools'],
      important_numbers: ['240 schools contacted', '180 kits distributed', '120 schools registered'],
      topics: ['AI Olympiad', 'School outreach', 'Registrations', 'Kits'],
      next_steps: ['Praveen shares the state-wise list', 'Vivek follows up with pending schools', 'Review progress before the next meeting'],
    },
    actions: [
      ['Share updated state-wise school list', 'Praveen', 'by 6 PM', 'pending'],
      ['Follow up with the pending schools', 'Vivek', 'by tomorrow', 'in_progress'],
      ['Close the Maharashtra school list', 'Amit', 'today', 'pending'],
      ['Update the registration tracker', 'Unassigned', 'Not specified', 'pending'],
      ['Review outreach progress', 'Unassigned', 'before the next meeting', 'pending'],
    ],
  },
  {
    title: 'School Partnership Review — Pune Cluster', type: 'School Meeting', daysAgo: 1, hour: 15, minutes: 36,
    speakers: { 'Speaker 1': 'Neha', 'Speaker 2': 'Principal Rao' },
    participants: [['Neha', 'neha@example.com', 'SpeedLabs'], ['Principal Rao', '', 'Pune Public School']],
    lines: [
      [0, 'Speaker 1', 'Thank you for joining. We want to review how the AI lab kits are being used in the Pune cluster.'],
      [18, 'Speaker 2', 'Our students have completed 12 sessions and about 85 percent attendance so far.'],
      [36, 'Speaker 2', 'The main concern is that two kits have faulty sensors.'],
      [52, 'Speaker 1', 'I will arrange replacements for the faulty kits by next week.'],
      [70, 'Speaker 2', 'Can we get teacher training for the new robotics module? That is still unclear.'],
      [88, 'Speaker 1', "We have decided to run a teacher workshop in October for all cluster schools."],
      [104, 'Speaker 2', 'Please send the workshop agenda, Neha.'],
    ],
    notes: {
      summary: 'Review of AI lab kit usage at Pune Public School. Students have completed 12 sessions with about 85% attendance. Two kits have faulty sensors and replacements were committed. A teacher workshop for the robotics module will run in October for all cluster schools.',
      key_points: ['Kit usage and attendance', 'Faulty sensors in two kits', 'Teacher training for robotics module'],
      decisions: ['Run a teacher workshop in October for all cluster schools'],
      open_questions: ['Teacher training for the new robotics module — details unclear'],
      risks: ['Two kits have faulty sensors'],
      follow_ups: [],
      important_numbers: ['12 sessions completed', '85% attendance', '2 faulty kits'],
      topics: ['AI lab kits', 'Teacher training', 'Robotics module'],
      next_steps: ['Replace faulty kits', 'Send workshop agenda'],
    },
    actions: [
      ['Arrange replacements for the faulty kits', 'Neha', 'by next week', 'pending'],
      ['Send the teacher workshop agenda', 'Neha', 'Not specified', 'pending'],
    ],
  },
  {
    title: 'Notetaker V1 Project Sync', type: 'Project Meeting', daysAgo: 2, hour: 11, minutes: 52,
    speakers: { 'Speaker 1': 'Riya', 'Speaker 2': 'Karan' },
    participants: [['Riya', 'riya@example.com', 'SpeedLabs'], ['Karan', 'karan@example.com', 'SpeedLabs']],
    lines: [
      [0, 'Speaker 1', "Quick sync on the notetaker V1. Offline mode is working end to end."],
      [15, 'Speaker 2', 'The Chrome extension captures Meet tab audio; we still need to test on managed Chromebooks.'],
      [33, 'Speaker 1', "Let's go with Deepgram for diarization in the pilot."],
      [49, 'Speaker 2', 'I will write the deployment guide by Thursday.'],
      [66, 'Speaker 1', 'The risk is transcription cost for two hour meetings, so keep chunking on.'],
      [84, 'Speaker 2', 'We need to decide on audio retention defaults. Should it be 30 days?'],
    ],
    notes: {
      summary: 'Status sync on the Meeting AI Notetaker V1. Offline mode works end to end and the extension captures Meet tab audio, with managed Chromebooks still untested. The team chose Deepgram for the pilot and flagged transcription cost for long meetings. Audio retention defaults remain undecided.',
      key_points: ['Offline mode working', 'Extension testing on managed Chromebooks', 'Provider choice for diarization'],
      decisions: ['Use Deepgram for diarization in the pilot'],
      open_questions: ['Audio retention default — 30 days?'],
      risks: ['Transcription cost for two-hour meetings'],
      follow_ups: [],
      important_numbers: [],
      topics: ['Notetaker V1', 'Chrome extension', 'Deepgram', 'Retention'],
      next_steps: ['Write deployment guide', 'Test on managed Chromebooks'],
    },
    actions: [
      ['Write the deployment guide', 'Karan', 'by Thursday', 'completed'],
      ['Test the extension on managed Chromebooks', 'Unassigned', 'Not specified', 'pending'],
    ],
  },
];

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:5432/notetaker' });
  await c.connect();
  const email = (process.argv[2] || 'demo@example.com').toLowerCase();
  let user = (await c.query('select id from users where email = $1', [email])).rows[0];
  if (!user) {
    if (process.argv[2]) throw new Error(`No user with email ${email}. Sign up first.`);
    const salt = crypto.randomBytes(16);
    const key = crypto.scryptSync('demo12345', salt, 64, { N: 16384, r: 8, p: 1 });
    user = (await c.query('insert into users (email, name, password_hash) values ($1,$2,$3) returning id', [email, 'Amit (Demo)', `scrypt$${salt.toString('base64')}$${key.toString('base64')}`])).rows[0];
    console.log('created demo user demo@example.com / demo12345');
  }
  await c.query('insert into user_settings (user_id) values ($1) on conflict do nothing', [user.id]);
  await c.query('delete from meetings where created_by = $1 and is_demo = true', [user.id]);

  for (const d of DEMOS) {
    const start = new Date();
    start.setDate(start.getDate() - d.daysAgo);
    start.setHours(d.hour, 0, 0, 0);
    const end = new Date(start.getTime() + d.minutes * 60_000);
    const m = (await c.query(
      `insert into meetings (created_by, title, meeting_type, mode, status, transcription_status, start_time, end_time, duration_seconds, speaker_map,
         transcription_provider, llm_provider, is_demo, timezone, notes_cursor, notes_updated_at, store_audio)
       values ($1,$2,$3,'offline','COMPLETED','COMPLETED',$4,$5,$6,$7,'demo','demo',true,'Asia/Kolkata',$8, now(), false) returning id`,
      [user.id, `${d.title}`, d.type, start, end, d.minutes * 60, JSON.stringify(d.speakers), (d.lines.length - 1) * 1000],
    )).rows[0];
    for (const p of d.participants) await c.query('insert into participants (meeting_id, name, email, organisation) values ($1,$2,$3,$4)', [m.id, p[0], p[1] || null, p[2] || null]);
    for (let i = 0; i < d.lines.length; i++) {
      const [sec, spk, text] = d.lines[i];
      await c.query('insert into transcript_segments (meeting_id, seq, offset_ms, speaker, text, confidence) values ($1,$2,$3,$4,$5,$6)', [m.id, i * 1000, sec * 1000, spk, text, 0.9 + Math.random() * 0.09]);
    }
    const n = d.notes;
    await c.query(
      `insert into notes (meeting_id, summary, key_points, decisions, open_questions, risks, follow_ups, important_numbers, topics, next_steps, is_final, provider)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,'demo')`,
      [m.id, n.summary, ...[n.key_points, n.decisions, n.open_questions, n.risks, n.follow_ups, n.important_numbers, n.topics, n.next_steps].map((x) => JSON.stringify(x))],
    );
    const date = start.toISOString().slice(0, 10);
    for (const [task, owner, phrase, status] of d.actions) {
      const dl = resolveDeadline(phrase, date);
      await c.query('insert into action_items (meeting_id, task, owner, deadline_date, deadline_text, status, source) values ($1,$2,$3,$4,$5,$6,$7)', [m.id, task, owner, dl.date, dl.text, status, 'ai']);
    }
    await c.query(`insert into activity_log (meeting_id, kind, detail) values ($1, 'created', '{"demo": true}')`, [m.id]);
  }
  console.log(`seeded ${DEMOS.length} demo meetings for ${email}`);
  await c.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
