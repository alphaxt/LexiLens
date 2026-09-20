'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../auth-provider';

export default function OidcCallbackPage() {
  const router = useRouter();
  const { completeLogin, error } = useAuth();
  useEffect(() => {
    void completeLogin().then(
      () => router.replace('/'),
      () => undefined,
    );
  }, [completeLogin, router]);
  return (
    <main className="auth-screen">
      <h1>Completing sign-in</h1>
      <p>{error ?? 'Please wait while we verify your sign-in response.'}</p>
    </main>
  );
}
