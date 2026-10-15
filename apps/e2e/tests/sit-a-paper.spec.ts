import { expect, test } from '@playwright/test';
import { E2E_PAPER } from '../e2e-env';

const OTP_PATTERN = /\d{4,8}/;

test('a student signs up, sits the paper, submits and reads a scored result', async ({ page }) => {
  const mobile = `9${String(Date.now()).slice(-9)}`;

  await page.goto('/login');
  await page.getByLabel('Mobile number').fill(mobile);
  await page.getByRole('button', { name: 'Send code' }).click();
  const devCode = page.getByText(/Your code is/);
  await expect(devCode).toBeVisible();
  const code = (await devCode.textContent())?.match(OTP_PATTERN)?.[0];
  expect(code, 'the console sender echoes the code on screen').toBeTruthy();
  await page.getByLabel('One-time code').fill(code ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByText(E2E_PAPER.TEST_TITLE)).toBeVisible();
  await page.getByRole('link', { name: 'Start test' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Language' }).click();
  await page.getByRole('option', { name: 'English' }).click();
  await page.getByRole('checkbox', { name: /I have read the instructions/ }).check();
  await page.getByRole('button', { name: 'I am ready to begin' }).click();

  await expect(page.getByText(E2E_PAPER.STEMS[0])).toBeVisible();
  // The seed keys every question to the option labelled "Option 1"; the paper shuffles its position.
  await page.getByRole('radio', { name: /Option 1$/ }).check();
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
