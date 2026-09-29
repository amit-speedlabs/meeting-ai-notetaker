import 'server-only';
import { Document, Packer, Paragraph, HeadingLevel, TextRun, Table, TableRow, TableCell, WidthType } from 'docx';
import { PDFDocument, StandardFonts, rgb, PDFFont } from 'pdf-lib';
import type { Report } from './report';

export async function toDocx(r: Report): Promise<Buffer> {
  const bullets = (xs: string[]) => (xs.length ? xs : ['None']).map((x) => new Paragraph({ text: x, bullet: { level: 0 } }));
  const h = (t: string) => new Paragraph({ text: t, heading: HeadingLevel.HEADING_2 });
  const kv = (k: string, v: string) => new Paragraph({ children: [new TextRun({ text: `${k}: `, bold: true }), new TextRun(v)] });
  const cell = (t: string, bold = false) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: t, bold })] })] });
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: ['Action', 'Owner', 'Deadline', 'Status'].map((t) => cell(t, true)) }),
      ...(r.actions.length ? r.actions : [{ task: 'None', owner: '', deadline: '', status: '' }]).map(
        (a) => new TableRow({ children: [cell(a.task), cell(a.owner), cell(a.deadline), cell(a.status)] }),
      ),
    ],
  });
  const children: any[] = [
    new Paragraph({ text: `Meeting Summary${r.isDemo ? ' (DEMO DATA)' : ''}`, heading: HeadingLevel.TITLE }),
    kv('Meeting', r.title), kv('Type', r.type), kv('Date', r.date), kv('Duration', r.duration),
    kv('Participants', r.participants.join(', ') || '—'),
    h('Executive Summary'), new Paragraph(r.summary || '—'),
    h('Key Discussion Points'), ...bullets(r.keyPoints),
    h('Decisions Made'), ...bullets(r.decisions),
    h('Action Items'), table,
    h('Open Questions'), ...bullets(r.openQuestions),
    h('Risks / Blockers'), ...bullets(r.risks),
    h('Important Numbers'), ...bullets(r.numbers),
    h('Next Steps'), ...bullets(r.nextSteps),
  ];
  if (r.transcript.length) {
    children.push(h('Transcript'));
    for (const t of r.transcript) children.push(new Paragraph({ children: [new TextRun({ text: `[${t.time}] ${t.speaker}: `, bold: true }), new TextRun(t.text)] }));
  }
  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}

export async function toPdf(r: Report): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595, H = 842, M = 50, maxW = W - 2 * M;
  let page = pdf.addPage([W, H]);
  let y = H - M;
  // Standard PDF fonts are WinAnsi only; replace characters they cannot encode.
  const safe = (s: string) => s.replace(/[—–]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/•/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
  const write = (text: string, f: PDFFont = font, size = 10, indent = 0, color = rgb(0.1, 0.1, 0.1)) => {
    for (const line of wrap(safe(text), f, size, maxW - indent)) {
      if (y < M + size) {
        page = pdf.addPage([W, H]);
        y = H - M;
      }
      page.drawText(line, { x: M + indent, y, size, font: f, color });
      y -= size * 1.45;
    }
  };
  const gap = (n = 6) => (y -= n);
  const section = (title: string, items: string[]) => {
    gap(8);
    write(title, bold, 13);
    gap(2);
    for (const it of items.length ? items : ['None']) write(`- ${it}`, font, 10, 8);
  };
  write(`Meeting Summary${r.isDemo ? ' (DEMO DATA)' : ''}`, bold, 20);
  gap(6);
  for (const [k, v] of [['Meeting', r.title], ['Type', r.type], ['Date', r.date], ['Duration', r.duration], ['Participants', r.participants.join(', ') || '-']])
    write(`${k}: ${v}`, font, 10);
  gap(8);
  write('Executive Summary', bold, 13);
  write(r.summary || '-');
  section('Key Discussion Points', r.keyPoints);
  section('Decisions Made', r.decisions);
  section('Action Items', r.actions.map((a) => `${a.task} | Owner: ${a.owner} | Deadline: ${a.deadline} | ${a.status}`));
  section('Open Questions', r.openQuestions);
  section('Risks / Blockers', r.risks);
  section('Important Numbers', r.numbers);
  section('Next Steps', r.nextSteps);
  if (r.transcript.length) section('Transcript', r.transcript.map((t) => `[${t.time}] ${t.speaker}: ${t.text}`));
  return pdf.save();
}

function wrap(text: string, f: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let cur = '';
    for (const word of para.split(' ')) {
      const next = cur ? `${cur} ${word}` : word;
      if (f.widthOfTextAtSize(next, size) > width && cur) {
        lines.push(cur);
        cur = word;
      } else cur = next;
    }
    lines.push(cur);
  }
  return lines;
}
