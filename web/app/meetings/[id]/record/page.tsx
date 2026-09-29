import { notFound } from 'next/navigation';
import AppShell from '@/components/AppShell';
import ProviderBanner from '@/components/ProviderBanner';
import Recorder from './Recorder';
import { requireMeeting } from '@/lib/meetings';

export const dynamic = 'force-dynamic';

export default async function RecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell>
      {async (user) => {
        const m = await requireMeeting(user, id).catch(() => null);
        if (!m) notFound();
        return (
          <div className="stack">
            <ProviderBanner />
            <Recorder
              meeting={{
                id: m.id, title: m.title, mode: m.mode, status: m.status, start_time: m.start_time, duration_seconds: m.duration_seconds,
                timezone: m.timezone, transcription_provider: m.transcription_provider, speaker_map: m.speaker_map, meeting_type: m.meeting_type,
              }}
            />
          </div>
        );
      }}
    </AppShell>
  );
}
