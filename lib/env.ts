/**
 * Vercel Marketplace integrations prefix every env var with the resource name
 * (here: `aicapture_*` and `NEXT_PUBLIC_aicapture_*`). This helper reads either
 * the prefixed form (current) or the standard form (if the prefix is ever
 * removed) so the rest of the code can use unsurprising names.
 */

const SUPABASE_RESOURCE_PREFIX = 'aicapture_';

function read(name: string, options: { publicAllowed?: boolean } = {}): string | undefined {
  const direct = process.env[name];
  if (direct) return direct;
  const prefixed = process.env[`${SUPABASE_RESOURCE_PREFIX}${name}`];
  if (prefixed) return prefixed;
  if (options.publicAllowed && name.startsWith('NEXT_PUBLIC_')) {
    const tail = name.slice('NEXT_PUBLIC_'.length);
    const prefixedPublic = process.env[`NEXT_PUBLIC_${SUPABASE_RESOURCE_PREFIX}${tail}`];
    if (prefixedPublic) return prefixedPublic;
  }
  return undefined;
}

function required(name: string, options: { publicAllowed?: boolean } = {}): string {
  const value = read(name, options);
  if (!value) {
    throw new Error(
      `Missing required env var: ${name} (also tried prefixed: ${SUPABASE_RESOURCE_PREFIX}${name})`,
    );
  }
  return value;
}

export const env = {
  get postgresUrl(): string {
    return required('POSTGRES_URL');
  },
  get postgresUrlNonPooling(): string {
    return required('POSTGRES_URL_NON_POOLING');
  },
  get supabaseUrl(): string {
    return required('NEXT_PUBLIC_SUPABASE_URL', { publicAllowed: true });
  },
  get supabaseAnonKey(): string {
    return required('NEXT_PUBLIC_SUPABASE_ANON_KEY', { publicAllowed: true });
  },
  get supabaseServiceRoleKey(): string {
    return required('SUPABASE_SERVICE_ROLE_KEY');
  },
  get keyEncryptionKey(): string {
    return required('KEY_ENCRYPTION_KEY');
  },
};
