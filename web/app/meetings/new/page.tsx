import AppShell from '@/components/AppShell';
import ProviderBanner from '@/components/ProviderBanner';
import NewMeetingForm from './NewMeetingForm';
import { MEETING_TYPES } from '@/lib/meetings';
import { transcriptionProviderInfo } from '@/lib/transcription';
import { one } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function NewMeeting({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const sp = await searchParams;
  const mode = sp.mode === 'upload' ? 'upload' : 'offline';
  const tp = transcriptionProviderInfo();
  return (
    <AppShell>
      {async (user) => {
        const settings = await one('select store_audio, retention_days from user_settings where user_id = $1', [user.id]);
        return (
          <div className="stack" style={{ maxWidth: 760 }}>
            <h1>{mode === 'upload' ? 'Upload Meeting Recording' : 'Start Offline Meeting'}</h1>
            <ProviderBanner />
            <NewMeetingForm
              mode={mode}
              types={MEETING_TYPES}
              server={{ id: tp.id, label: tp.label, ready: tp.ready, isDemo: tp.isDemo, thirdParty: tp.sendsAudioToThirdParty }}
              storeAudio={settings?.store_audio ?? true}
              retentionDays={settings?.retention_days ?? null}
            />
          </div>
        );
      }}
    </AppShell>
  );
}
