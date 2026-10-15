import { expect, test, type Page, type Response } from '@playwright/test';
import { ErrorCodes, PRESENT_GRACE_SEC } from '@iace/contracts';
import { E2E_PAPER } from '../e2e-env';
import {
  dataOf,
  freshMobile,
  nextAnswerSave,
  openPaper,
  RIGHT_OPTION,
  signIn,
  submitAndReadNet,
  WRONG_OPTION,
} from './student';

/** Longest a screen waits for its next autosave tick: 25s plus 5s of jitter, and a margin. */
const NEXT_TICK_MS = 35_000;

async function errorCodeOf(response: Response): Promise<string | undefined> {
  const body = (await response.json()) as { error?: { code?: string } };
  return body.error?.code;
}

const firstStem = (page: Page) => page.getByText(E2E_PAPER.STEMS[0]);

test('a second tab of the same sign-in takes the sitting, and its answer is the one submitted', async ({
  page: first,
  context,
}) => {
  await signIn(first, freshMobile());
  const started = await dataOf<{ id: string }>(await openPaper(first, 'Start test'));
  await expect(firstStem(first)).toBeVisible();
  const refused = nextAnswerSave(first);
  await first.getByRole('radio', { name: WRONG_OPTION }).check();

  const second = await context.newPage();
  await second.goto('/');
  const resumed = await dataOf<{ id: string }>(await openPaper(second, 'Resume'));
  expect(resumed.id).toBe(started.id);
  await expect(firstStem(second)).toBeVisible();
  await expect(second.getByRole('radio', { name: WRONG_OPTION })).not.toBeChecked();

  const stale = await refused;
  expect(await errorCodeOf(stale)).toBe(ErrorCodes.SITTING_TAKEN_OVER);
  await expect(first.getByText('This test is open on another tab or device')).toBeVisible();
  await expect(first.getByText(/Answers not yet saved are kept on this device/)).toBeVisible();
  await expect(first.getByRole('button', { name: 'Continue here' })).toBeVisible();

  await second.getByRole('radio', { name: RIGHT_OPTION }).check();
  await submitAndReadNet(second, /Net 2 \/ 4/);
});

test('a second browser is refused until the first falls silent, then carries the sitting on', async ({
  page: first,
  browser,
}) => {
  test.setTimeout(NEXT_TICK_MS + PRESENT_GRACE_SEC * 1000 + 60_000);
  const mobile = freshMobile();
  await signIn(first, mobile);
  await openPaper(first, 'Start test');
  await expect(firstStem(first)).toBeVisible();
  const saved = nextAnswerSave(first);
  await first.getByRole('radio', { name: WRONG_OPTION }).check();
  expect((await dataOf<{ applied: boolean }>(await saved)).applied).toBe(true);

  const device = await browser.newContext();
  const second = await device.newPage();
  await signIn(second, mobile);
  const held = await openPaper(second, 'Resume');
  expect(await errorCodeOf(held)).toBe(ErrorCodes.SITTING_HELD_ELSEWHERE);
  await expect(second.getByText('A test is open on your other device')).toBeVisible();

  // One web sign-in per student: the second replaced the first, which learns so on its next tick.
  await expect(
    first.getByText('You were signed out because this account signed in on another browser.'),
  ).toBeVisible({ timeout: NEXT_TICK_MS });

  await expect(async () => {
    await second.getByRole('button', { name: 'Try again' }).click();
    await expect(firstStem(second)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: PRESENT_GRACE_SEC * 1000 + 10_000, intervals: [5_000] });

  await expect(second.getByRole('radio', { name: WRONG_OPTION })).toBeChecked();
  await second.getByRole('radio', { name: RIGHT_OPTION }).check();
  await submitAndReadNet(second, /Net 2 \/ 4/);
  await device.close();
});
