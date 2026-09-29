'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { idbAll } from '@/lib/client/upload-queue';

type M = { id: string; title: string; mode: string; status: string };

/** Surfaces meetings that were interrupted (tab closed, crash) and audio still queued in this browser. */
export default function RecoveryBanner({ interrupted }: { interrupted: M[] }) {
  const [queued, setQueued] = useState<Record<string, number>>({});
  useEffect(() => {
    idbAll()
      .then((items) => {
        const c: Record<string, number> = {};
        for (const i of items) c[i.meetingId] = (c[i.meetingId] || 0) + 1;
        setQueued(c);
      })
      .catch(() => {});
  }, []);
  const ids = new Set([...interrupted.map((m) => m.id), ...Object.keys(queued)]);
  if (!ids.size) return null;
  return (
    <div className="alert warn" data-testid="recovery-banner">
      <b>Interrupted meeting{ids.size > 1 ? 's' : ''} found.</b> The transcript saved so far is safe on the server
      {Object.keys(queued).length ? ', and some audio is still stored in this browser waiting to upload' : ''}.
      <ul className="clean">
        {[...ids].map((id) => {
          const m = interrupted.find((x) => x.id === id);
          return (
            <li key={id}>
              {m?.title || 'Meeting'} {queued[id] ? <span className="small">({queued[id]} audio segment(s) queued locally)</span> : null}{' '}
              <Link href={`/meetings/${id}/record?recover=1`}>Recover</Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
