import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Meeting AI Notetaker', description: 'Capture, transcribe and organise meetings' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
