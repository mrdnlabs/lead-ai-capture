'use client';

import { useActionState } from 'react';
import { addCredential, type ActionResult } from './actions';

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  google_stt: 'Google Cloud Speech-to-Text',
  deepgram: 'Deepgram',
  anthropic: 'Anthropic',
};

export function AddCredentialForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    addCredential,
    null,
  );

  return (
    <form action={action} className="mt-4 grid gap-3 sm:grid-cols-[180px_1fr_1fr_auto]">
      <div>
        <label className="block text-xs font-medium text-neutral-600" htmlFor="provider">
          Provider
        </label>
        <select
          id="provider"
          name="provider"
          required
          defaultValue="openai"
          className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm shadow-sm focus:border-neutral-900 focus:outline-none"
        >
          {Object.entries(PROVIDER_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-neutral-600" htmlFor="label">
          Label
        </label>
        <input
          id="label"
          name="label"
          type="text"
          required
          maxLength={120}
          placeholder="e.g. OpenAI Production"
          className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm shadow-sm focus:border-neutral-900 focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-neutral-600" htmlFor="apiKey">
          API key
        </label>
        <input
          id="apiKey"
          name="apiKey"
          type="password"
          required
          autoComplete="off"
          placeholder="sk-..."
          className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm shadow-sm focus:border-neutral-900 focus:outline-none"
        />
      </div>

      <div className="flex items-end">
        <button
          type="submit"
          disabled={pending}
          className="block w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 sm:w-auto"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>

      {state && !state.ok ? (
        <p className="text-sm text-red-600 sm:col-span-4">{state.error}</p>
      ) : null}
      {state?.ok ? (
        <p className="text-sm text-green-700 sm:col-span-4">
          Credential added. The raw key is encrypted at rest and not retrievable.
        </p>
      ) : null}
    </form>
  );
}
