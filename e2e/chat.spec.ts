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

test.describe('Chat Sidebar Page', () => {
  test.beforeEach(async ({ page }) => {
    await bypassOnboarding(page);
  });

  test('opens Chat from sidebar, shows starter prompts, and creates a session', async ({ page }) => {
    await page.locator('aside').getByRole('button', { name: 'Chat', exact: true }).click();

    await expect(page.getByRole('heading', { name: /AI Assistant/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Summarize today's tasks and schedule/i })).toBeVisible();

    const beforeRes = await page.request.get('/api/chat/sessions');
    expect(beforeRes.ok()).toBe(true);
    const beforeData = (await beforeRes.json()) as { sessions: Array<{ id: string }> };
    const beforeIds = new Set(beforeData.sessions.map((s) => s.id));

    const newChatButton = page.getByRole('button', { name: 'New Chat', exact: true }).first();
    await newChatButton.click();

    // Verify the Go sidecar persisted the newly created session via /api/chat/sessions
    await expect
      .poll(async () => {
        const res = await page.request.get('/api/chat/sessions');
        if (!res.ok()) return 0;
        const data = (await res.json()) as { sessions: Array<{ id: string }> };
        return data.sessions.filter((s) => !beforeIds.has(s.id)).length;
      })
      .toBe(1);

    const afterRes = await page.request.get('/api/chat/sessions');
    const afterData = (await afterRes.json()) as { sessions: Array<{ id: string }> };
    for (const s of afterData.sessions) {
      if (!beforeIds.has(s.id)) {
        await page.request.delete(`/api/chat/sessions/${s.id}`);
      }
    }
  });
});
