import { expect, type Page, type Response } from '@playwright/test';
import { E2E_PAPER } from '../e2e-env';

const OTP_PATTERN = /\d{4,8}/;
const START_URL = /\/me\/tests\/[^/]+\/attempt$/;
const STATE_URL = /\/me\/attempts\/[^/]+\/state$/;
const CLOCK_PATTERN = /\d+(?::\d{2}){1,2}/;

/** The seed keys every question to the option labelled "Option 1"; the paper shuffles its position. */
export const RIGHT_OPTION = /Option 1$/;
export const WRONG_OPTION = /Option 2$/;

let issued = 0;

/** A mobile no other spec in this run has signed up with. */
export function freshMobile(): string {
  issued += 1;
  return `9${String(Date.now() + issued).slice(-9)}`;
}

/** Signs in with the code the console sender echoes on screen; the first sign-in is the sign-up. */
export async function signIn(page: Page, mobile: string): Promise<void> {
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
}

/** The next start or resume this page sends, as the server answered it. */
export const nextStart = (page: Page): Promise<Response> =>
  page.waitForResponse(
    (response) => response.request().method() === 'POST' && START_URL.test(response.url()),
  );

/** From the signed-in home, through the instructions to the paper; the start (or resume) response is returned. */
export async function openPaper(page: Page, door: 'Start test' | 'Resume'): Promise<Response> {
  await page.getByRole('link', { name: door, exact: true }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Language' }).click();
  await page.getByRole('option', { name: 'English' }).click();
  await page.getByRole('checkbox', { name: /I have read the instructions/ }).check();
  const started = nextStart(page);
  await page.getByRole('button', { name: 'I am ready to begin' }).click();
  return started;
}

/** The next autosave that carries at least one answer, as the server answered it. */
export const nextAnswerSave = (page: Page): Promise<Response> =>
  page.waitForResponse((response) => {
    const request = response.request();
    if (request.method() !== 'PATCH' || !STATE_URL.test(response.url())) return false;
    const body = request.postDataJSON() as { answers?: unknown[] } | null;
    return (body?.answers?.length ?? 0) > 0;
  });

/** The `data` of an API envelope. */
export async function dataOf<T>(response: Response): Promise<T> {
  const body = (await response.json()) as { success: boolean; data: T };
  expect(body.success).toBe(true);
  return body.data;
}

/** Seconds left on the hall's countdown, as drawn. */
export async function secondsLeft(page: Page): Promise<number> {
  const text = (await page.getByRole('timer').textContent()) ?? '';
  const clock = CLOCK_PATTERN.exec(text)?.[0] ?? '0';
  return clock.split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

/** Submits from the open paper and waits for the scored result. */
export async function submitAndReadNet(page: Page, net: RegExp): Promise<void> {
  await page.getByRole('button', { name: 'Submit' }).click();
  await page
    .getByRole('dialog', { name: 'Submit this test?' })
    .getByRole('button', { name: 'Submit' })
    .click();
  await expect(page.getByRole('heading', { name: 'Handed in' })).toBeVisible();
  await page.getByRole('link', { name: 'See your result' }).click();
  await expect(page.getByRole('figure', { name: net })).toBeVisible({ timeout: 30_000 });
}
