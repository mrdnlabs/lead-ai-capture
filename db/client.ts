import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { env } from '@/lib/env';
import * as schema from './schema';

const queryClient = postgres(env.postgresUrl, {
  prepare: false,
  max: 1,
});

export const db = drizzle(queryClient, { schema });
export type DB = typeof db;
