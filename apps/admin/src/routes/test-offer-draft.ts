import { TEST_STATUS, type TestDetail } from '@iace/contracts';
import {
  changesOf,
  instantOf,
  savedSchedule,
  type ScheduleChanges,
  type ScheduleDraft,
} from './test-schedule-draft';

/** Everything the Offer step holds until Done: the series, the clock, and whether students get it. */

export interface OfferSeries {
  id: string;
  name: string;
}

export interface OfferDraft {
  series: OfferSeries;
  schedule: ScheduleDraft;
  offered: boolean;
}

export interface OfferChanges {
  schedule: ScheduleChanges;
  offering: boolean;
  retiring: boolean;
  count: number;
}

/** The writes Done makes, named for what they do rather than the endpoints behind them. */
export interface OfferWrites {
  retire: () => Promise<unknown>;
  setOpening: (testSeriesId: string, unlockAt: string | null) => Promise<unknown>;
  setProgramOpening: (programCode: string, opensAt: string) => Promise<unknown>;
  clearProgramOpening: (programCode: string) => Promise<unknown>;
  offer: () => Promise<unknown>;
}

export type OfferSource = Pick<
  TestDetail,
  'testSeriesId' | 'testSeriesName' | 'status' | 'opensAt' | 'programUnlocks'
>;

export const savedOffer = (detail: OfferSource): OfferDraft => ({
  series: { id: detail.testSeriesId, name: detail.testSeriesName },
  schedule: savedSchedule(detail),
  offered: detail.status === TEST_STATUS.ACTIVE,
});

export function offerChangesOf(saved: OfferDraft, held: OfferDraft): OfferChanges {
  const schedule = changesOf(saved.schedule, held.schedule);
  const offering = held.offered && !saved.offered;
  const retiring = saved.offered && !held.offered;

  return {
    schedule,
    offering,
    retiring,
    count: schedule.count + Number(offering || retiring),
  };
}

/** Retired first and offered last, so no student reaches a test on a half-written offer. */
export async function applyOffer(
  held: OfferDraft,
  changes: OfferChanges,
  writes: OfferWrites,
): Promise<void> {
  if (changes.retiring) await writes.retire();

  const { opensAt } = held.schedule;
  if (changes.schedule.opening) {
    await writes.setOpening(held.series.id, opensAt ? instantOf(opensAt) : null);
  }
  for (const row of changes.schedule.written) {
    await writes.setProgramOpening(row.programCode, instantOf(row.opensAt));
  }
  for (const programCode of changes.schedule.cleared) {
    await writes.clearProgramOpening(programCode);
  }

  if (changes.offering) await writes.offer();
}
