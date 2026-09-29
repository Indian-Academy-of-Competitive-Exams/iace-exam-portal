import { TEST_STATUS, testIsOpen, type SaveOfferingInput, type TestDetail } from '@iace/contracts';
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

export interface PassedOpenings {
  opening: boolean;
  programs: ReadonlySet<string>;
}

export const NONE_PASSED: PassedOpenings = { opening: false, programs: new Set() };

/** Only what Done would write is judged: a saved opening that has since passed is history. */
export function passedOpenings(saved: OfferDraft, held: OfferDraft, now: Date): PassedOpenings {
  const changes = changesOf(saved.schedule, held.schedule);
  const passed = (wall: string) => testIsOpen(instantOf(wall), now);
  const { opensAt } = held.schedule;

  return {
    opening: changes.opening && opensAt !== '' && passed(opensAt),
    programs: new Set(
      changes.written.filter((row) => passed(row.opensAt)).map((row) => row.programCode),
    ),
  };
}

export const anyPassed = (passed: PassedOpenings): boolean =>
  passed.opening || passed.programs.size > 0;

/** Done's one write: the whole held Offer step, since the server judges what changed against what it holds. */
export const offeringBodyOf = (held: OfferDraft): SaveOfferingInput => ({
  opensAt: held.schedule.opensAt ? instantOf(held.schedule.opensAt) : null,
  programOpenings: held.schedule.programs
    .filter((row) => row.opensAt !== '')
    .map((row) => ({ programCode: row.programCode, opensAt: instantOf(row.opensAt) })),
  offered: held.offered,
});
