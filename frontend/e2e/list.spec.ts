import { test, expect } from '@playwright/test';
import { addViaSearch, gotoApp, removeFixtureEntries, rowFor, swipeCard } from './helpers.ts';

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await removeFixtureEntries(page);
});

test.afterEach(async ({ page }) => {
  await removeFixtureEntries(page);
});

test("recherche -> ajout -> apparaît dans Ma liste -> persiste après reload", async ({ page }) => {
  await addViaSearch(page, 'available show');

  await expect(rowFor(page, 'Available Show')).toBeVisible();

  await page.reload();
  await expect(rowFor(page, 'Available Show')).toBeVisible();
});

test('swipe droite marque +1 (optimiste), swipe gauche annule (-1)', async ({ page }) => {
  await addViaSearch(page, 'available show');
  const row = rowFor(page, 'Available Show');
  await expect(row.locator('.progress-line span')).toHaveText('0 / 12 ép. vus');

  await swipeCard(page, row, 'right');
  await expect(row.locator('.progress-line span')).toHaveText('1 / 12 ép. vus');

  await swipeCard(page, row, 'left');
  await expect(row.locator('.progress-line span')).toHaveText('0 / 12 ép. vus');
});

test('bouton Tout rattraper (dans la carte)', async ({ page }) => {
  await addViaSearch(page, 'available show');
  const row = rowFor(page, 'Available Show');

  await expect(row.getByRole('button', { name: 'Tout rattraper' })).toBeVisible();
  await row.getByRole('button', { name: 'Tout rattraper' }).click();
  await expect(row).toHaveCount(0); // now finished -> moved to the "Terminées" tab

  await page.getByRole('tab', { name: /Terminées/ }).click();
  await expect(row.locator('.progress-line span')).toHaveText('12 / 12 ép. vus');
});

test("un échec réseau simulé sur la progression déclenche un rollback", async ({ page }) => {
  await addViaSearch(page, 'available show');
  const row = rowFor(page, 'Available Show');
  await expect(row.locator('.progress-line span')).toHaveText('0 / 12 ép. vus');

  await page.route('**/api/list/90001', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    await new Promise((resolve) => setTimeout(resolve, 300)); // let the optimistic state render first
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });

  await swipeCard(page, row, 'right');
  await expect(row.locator('.progress-line span')).toHaveText('1 / 12 ép. vus'); // optimistic
  await expect(row.locator('.progress-line span')).toHaveText('0 / 12 ép. vus'); // rolled back
});

test('les 4 états de carte (available / scheduled / uptodate / finished)', async ({ page }) => {
  await addViaSearch(page, 'available show');
  await addViaSearch(page, 'scheduled show');
  await addViaSearch(page, 'uptodate show');
  await addViaSearch(page, 'finishable show');

  await expect(rowFor(page, 'Available Show').locator('.pill-go')).toBeVisible();
  await expect(rowFor(page, 'Scheduled Show').locator('.pill-wait')).toBeVisible();
  await expect(rowFor(page, 'Uptodate Show').locator('.pill-idle')).toBeVisible();

  const finishable = rowFor(page, 'Finishable Show');
  await expect(finishable.locator('.pill-go')).toBeVisible(); // 1 episode, not watched yet -> available
  await swipeCard(page, finishable, 'right');
  await expect(finishable).toHaveCount(0); // moved to the "Terminées" tab, no longer in "En cours"

  await page.getByRole('tab', { name: /Terminées/ }).click();
  await expect(rowFor(page, 'Finishable Show').locator('.pill-done')).toBeVisible();
});

test('une saison terminée bascule de l\'onglet En cours vers Terminées', async ({ page }) => {
  await addViaSearch(page, 'finishable show');
  const activeTab = page.getByRole('tab', { name: /En cours/ });
  const finishedTab = page.getByRole('tab', { name: /Terminées/ });

  await expect(activeTab.locator('.count')).toHaveText('1');
  await expect(finishedTab.locator('.count')).toHaveText('0');

  await rowFor(page, 'Finishable Show').getByRole('button', { name: 'Tout rattraper' }).click();
  await expect(rowFor(page, 'Finishable Show')).toHaveCount(0);
  await expect(activeTab.locator('.count')).toHaveText('0');
  await expect(finishedTab.locator('.count')).toHaveText('1');

  await finishedTab.click();
  await expect(rowFor(page, 'Finishable Show')).toBeVisible();
});

test('suppression retire la carte, y compris après reload', async ({ page }) => {
  await addViaSearch(page, 'available show');
  const row = rowFor(page, 'Available Show');
  await expect(row).toBeVisible();

  await row.locator('.remove').click();
  await expect(row).toHaveCount(0);

  await page.reload();
  await expect(rowFor(page, 'Available Show')).toHaveCount(0);
});
