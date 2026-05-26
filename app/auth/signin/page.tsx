import { Suspense } from 'react';
import { SignInForm } from './SignInForm';

export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in to AI Capture</h1>
      <p className="mt-2 text-sm text-neutral-500">We&rsquo;ll email you a magic link.</p>
      <Suspense fallback={<div className="mt-8 text-sm text-neutral-400">Loading…</div>}>
        <SignInForm />
      </Suspense>
    </main>
  );
}
