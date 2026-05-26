'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const schema = z.object({
  email: z.string().email(),
  next: z.string().default('/'),
});

export type SignInResult =
  | { ok: true; email: string }
  | { ok: false; error: string };

export async function sendMagicLink(formData: FormData): Promise<SignInResult> {
  const parsed = schema.safeParse({
    email: formData.get('email'),
    next: formData.get('next') ?? '/',
  });
  if (!parsed.success) {
    return { ok: false, error: 'Please enter a valid email address.' };
  }

  const supabase = await createSupabaseServerClient();
  const headersList = await headers();
  const origin = headersList.get('origin') ?? `https://${headersList.get('host') ?? 'localhost:3000'}`;
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(parsed.data.next)}`;

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, email: parsed.data.email };
}
