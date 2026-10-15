import { expect, test } from '@playwright/test';
import { E2E_PAPER } from '../e2e-env';
import {
  dataOf,
  freshMobile,
  nextAnswerSave,
  nextStart,
  openPaper,
  RIGHT_OPTION,
  secondsLeft,
  signIn,
  submitAndReadNet,
} from './student';

interface Sitting {
  id: string;
  endsAt: string;
  durationSec: number;
  startedByThisCall: boolean;
}

/** A redraw can lag the server's anchor by a tick either side. */
const CLOCK_SLACK_SEC = 3;

test('a reload mid-sitting keeps the autosaved answer and the server deadline', async ({
  page,
}) => {
  await signIn(page, freshMobile());
  const started = await dataOf<Sitting>(await openPaper(page, 'Start test'));
  expect(started.startedByThisCall).toBe(true);

  await expect(page.getByText(E2E_PAPER.STEMS[0])).toBeVisible();
  const saved = nextAnswerSave(page);
  await page.getByRole('radio', { name: RIGHT_OPTION }).check();
  const ack = await dataOf<{ applied: boolean; endsAt: string }>(await saved);
  expect(ack.applied, 'the autosave landed in Redis').toBe(true);
  expect(ack.endsAt).toBe(started.endsAt);

  const resumed = nextStart(page);
  await page.reload();
  const sitting = await dataOf<Sitting>(await resumed);
  expect(sitting.id).toBe(started.id);
  expect(sitting.startedByThisCall, 'a reload resumes, it does not start again').toBe(false);
  expect(sitting.endsAt, 'the deadline the server set at start').toBe(started.endsAt);

  await expect(page.getByText(E2E_PAPER.STEMS[0])).toBeVisible();
  await expect(page.getByRole('radio', { name: RIGHT_OPTION })).toBeChecked();
  const left = await secondsLeft(page);
  const owed = (Date.parse(started.endsAt) - Date.now()) / 1000;
  expect(left).toBeLessThan(started.durationSec - 15);
  expect(Math.abs(left - owed)).toBeLessThanOrEqual(CLOCK_SLACK_SEC);

  await submitAndReadNet(page, /Net 2 \/ 4/);
});
