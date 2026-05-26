'use client';

import { useTransition } from 'react';
import { deleteConfig, setDefault } from './actions';

interface Props {
  id: string;
  isDefault: boolean;
}

export function ConfigActions({ id, isDefault }: Props) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex justify-end gap-2">
      {!isDefault ? (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await setDefault(id);
              if (!r.ok) alert(r.error);
            })
          }
          className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
        >
          Make default
        </button>
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm('Delete this config?')) return;
          startTransition(async () => {
            const r = await deleteConfig(id);
            if (!r.ok) alert(r.error);
          });
        }}
        className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        Delete
      </button>
    </div>
  );
}
