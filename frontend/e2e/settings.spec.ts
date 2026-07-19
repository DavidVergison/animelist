import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { gotoApp, removeFixtureEntries } from './helpers.ts';

const SAMPLE_BACKUP_PATH = fileURLToPath(new URL('./fixtures/sample-backup.json', import.meta.url));

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await removeFixtureEntries(page);
});

test.afterEach(async ({ page }) => {
  await removeFixtureEntries(page);
});

test('téléchargement de la sauvegarde déclenche un fichier', async ({ page }) => {
  await page.getByRole('button', { name: 'Réglages' }).click();
  await expect(page.getByRole('heading', { name: 'Sauvegarde' })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Télécharger la sauvegarde' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^suivi-anime-\d{4}-\d{2}-\d{2}\.json$/);
});

test('restauration : confirmation explicite avant envoi, puis récapitulatif', async ({ page }) => {
  await page.getByRole('button', { name: 'Réglages' }).click();
  await expect(page.getByRole('heading', { name: 'Restauration' })).toBeVisible();

  await page.setInputFiles('#restore-file-input', SAMPLE_BACKUP_PATH);

  // Explicit confirmation is required before anything is sent — the restore endpoint
  // hasn't been called yet at this point.
  const confirmDialog = page.getByRole('alertdialog');
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog).toContainText('sample-backup.json');

  await page.getByRole('button', { name: 'Confirmer la restauration' }).click();

  const summary = page.getByRole('status');
  await expect(summary).toContainText('1 anime(s) en cache');
  await expect(summary).toContainText('1 entrée(s) de liste');

  await page.getByRole('button', { name: '← Retour' }).click();
  await expect(page.locator('.card-title', { hasText: 'Available Show' })).toBeVisible();
  await expect(page.locator('.progress-line span')).toHaveText('4 / 12 ép. vus');
});

test('annuler la restauration ne modifie rien', async ({ page }) => {
  await page.getByRole('button', { name: 'Réglages' }).click();
  await page.setInputFiles('#restore-file-input', SAMPLE_BACKUP_PATH);
  await expect(page.getByRole('alertdialog')).toBeVisible();

  await page.getByRole('button', { name: 'Annuler' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveCount(0);

  await page.getByRole('button', { name: '← Retour' }).click();
  await expect(page.locator('.card-title', { hasText: 'Available Show' })).toHaveCount(0);
});
