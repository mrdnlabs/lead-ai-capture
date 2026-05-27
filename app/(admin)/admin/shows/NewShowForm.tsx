'use client';

import { useActionState, useState } from 'react';
import { createShow, type CreateShowResult } from './actions';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function NewShowForm() {
  const [state, action, pending] = useActionState<CreateShowResult | null, FormData>(
    createShow,
    null,
  );
  const [name, setName] = useState('');
  const [slugManual, setSlugManual] = useState('');
  const slug = slugManual || slugify(name);

  return (
    <form action={action} className="mt-3 grid gap-3 sm:grid-cols-[1fr_180px_auto]">
      <div>
        <label className="block text-xs font-medium text-neutral-600">Name</label>
        <input
          name="name"
          required
          maxLength={120}
          placeholder="e.g. AcmeConf 2026"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-600">Slug (URL)</label>
        <input
          name="slug"
          required
          maxLength={60}
          placeholder="acmeconf-2026"
          value={slug}
          onChange={(e) => setSlugManual(e.target.value)}
          className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-xs"
        />
      </div>
      <div className="flex items-end">
        <button
          type="submit"
          disabled={pending || !name}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? 'Creating…' : 'Create show'}
        </button>
      </div>
      {state && !state.ok ? (
        <p className="text-sm text-red-600 sm:col-span-3">{state.error}</p>
      ) : null}
    </form>
  );
}
