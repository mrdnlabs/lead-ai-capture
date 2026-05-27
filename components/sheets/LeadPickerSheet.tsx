'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { OpCode } from '@/components/ui/OpCode';

export interface PickedLead {
  opportunityCode: string;
  name?: string;
  company?: string;
}

interface LeadPickerSheetProps {
  open: boolean;
  onClose: () => void;
  showSlug: string;
  onPick: (lead: PickedLead) => void;
}

interface RecentLeadEntry {
  opportunityCode: string;
  name?: string;
  company?: string;
  title?: string;
}

function initialsFromName(name?: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function LeadPickerSheet({ open, onClose, showSlug, onPick }: LeadPickerSheetProps) {
  const [recent, setRecent] = useState<RecentLeadEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch(`/api/shows/${encodeURIComponent(showSlug)}/leads/recent`, {
      credentials: 'same-origin',
    })
      .then((r) => (r.ok ? r.json() : { leads: [] }))
      .then((body: { leads: RecentLeadEntry[] }) => setRecent(body.leads ?? []))
      .catch(() => setRecent([]))
      .finally(() => setLoading(false));
  }, [open, showSlug]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recent;
    return recent.filter((l) => {
      return (
        l.name?.toLowerCase().includes(q) ||
        l.company?.toLowerCase().includes(q) ||
        l.opportunityCode.toLowerCase().includes(q)
      );
    });
  }, [recent, query]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add to existing"
      subtitle="This capture will be merged into the lead you pick."
    >
      <div className="search-input mb-3">
        <Search size={16} className="text-ink-4" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, company, or code…"
        />
      </div>

      <div className="t-eyebrow mb-2">Recent · this booth</div>

      {loading ? (
        <div className="t-tiny px-3 py-4">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="t-tiny px-3 py-4">
          {recent.length === 0
            ? 'No leads captured for this show yet.'
            : 'No leads match your search.'}
        </div>
      ) : (
        filtered.map((l) => (
          <div
            key={l.opportunityCode}
            className="pick-row"
            role="button"
            tabIndex={0}
            onClick={() =>
              onPick({
                opportunityCode: l.opportunityCode,
                name: l.name,
                company: l.company,
              })
            }
          >
            <div className="w-9 h-9 rounded-[10px] bg-paper-2 text-ink-2 flex items-center justify-center flex-shrink-0 font-semibold text-[13px]">
              {initialsFromName(l.name)}
            </div>
            <div className="mid">
              <div className="nm">{l.name ?? '(unnamed)'}</div>
              <div className="sub">
                {l.company ?? '—'}
                <span className="mx-1.5 text-ink-5">·</span>
                <OpCode code={l.opportunityCode} className="text-[11px]" />
              </div>
            </div>
          </div>
        ))
      )}
    </Sheet>
  );
}
