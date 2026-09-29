import { notFound } from 'next/navigation';
import AppShell from '@/components/AppShell';
import MeetingDetail from './MeetingDetail';
import { requireMeeting, MEETING_TYPES } from '@/lib/meetings';

export const dynamic = 'force-dynamic';

export default async function MeetingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; seq?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  return (
    <AppShell>
      {async (user) => {
        const m = await requireMeeting(user, id).catch(() => null);
        if (!m) notFound();
        return <MeetingDetail id={m.id} initialTab={sp.tab || 'overview'} jumpSeq={sp.seq ? Number(sp.seq) : null} types={MEETING_TYPES} />;
      }}
    </AppShell>
  );
}
