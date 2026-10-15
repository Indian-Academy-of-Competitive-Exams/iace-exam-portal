import { expect, test } from '@playwright/test';
import { E2E_PAPER } from '../e2e-env';
import { freshMobile, openPaper, RIGHT_OPTION, signIn } from './student';

test('a student signs up, sits the paper, submits and reads a scored result', async ({ page }) => {
  await signIn(page, freshMobile());
  await openPaper(page, 'Start test');

  await expect(page.getByText(E2E_PAPER.STEMS[0])).toBeVisible();
  await page.getByRole('radio', { name: RIGHT_OPTION }).check();
  await page.getByRole('button', { name: 'Save & next' }).click();
  await expect(page.getByText(E2E_PAPER.STEMS[1])).toBeVisible();
  await page.getByRole('button', { name: 'Submit' }).click();
  const confirm = page.getByRole('dialog', { name: 'Submit this test?' });
  await expect(confirm).toContainText('1 question unanswered');
  await confirm.getByRole('button', { name: 'Submit' }).click();

  await expect(page).toHaveURL(/\/attempts\/[^/]+\/submitted$/);
  await expect(page.getByRole('heading', { name: 'Handed in' })).toBeVisible();

  await page.getByRole('link', { name: 'See your result' }).click();
  await expect(page.getByRole('figure', { name: /Net 2 \/ 4/ })).toBeVisible({ timeout: 30_000 });
});
