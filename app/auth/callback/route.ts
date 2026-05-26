import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

type SupportedOtpType = 'magiclink' | 'signup' | 'recovery' | 'invite' | 'email_change' | 'email';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as SupportedOtpType | null;
  const next = searchParams.get('next') ?? '/';

  const supabase = await createSupabaseServerClient();

  // PKCE flow (real users via signInWithOtp from our form)
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(
        `${origin}/auth/signin?error=${encodeURIComponent(error.message)}`,
      );
    }
    return NextResponse.redirect(`${origin}${next}`);
  }

  // OTP token_hash flow (admin-generated links, recovery, invites)
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) {
      return NextResponse.redirect(
        `${origin}/auth/signin?error=${encodeURIComponent(error.message)}`,
      );
    }
    return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(`${origin}/auth/signin?error=missing_code_or_token_hash`);
}
