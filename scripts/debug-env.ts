import { env } from '@/lib/env';
console.log('via env helper:', JSON.stringify(env.postgresUrl));
console.log('raw process.env:', JSON.stringify(process.env.aicapture_POSTGRES_URL));
console.log('equal:', env.postgresUrl === process.env.aicapture_POSTGRES_URL);
