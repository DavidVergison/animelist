import { expect, type Page } from '@playwright/test';

export const FIXTURE_IDS = [90_001, 90_002, 90_003, 90_004] as const;

/** Navigates to the app — already authenticated via the shared `storageState`
 * (see global-setup.ts), so no UI login round-trip (and no rate-limit risk) per test. */
export async function gotoApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ma liste' })).toBeVisible();
}

/** Deletes the known fixture ids via the API (idempotent — 204 whether present or
 * not), so tests never leak state into each other despite sharing one server/DB for
 * the whole Playwright run. Call in both `beforeEach` and `afterEach`. */
export async function removeFixtureEntries(page: Page): Promise<void> {
  await page.evaluate(async (ids) => {
    await Promise.all(ids.map((id) => fetch(`/api/list/${id}`, { method: 'DELETE' })));
  }, FIXTURE_IDS as unknown as number[]);
}

export async function addViaSearch(page: Page, term: string): Promise<void> {
  await page.getByPlaceholder(/Chercher/).fill(term);
  const addButton = page.getByRole('button', { name: '+ ajouter' }).first();
  await addButton.click();
  await expect(page.getByRole('button', { name: 'ajouté' }).first()).toBeVisible();
  await page.getByPlaceholder(/Chercher/).fill('');
}

export function rowFor(page: Page, title: string) {
  return page.locator('.row-wrap').filter({ has: page.locator('.card-title', { hasText: title }) });
}

/** Drags a card left/right past the swipe threshold — the only way to mark
 * watched/unwatched now that the row buttons are gone (see ListCard.tsx). */
export async function swipeCard(page: Page, row: ReturnType<typeof rowFor>, direction: 'left' | 'right'): Promise<void> {
  const card = row.locator('.card');
  const box = await card.boundingBox();
  if (!box) throw new Error('card bounding box not found');
  const y = box.y + box.height / 2;
  const startX = box.x + box.width / 2;
  const delta = direction === 'right' ? 150 : -150;

  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX + delta, y, { steps: 5 });
  await page.mouse.up();
}
