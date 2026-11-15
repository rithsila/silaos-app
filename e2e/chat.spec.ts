import { test, expect, type Page } from '@playwright/test';

async function bypassOnboarding(page: Page) {
  await page.goto('/');

  const welcomeCTA = page.getByRole('button', { name: /Let's begin/i });
  if (await welcomeCTA.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
    await welcomeCTA.click();
  }

  const skipSetup = page.getByRole('button', { name: /Skip setup/i });
  if (await skipSetup.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
    await skipSetup.click();
  }

  await expect(
    page.locator('aside').getByRole('button', { name: /Dashboard/i }),
  ).toBeVisible({ timeout: 20_000 });
}

test.describe('Norma Chat Sidebar Page', () => {
  test.beforeEach(async ({ page }) => {
    await bypassOnboarding(page);
  });

  test('opens Norma Chat from sidebar, shows starter prompts, and creates a session', async ({ page }) => {
    await page.locator('aside').getByRole('button', { name: /Norma Chat/i }).click();

    await expect(page.getByRole('heading', { name: /Norma AI Assistant/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Summarize today's tasks and schedule/i })).toBeVisible();

    await page.getByRole('button', { name: /New Chat/i }).click();
    await expect(page.getByRole('button', { name: /New Chat/i }).first()).toBeVisible();

    // Verify the Go sidecar persisted the created session via /api/chat/sessions
    const res = await page.request.get('/api/chat/sessions');
    expect(res.ok()).toBe(true);
    const data = (await res.json()) as { sessions: Array<{ id: string; title: string }> };
    expect(data.sessions.length).toBeGreaterThanOrEqual(1);
  });
});
