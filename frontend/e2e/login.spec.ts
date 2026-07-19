import { test, expect } from '@playwright/test';

// Every other spec file reuses the pre-authenticated storageState (see
// playwright.config.ts + global-setup.ts) to avoid tripping the shared login
// rate-limit. This file specifically exercises the unauthenticated flow, so it opts
// back out to a clean, cookie-less context.
test.use({ storageState: { cookies: [], origins: [] } });

test('login -> mauvais mot de passe -> bon mot de passe -> liste vide -> logout -> retour au login', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.getByPlaceholder('Mot de passe')).toBeVisible();

  // Mauvais mot de passe : message d'erreur affiché, toujours sur l'écran de login.
  await page.getByPlaceholder('Mot de passe').fill('wrong-password');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('alert')).toHaveText('Mot de passe incorrect.');
  await expect(page.getByPlaceholder('Mot de passe')).toBeVisible();

  // Bon mot de passe : l'app se charge, "Ma liste" vide s'affiche.
  await page.getByPlaceholder('Mot de passe').fill('e2e-test-pass');
  await page.getByRole('button', { name: 'Se connecter' }).click();

  await expect(page.getByRole('heading', { name: 'Ma liste' })).toBeVisible();
  await expect(page.getByText('Rien à suivre. Cherche une saison ci-dessus et ajoute-la.')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'En cours 0' })).toBeVisible(); // compteur de liste

  // Logout : retour à l'écran de login.
  await page.getByRole('button', { name: 'Déconnexion' }).click();
  await expect(page.getByPlaceholder('Mot de passe')).toBeVisible();

  // Le cookie doit être invalidé côté serveur, pas seulement l'état client : un reload
  // ne doit pas rouvrir l'app (sinon logout aurait échoué silencieusement, cf. régression
  // où le front envoyait Content-Type: application/json avec un corps vide -> 400).
  await page.reload();
  await expect(page.getByPlaceholder('Mot de passe')).toBeVisible();
});

test('reload après login reste connecté (persistance du cookie de session)', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('Mot de passe').fill('e2e-test-pass');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { name: 'Ma liste' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Ma liste' })).toBeVisible();
});
