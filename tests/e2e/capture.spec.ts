import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { signInAs } from './helpers/auth';

const TEST_EMAIL = process.env.E2E_REP_EMAIL ?? 'dave.nicholl@axis.com';
const FIXTURE_BADGE = resolve('tests/fixtures/badges/fake-badge-sarah-chen.png');

test('signed-in admin sees admin nav', async ({ context }) => {
  const page = await signInAs(context, TEST_EMAIL, '/');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(TEST_EMAIL)).toBeVisible();
});

test('capture page renders for valid opportunity', async ({ context }) => {
  const page = await signInAs(context, TEST_EMAIL, '/s/demo/capture?opp=DEMO01');
  await expect(page.getByRole('heading', { name: 'Capture lead' })).toBeVisible();
  await expect(page.getByText('DEMO01')).toBeVisible();
});

test('photo upload via API creates capture row visible in display', async ({ context, request }) => {
  const page = await signInAs(context, TEST_EMAIL, '/s/demo/leads');
  await page.waitForSelector('text=Leads', { timeout: 10_000 });

  const cookies = await context.cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const photo = readFileSync(FIXTURE_BADGE);

  const form = new FormData();
  form.set('showSlug', 'demo');
  form.set('opportunityCode', 'DEMO01');
  form.set('idempotencyKey', crypto.randomUUID());
  form.set('clientCapturedAt', new Date().toISOString());
  form.set('photo', new File([photo], 'badge.png', { type: 'image/png' }));

  const res = await request.post('/api/captures', {
    multipart: {
      showSlug: 'demo',
      opportunityCode: 'DEMO01',
      idempotencyKey: crypto.randomUUID(),
      clientCapturedAt: new Date().toISOString(),
      photo: {
        name: 'badge.png',
        mimeType: 'image/png',
        buffer: photo,
      },
    },
    headers: { Cookie: cookieHeader },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.captureId).toBeTruthy();
  expect(body.status).toBe('uploaded');
});
