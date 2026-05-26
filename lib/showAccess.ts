import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { opportunities, reps, shows, showReps } from '@/db/schema';
import type { Show, Rep, Opportunity } from '@/db/schema';

export async function getShowBySlug(slug: string): Promise<Show | null> {
  const [row] = await db.select().from(shows).where(eq(shows.slug, slug)).limit(1);
  return row ?? null;
}

export async function getShowMembership(repId: string, showSlug: string): Promise<{
  show: Show;
  role: string;
} | null> {
  const result = await db
    .select({ show: shows, role: showReps.role })
    .from(showReps)
    .innerJoin(shows, eq(shows.id, showReps.showId))
    .where(and(eq(showReps.repId, repId), eq(shows.slug, showSlug)))
    .limit(1);
  return result[0] ?? null;
}

export async function getOpportunityByCode(
  showId: string,
  code: string,
): Promise<Opportunity | null> {
  const [row] = await db
    .select()
    .from(opportunities)
    .where(and(eq(opportunities.showId, showId), eq(opportunities.code, code.toUpperCase())))
    .limit(1);
  return row ?? null;
}

export async function listShowReps(showId: string): Promise<Array<Rep & { roleInShow: string }>> {
  const result = await db
    .select({
      id: reps.id,
      email: reps.email,
      displayName: reps.displayName,
      role: reps.role,
      createdAt: reps.createdAt,
      roleInShow: showReps.role,
    })
    .from(showReps)
    .innerJoin(reps, eq(reps.id, showReps.repId))
    .where(eq(showReps.showId, showId));
  return result;
}
