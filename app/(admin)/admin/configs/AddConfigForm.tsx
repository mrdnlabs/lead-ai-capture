'use client';

import { useActionState, useState } from 'react';
import type { ProviderCredential } from '@/db/schema';
import { addConfig, type ActionResult } from './actions';

const KINDS = [
  { value: 'transcription', label: 'Transcription (audio → text)' },
  { value: 'vision', label: 'Vision (image → fields)' },
  { value: 'extraction', label: 'Extraction (text → fields)' },
  { value: 'realtime', label: 'Realtime (live voice conversation)' },
] as const;

const MODEL_HINTS: Record<string, string[]> = {
  'openai|transcription': ['gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1'],
  'openai|realtime': ['gpt-realtime'],
  'gemini|transcription': ['gemini-2.5-flash', 'gemini-3.1-flash'],
  'gemini|vision': ['gemini-2.5-flash', 'gemini-3.1-flash', 'gemini-2.5-pro'],
  'gemini|extraction': ['gemini-2.5-flash', 'gemini-3.1-flash', 'gemini-2.5-pro'],
  'gemini|realtime': ['gemini-3.1-flash-live', 'gemini-2.5-flash-live'],
  'anthropic|vision': ['claude-opus-4-7', 'claude-sonnet-4-6'],
  'anthropic|extraction': ['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5-20251001'],
  'deepgram|transcription': ['nova-3'],
  'google_stt|transcription': ['chirp_3'],
};

export function AddConfigForm({ credentials }: { credentials: ProviderCredential[] }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(addConfig, null);
  const [provider, setProvider] = useState('gemini');
  const [kind, setKind] = useState('transcription');

  const eligibleCredentials = credentials.filter((c) => c.provider === provider && c.isActive);
  const modelHints = MODEL_HINTS[`${provider}|${kind}`] ?? [];

  return (
    <form action={action} className="mt-4 grid gap-3 sm:grid-cols-2">
      <div>
        <label className="block text-xs font-medium text-neutral-600">Kind</label>
        <select
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        >
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-neutral-600">Provider</label>
        <select
          name="provider"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        >
          <option value="gemini">Gemini</option>
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="deepgram">Deepgram</option>
          <option value="google_stt">Google STT</option>
        </select>
      </div>

      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-neutral-600">
          Credential
          {eligibleCredentials.length === 0 ? (
            <span className="ml-2 text-red-600">
              No active {provider} credentials. Add one at{' '}
              <a className="underline" href="/admin/providers">
                /admin/providers
              </a>
              .
            </span>
          ) : null}
        </label>
        <select
          name="credentialId"
          required
          disabled={eligibleCredentials.length === 0}
          className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm disabled:bg-neutral-100"
        >
          {eligibleCredentials.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label} (…{c.last4})
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-neutral-600">Model</label>
        <input
          name="model"
          required
          list="model-hints"
          placeholder={modelHints[0] ?? 'model-id'}
          className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm"
        />
        <datalist id="model-hints">
          {modelHints.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </div>

      <div>
        <label className="block text-xs font-medium text-neutral-600">Label</label>
        <input
          name="label"
          required
          maxLength={120}
          placeholder="e.g. Gemini default"
          className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-neutral-600">
          Default instructions (optional — guides the model)
        </label>
        <textarea
          name="defaultInstructions"
          rows={3}
          maxLength={2000}
          placeholder="Leave blank to use built-in defaults. Override here for show-specific tone or constraints."
          className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="flex items-center gap-2 sm:col-span-2">
        <input id="isDefault" name="isDefault" type="checkbox" className="rounded border-neutral-300" />
        <label htmlFor="isDefault" className="text-sm text-neutral-700">
          Mark as default for this kind (only one default per kind)
        </label>
      </div>

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={pending || eligibleCredentials.length === 0}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Add config'}
        </button>
        {state && !state.ok ? <span className="ml-3 text-sm text-red-600">{state.error}</span> : null}
        {state?.ok ? <span className="ml-3 text-sm text-green-700">Saved.</span> : null}
      </div>
    </form>
  );
}
