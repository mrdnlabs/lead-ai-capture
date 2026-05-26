import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const connectionString = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
if (!connectionString) throw new Error('POSTGRES_URL (or POSTGRES_URL_NON_POOLING) is required');

export default defineConfig({
  schema: './db/schema/index.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: connectionString },
  verbose: true,
  strict: true,
});
