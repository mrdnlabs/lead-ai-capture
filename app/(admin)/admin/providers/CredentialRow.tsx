'use client';

import { useTransition } from 'react';
import { deleteCredential, setActive } from './actions';

interface Props {
  id: string;
  isActive: boolean;
}

export function CredentialActions({ id, isActive }: Props) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await setActive(id, !isActive);
          })
        }
        className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
      >
        {isActive ? 'Disable' : 'Enable'}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm('Delete this credential? Configs using it will block the delete.')) return;
          startTransition(async () => {
            const result = await deleteCredential(id);
            if (!result.ok) alert(result.error);
          });
        }}
        className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        Delete
      </button>
    </div>
  );
}
