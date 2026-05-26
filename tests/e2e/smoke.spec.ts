import { expect, test } from '@playwright/test';

test('anonymous user is redirected to sign-in', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/auth\/signin/);
  await expect(page.getByRole('heading', { name: 'Sign in to AI Capture' })).toBeVisible();
});

test('sign-in page renders form', async ({ page }) => {
  await page.goto('/auth/signin');
  await expect(page.getByPlaceholder('you@company.com')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send magic link' })).toBeVisible();
});

test('manifest.webmanifest is served as static asset', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.name).toBe('AI Capture');
});
