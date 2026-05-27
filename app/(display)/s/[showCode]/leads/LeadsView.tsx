'use client';

import { useMemo, useState } from 'react';
import { ArrowLeft, Download, Plus } from 'lucide-react';
import { OpCode } from '@/components/ui/OpCode';

export interface LeadCardData {
  opportunityCode: string;
  name: string;
  company?: string;
  title?: string;
  email?: string;
  phone?: string;
  interest?: string;
  missingFields: string[];
  captureCount: number;
  lastUpdatedAt: string;
  avgConfidence: number;
  isMine: boolean;
  repInitials: string[];
}

interface Props {
  showSlug: string;
  showName: string;
  leads: LeadCardData[];
}

type FilterKey = 'all' | 'today' | 'missing' | 'high' | 'mine';

function ageOf(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function confidenceDotClass(c: number): string {
  if (c >= 0.85) return 'bg-ok';
  if (c >= 0.6) return 'bg-warn';
  return 'bg-ink-5';
}

export function LeadsView({ showSlug, showName, leads }: Props) {
  const [filter, setFilter] = useState<FilterKey>('all');

  const filtered = useMemo(() => {
    const dayAgo = Date.now() - 86_400_000;
    return leads.filter((l) => {
      if (filter === 'today') return new Date(l.lastUpdatedAt).getTime() >= dayAgo;
      if (filter === 'missing') return l.missingFields.length > 0;
      if (filter === 'high') return /high/i.test(l.interest ?? '');
      if (filter === 'mine') return l.isMine;
      return true;
    });
  }, [leads, filter]);

  const totalMissing = leads.reduce((n, l) => n + l.missingFields.length, 0);

  const filterChips: Array<{ key: FilterKey; label: string; count?: number }> = [
    { key: 'all', label: `All`, count: leads.length },
    { key: 'today', label: `Today` },
    { key: 'missing', label: `Missing fields` },
    { key: 'high', label: `High intent` },
    { key: 'mine', label: `Mine` },
  ];

  return (
    <div className="scr">
      <div className="scr-top">
        <a
          href={`/s/${showSlug}/capture`}
          className="icon-btn"
          style={{ width: 36, height: 36, borderRadius: 10 }}
          aria-label="Back to capture"
        >
          <ArrowLeft size={18} />
        </a>
        <div className="row gap-2">
          <a
            href={`/api/shows/${showSlug}/export.csv`}
            className="icon-btn"
            style={{ width: 36, height: 36, borderRadius: 10 }}
            aria-label="Export CSV"
          >
            <Download size={18} />
          </a>
        </div>
      </div>

      <div className="scr-body">
        <div className="mb-4">
          <div className="t-eyebrow">{showName}</div>
          <h1 className="t-title mt-1.5">Leads</h1>
          <div className="t-meta mt-1">
            {leads.length} · {totalMissing} missing field{totalMissing === 1 ? '' : 's'}
          </div>
        </div>

        <div className="filter-row mb-4">
          {filterChips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setFilter(c.key)}
              className={`filter-chip ${filter === c.key ? 'is-active' : ''}`}
            >
              {c.label}
              {typeof c.count === 'number' ? <span className="ml-1 opacity-60">·</span> : null}
              {typeof c.count === 'number' ? <span>{c.count}</span> : null}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="card-flat text-center text-sm text-ink-3 py-10">
            {leads.length === 0
              ? 'No leads captured yet.'
              : 'No leads match this filter.'}
          </div>
        ) : (
          <div className="col gap-2.5">
            {filtered.map((l) => (
              <article key={l.opportunityCode} className="lead-card">
                <div className="hd">
                  <div className="min-w-0 flex-1">
                    <div className="name truncate">{l.name}</div>
                    <div className="co truncate">
                      {[l.title, l.company].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <OpCode code={l.opportunityCode} className="text-[11px] text-ink-3" />
                </div>

                {l.interest || l.missingFields.length > 0 ? (
                  <div className="row gap-1.5 flex-wrap">
                    {l.interest ? (
                      <span
                        className={`chip ${/high/i.test(l.interest) ? 'chip-intent' : ''}`}
                      >
                        intent · {l.interest}
                      </span>
                    ) : null}
                    {l.missingFields.slice(0, 3).map((m) => (
                      <span key={m} className="chip chip-missing">
                        {m}
                      </span>
                    ))}
                    {l.missingFields.length > 3 ? (
                      <span className="chip chip-missing">
                        +{l.missingFields.length - 3} more
                      </span>
                    ) : null}
                  </div>
                ) : null}

                <div className="footer">
                  <span
                    className={`dot inline-block w-2 h-2 rounded-full ${confidenceDotClass(l.avgConfidence)}`}
                    aria-hidden
                  />
                  <span className="t-tiny">
                    {l.captureCount} capture{l.captureCount === 1 ? '' : 's'}
                  </span>
                  <span className="t-tiny opacity-60">·</span>
                  <span className="t-tiny">{ageOf(l.lastUpdatedAt)}</span>
                  <span className="by ml-auto">
                    {l.repInitials.join(' / ')}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="scr-foot">
        <a
          href={`/s/${showSlug}/capture`}
          className="btn btn-accent btn-block"
        >
          <Plus size={18} />
          New capture
        </a>
      </div>
    </div>
  );
}
