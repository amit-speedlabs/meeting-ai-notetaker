import AppShell from '@/components/AppShell';
import ActionDashboard from './ActionDashboard';

export const dynamic = 'force-dynamic';

export default function ActionsPage() {
  return <AppShell>{() => <ActionDashboard />}</AppShell>;
}
