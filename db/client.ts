import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

const connectionString = process.env.POSTGRES_URL;
if (!connectionString) throw new Error('POSTGRES_URL env var is required');

const queryClient = postgres(connectionString, {
  prepare: false,
  max: 1,
});

export const db = drizzle(queryClient, { schema });
export type DB = typeof db;
