export const dynamic = 'force-dynamic';

import { and, desc, eq, isNull } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { db } from '@/db/client';
import { reps, showInvites, showReps, shows } from '@/db/schema';
import { requireRep } from '@/lib/auth/currentRep';
import { mintInviteAction, revokeInviteAction, removeMemberAction } from './actions';

interface Params {
  params: Promise<{ showId: string }>;
}

function fmtExpiry(d: Date): string {
  const days = Math.ceil((d.getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return 'expired';
  if (days === 1) return 'expires in 1 day';
  if (days < 14) return `expires in ${days} days`;
  return `expires ${d.toLocaleDateString()}`;
}

export default async function TeamPage({ params }: Params) {
  const { showId } = await params;
  await requireRep();

  const [show] = await db.select().from(shows).where(eq(shows.id, showId)).limit(1);
  if (!show) redirect('/admin/shows');

  const members = await db
    .select({ rep: reps, role: showReps.role, addedAt: showReps.addedAt })
    .from(showReps)
    .innerJoin(reps, eq(reps.id, showReps.repId))
    .where(eq(showReps.showId, showId))
    .orderBy(desc(showReps.addedAt));

  const invites = await db
    .select()
    .from(showInvites)
    .where(and(eq(showInvites.showId, showId), isNull(showInvites.revokedAt)))
    .orderBy(desc(showInvites.createdAt));

  // Render the most recent live invite as the headline QR. Older invites are
  // shown in a small "previous invites" list below.
  const live = invites.find((i) => i.expiresAt.getTime() > Date.now() && i.usedCount < i.maxUses);
  const baseUrl =
    process.env.AICAPTURE_PUBLIC_URL ??
    process.env.NEXT_PUBLIC_aicapture_BASE_URL ??
    'https://ai-capture.vercel.app';
  const inviteUrl = live ? `${baseUrl}/join/${live.token}` : null;
  const qrDataUrl = inviteUrl
    ? await QRCode.toDataURL(inviteUrl, { width: 224, margin: 1 })
    : null;

  return (
    <div className="space-y-6">
      <header>
        <a href="/admin/shows" className="t-eyebrow text-ink-3 underline-offset-2 hover:underline">
          ← Admin · shows
        </a>
        <h1 className="t-title mt-2">Team &amp; invites</h1>
        <p className="t-meta mt-1">
          {show.name} · reps need a sign-in (magic link) <em>and</em> a membership in this show
          to capture leads.
        </p>
      </header>

      {/* Active invite link card */}
      <section className="invite-link">
        {qrDataUrl ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl}
              alt="Invite QR code"
              className="w-32 h-32 sm:w-28 sm:h-28 rounded-md border border-rule self-start"
            />
            <div className="flex-1 min-w-0 space-y-2">
              <div className="text-sm font-semibold">Shareable invite link</div>
              <div className="link break-all">{inviteUrl}</div>
              <div className="flex flex-wrap gap-2">
                <span className="role-tag rep">{live!.role}</span>
                <span className="role-tag">{fmtExpiry(live!.expiresAt)}</span>
                <span className="role-tag">
                  {live!.usedCount} / {live!.maxUses} used
                </span>
              </div>
              <div className="flex flex-wrap gap-2 mt-1">
                <form action={revokeInviteAction}>
                  <input type="hidden" name="inviteId" value={live!.id} />
                  <input type="hidden" name="showId" value={showId} />
                  <button type="submit" className="btn btn-ghost btn-sm">
                    Revoke
                  </button>
                </form>
                <form action={mintInviteAction}>
                  <input type="hidden" name="showId" value={showId} />
                  <input type="hidden" name="role" value="rep" />
                  <input type="hidden" name="days" value="14" />
                  <button type="submit" className="btn btn-sub btn-sm">
                    New link
                  </button>
                </form>
              </div>
            </div>
          </div>
        ) : (
          <form
            action={mintInviteAction}
            className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap"
          >
            <input type="hidden" name="showId" value={showId} />
            <label className="flex flex-col gap-1 sm:w-[120px]">
              <span className="t-eyebrow">Role</span>
              <select name="role" className="input" style={{ height: 40 }}>
                <option value="rep">rep</option>
                <option value="lead">lead</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 sm:w-[100px]">
              <span className="t-eyebrow">Days valid</span>
              <input
                name="days"
                type="number"
                defaultValue={14}
                min={1}
                max={90}
                className="input"
                style={{ height: 40 }}
              />
            </label>
            <label className="flex flex-col gap-1 sm:w-[100px]">
              <span className="t-eyebrow">Max uses</span>
              <input
                name="maxUses"
                type="number"
                defaultValue={50}
                min={1}
                max={500}
                className="input"
                style={{ height: 40 }}
              />
            </label>
            <button type="submit" className="btn btn-primary sm:btn-sm">
              Generate invite
            </button>
          </form>
        )}
      </section>

      {/* Member list */}
      <section>
        <h2 className="t-h2 mb-3">Members ({members.length})</h2>
        <ul className="space-y-2">
          {members.map(({ rep: m, role }) => (
            <li key={m.id} className="card flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-paper-2 text-ink-2 flex items-center justify-center font-semibold">
                {m.email[0]?.toUpperCase() ?? '?'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="row gap-2">
                  <span className="font-semibold text-sm truncate">
                    {m.displayName || m.email}
                  </span>
                  <span className={`role-tag ${role}`}>{role}</span>
                </div>
                <div className="t-tiny truncate">{m.email}</div>
              </div>
              <form action={removeMemberAction}>
                <input type="hidden" name="showId" value={showId} />
                <input type="hidden" name="repId" value={m.id} />
                <button
                  type="submit"
                  className="text-xs text-ink-4 hover:text-warn underline-offset-2 hover:underline"
                >
                  Remove
                </button>
              </form>
            </li>
          ))}
          {members.length === 0 ? (
            <li className="card-flat text-sm text-ink-3 text-center py-6">
              No members yet. Generate an invite link above.
            </li>
          ) : null}
        </ul>
      </section>

      {invites.length > 1 ? (
        <section>
          <h2 className="t-h2 mb-3">Older active invites</h2>
          <ul className="space-y-2">
            {invites.slice(1).map((inv) => (
              <li key={inv.id} className="card-flat flex items-center gap-3 text-sm">
                <span className="role-tag rep">{inv.role}</span>
                <span className="t-tiny truncate flex-1">
                  /join/{inv.token.slice(0, 8)}… · {inv.usedCount}/{inv.maxUses} · {fmtExpiry(inv.expiresAt)}
                </span>
                <form action={revokeInviteAction}>
                  <input type="hidden" name="inviteId" value={inv.id} />
                  <input type="hidden" name="showId" value={showId} />
                  <button type="submit" className="text-xs text-ink-4 hover:text-warn underline-offset-2 hover:underline">
                    Revoke
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
