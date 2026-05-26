import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { reps, type Rep } from '@/db/schema';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function getCurrentRep(): Promise<Rep | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [rep] = await db.select().from(reps).where(eq(reps.id, user.id)).limit(1);
  return rep ?? null;
}

export async function requireRep(): Promise<Rep> {
  const rep = await getCurrentRep();
  if (!rep) throw new Error('Authentication required');
  return rep;
}

export async function requireAdmin(): Promise<Rep> {
  const rep = await requireRep();
  if (rep.role !== 'admin') throw new Error('Admin role required');
  return rep;
}

export function isAdmin(rep: Rep | null): boolean {
  return rep?.role === 'admin';
}
