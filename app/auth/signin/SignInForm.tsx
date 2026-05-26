'use client';

import { useActionState } from 'react';
import { useSearchParams } from 'next/navigation';
import { sendMagicLink, type SignInResult } from './actions';

const initial: SignInResult | null = null;

export function SignInForm() {
  const params = useSearchParams();
  const next = params.get('next') ?? '/';
  const errorParam = params.get('error');
  const [state, action, pending] = useActionState<SignInResult | null, FormData>(
    async (_prev, formData) => sendMagicLink(formData),
    initial,
  );

  if (state?.ok) {
    return (
      <div className="mt-8 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
        Check <strong>{state.email}</strong> for a sign-in link.
      </div>
    );
  }

  return (
    <form action={action} className="mt-8 space-y-3">
      <input type="hidden" name="next" value={next} />
      <label className="block text-sm font-medium" htmlFor="email">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoFocus
        autoComplete="email"
        placeholder="you@company.com"
        className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm shadow-sm focus:border-neutral-900 focus:outline-none"
      />
      {state && !state.ok ? <p className="text-sm text-red-600">{state.error}</p> : null}
      {errorParam ? <p className="text-sm text-red-600">{errorParam}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="block w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {pending ? 'Sending…' : 'Send magic link'}
      </button>
    </form>
  );
}
