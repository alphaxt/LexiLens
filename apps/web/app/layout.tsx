import type { Metadata } from 'next';
import { AuthProvider } from './auth-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'LexiLens | Document X-Ray',
  description: 'Evidence-first document intelligence for consumers.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
