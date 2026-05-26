import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { defineConfig } from 'drizzle-kit';
import { env } from './lib/env';

export default defineConfig({
  schema: './db/schema/index.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: env.postgresUrlNonPooling },
  verbose: true,
  strict: true,
});
