'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronRight, QrCode } from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { LivePill } from '@/components/ui/LivePill';
import { ShowSwatch } from '@/components/ui/ShowSwatch';
import { OpCode } from '@/components/ui/OpCode';
import { JoinShowSheet } from '@/components/sheets/JoinShowSheet';

/** A single show the current rep belongs to. */
export interface ShowSummary {
  slug: string;
  name: string;
  /** Total leads currently in the show. */
  leadCount?: number;
  /** Human-readable "when" — e.g. "Today · Hall B" or "Apr 14–16". */
  when?: string;
  /** True if the show's start/end window includes today. */
  isToday?: boolean;
}

/** The show we're currently on the capture page for. */
export interface Show {
  slug: string;
  name: string;
}

interface ShowSwitcherSheetProps {
  open: boolean;
  onClose: () => void;
  currentSlug: string;
  shows: ShowSummary[];
}

export function ShowSwitcherSheet({ open, onClose, currentSlug, shows }: ShowSwitcherSheetProps) {
  const router = useRouter();
  const [joinOpen, setJoinOpen] = useState(false);

  return (
    <>
    <Sheet open={open} onClose={onClose} title="Switch show">
      {shows.map((s) => {
        const isCurrent = s.slug === currentSlug;
        return (
          <div
            key={s.slug}
            className={`pick-row ${isCurrent ? 'is-current' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => {
              if (isCurrent) {
                onClose();
              } else {
                router.push(`/s/${s.slug}/capture`);
                onClose();
              }
            }}
          >
            <ShowSwatch slug={s.slug} name={s.name} />
            <div className="mid">
              <div className="row gap-2">
                <div className="nm">{s.name}</div>
                {s.isToday ? <LivePill label="today" /> : null}
              </div>
              <div className="sub">
                <OpCode code={s.slug.toUpperCase()} />
                {s.when ? (
                  <>
                    <span className="mx-1.5 text-ink-5">·</span>
                    {s.when}
                  </>
                ) : null}
                {typeof s.leadCount === 'number' ? (
                  <>
                    <span className="mx-1.5 text-ink-5">·</span>
                    {s.leadCount} leads
                  </>
                ) : null}
              </div>
            </div>
            {isCurrent ? (
              <span className="pill pill-ok" style={{ height: 22, fontSize: 11 }}>
                <Check size={11} />
                current
              </span>
            ) : (
              <ChevronRight size={16} className="text-ink-4" />
            )}
          </div>
        );
      })}

      <button
        type="button"
        className="card-flat mt-3 flex items-center gap-2.5 text-left border-0 w-full"
        onClick={() => setJoinOpen(true)}
      >
        <div className="w-9 h-9 rounded-[10px] bg-surface text-ink-2 border border-rule-2 flex items-center justify-center">
          <QrCode size={18} />
        </div>
        <div className="flex-1">
          <div className="font-semibold text-sm">Join a show</div>
          <div className="t-tiny mt-1">Scan a code from the booth lead or paste an invite link.</div>
        </div>
        <ChevronRight size={16} className="text-ink-4" />
      </button>
    </Sheet>
    <JoinShowSheet open={joinOpen} onClose={() => setJoinOpen(false)} />
    </>
  );
}
