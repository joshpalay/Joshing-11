import { Suspense } from 'react';

import LoginPanel from './LoginPanel';

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
      <Suspense fallback={<div className="h-72 w-full max-w-sm rounded-lg border bg-card" />}>
        <LoginPanel />
      </Suspense>
    </main>
  );
}
