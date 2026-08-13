import { test, expect } from '@playwright/test';
import { addViaSearch, gotoApp, openTab, removeFixtureEntries, rowFor, swipeCard } from './helpers.ts';

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
  await openTab(page, /Non commencées/); // reload resets the tab to "En cours"
  await expect(rowFor(page, 'Available Show')).toBeVisible();
});

test('swipe droite marque +1 (optimiste), swipe gauche annule (-1)', async ({ page }) => {
  await addViaSearch(page, 'available show');
  const row = rowFor(page, 'Available Show');
  await expect(row.locator('.progress-line span')).toHaveText('0 / 12 ép. vus');

  await swipeCard(page, row, 'right');
  await expect(row).toHaveCount(0); // now started -> moved to the "En cours" tab
  await openTab(page, /En cours/);
  await expect(row.locator('.progress-line span')).toHaveText('1 / 12 ép. vus');

  await swipeCard(page, row, 'left');
  await expect(row).toHaveCount(0); // back to progress 0 -> moved to "Non commencées"
  await openTab(page, /Non commencées/);
  await expect(row.locator('.progress-line span')).toHaveText('0 / 12 ép. vus');
});

test('bouton Tout rattraper (dans la carte)', async ({ page }) => {
  await addViaSearch(page, 'available show');
  const row = rowFor(page, 'Available Show');

  await expect(row.getByRole('button', { name: 'Tout rattraper' })).toBeVisible();
  await row.getByRole('button', { name: 'Tout rattraper' }).click();
  await expect(row).toHaveCount(0); // now finished -> moved to the "Terminées" tab

  await openTab(page, /Terminées/);
  await expect(row.locator('.progress-line span')).toHaveText('12 / 12 ép. vus');
});

test("un échec réseau simulé sur la progression déclenche un rollback", async ({ page }) => {
  await addViaSearch(page, 'available show');
  const row = rowFor(page, 'Available Show');
  await expect(row.locator('.progress-line span')).toHaveText('0 / 12 ép. vus');

  await swipeCard(page, row, 'right'); // real +1 first, so the rollback below lands back on 1, not 0
  await openTab(page, /En cours/);
  await expect(row.locator('.progress-line span')).toHaveText('1 / 12 ép. vus');

  await page.route('**/api/list/90001', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    await new Promise((resolve) => setTimeout(resolve, 300)); // let the optimistic state render first
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });

  await swipeCard(page, row, 'right');
  await expect(row.locator('.progress-line span')).toHaveText('2 / 12 ép. vus'); // optimistic
  await expect(row.locator('.progress-line span')).toHaveText('1 / 12 ép. vus'); // rolled back
});

test('les 5 états de carte (available / scheduled / uptodate / unreleased / finished)', async ({ page }) => {
  await addViaSearch(page, 'available show');
  await addViaSearch(page, 'scheduled show');
  await addViaSearch(page, 'uptodate show');
  await addViaSearch(page, 'finishable show');
  await addViaSearch(page, 'unreleased show');
  await openTab(page, /Non commencées/); // all 5 fixtures start at progress 0

  await expect(rowFor(page, 'Available Show').locator('.pill-go')).toBeVisible();
  await expect(rowFor(page, 'Scheduled Show').locator('.pill-wait')).toBeVisible();
  await expect(rowFor(page, 'Uptodate Show').locator('.pill-idle')).toBeVisible();

  // Not yet released: no "dispo maintenant", no "Tout rattraper" — this is the exact
  // regression a NOT_YET_RELEASED season (e.g. an announced movie) must never trigger.
  const unreleased = rowFor(page, 'Unreleased Show');
  await expect(unreleased.locator('.pill-soon')).toBeVisible();
  await expect(unreleased.getByRole('button', { name: 'Tout rattraper' })).toHaveCount(0);

  const finishable = rowFor(page, 'Finishable Show');
  await expect(finishable.locator('.pill-go')).toBeVisible(); // 1 episode, not watched yet -> available
  await swipeCard(page, finishable, 'right');
  await expect(finishable).toHaveCount(0); // moved to the "Terminées" tab, no longer in "Non commencées"

  await openTab(page, /Terminées/);
  await expect(rowFor(page, 'Finishable Show').locator('.pill-done')).toBeVisible();
});

test('une saison ajoutée mais non vue bascule vers En cours au premier épisode vu', async ({ page }) => {
  await addViaSearch(page, 'available show');
  const unstartedTab = page.getByRole('tab', { name: /Non commencées/ });
  const activeTab = page.getByRole('tab', { name: /En cours/ });

  await expect(unstartedTab.locator('.count')).toHaveText('1');
  await expect(activeTab.locator('.count')).toHaveText('0');
  await expect(rowFor(page, 'Available Show')).toBeVisible(); // already on "Non commencées"

  await swipeCard(page, rowFor(page, 'Available Show'), 'right');
  await expect(unstartedTab.locator('.count')).toHaveText('0');
  await expect(activeTab.locator('.count')).toHaveText('1');

  await activeTab.click();
  await expect(rowFor(page, 'Available Show')).toBeVisible();
});

test('une saison terminée bascule de l\'onglet Non commencées vers Terminées', async ({ page }) => {
  await addViaSearch(page, 'finishable show');
  const unstartedTab = page.getByRole('tab', { name: /Non commencées/ });
  const activeTab = page.getByRole('tab', { name: /En cours/ });
  const finishedTab = page.getByRole('tab', { name: /Terminées/ });

  await expect(unstartedTab.locator('.count')).toHaveText('1');
  await expect(activeTab.locator('.count')).toHaveText('0');
  await expect(finishedTab.locator('.count')).toHaveText('0');

  await rowFor(page, 'Finishable Show').getByRole('button', { name: 'Tout rattraper' }).click();
  await expect(rowFor(page, 'Finishable Show')).toHaveCount(0);
  await expect(unstartedTab.locator('.count')).toHaveText('0');
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
