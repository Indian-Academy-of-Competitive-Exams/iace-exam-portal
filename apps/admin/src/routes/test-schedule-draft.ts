import { fromInstituteWallTime, instituteWallTime, type TestDetail } from '@iace/contracts';
import { toMinutes } from '../lib/schedule-format';

/** The test's clock as the schedule step holds it: institute wall time on screen, instants on the wire. */

export interface ProgramOpening {
  programCode: string;
  /** Institute wall time, which is the only form a picker speaks. */
  opensAt: string;
}

export interface ScheduleDraft {
  opensAt: string;
  extraTime: string;
  programs: readonly ProgramOpening[];
}

export interface ScheduleChanges {
  opening: boolean;
  timing: boolean;
  written: readonly ProgramOpening[];
  cleared: readonly string[];
  count: number;
}

export type ScheduleSource = Pick<TestDetail, 'opensAt' | 'extraTimeSec' | 'programUnlocks'>;

export const wallOf = (at: string | null): string => (at ? instituteWallTime(new Date(at)) : '');

export const instantOf = (wall: string): string => fromInstituteWallTime(wall).toISOString();

export const savedSchedule = (detail: ScheduleSource): ScheduleDraft => ({
  opensAt: wallOf(detail.opensAt),
  extraTime: toMinutes(detail.extraTimeSec),
  programs: detail.programUnlocks.map((row) => ({
    programCode: row.programCode,
    opensAt: wallOf(row.opensAt),
  })),
});

/** A blank time is not "no change": emptying a saved row is how an opening is taken away. */
export function changesOf(saved: ScheduleDraft, held: ScheduleDraft): ScheduleChanges {
  const before = new Map(saved.programs.map((row) => [row.programCode, row.opensAt]));
  const timed = new Set(
    held.programs.filter((row) => row.opensAt !== '').map((row) => row.programCode),
  );

  const written = held.programs.filter(
    (row) => row.opensAt !== '' && before.get(row.programCode) !== row.opensAt,
  );
  const cleared = saved.programs
    .filter((row) => !timed.has(row.programCode))
    .map((row) => row.programCode);
  const opening = held.opensAt !== saved.opensAt;
  const timing = held.extraTime !== saved.extraTime;

  return {
    opening,
    timing,
    written,
    cleared,
    count: written.length + cleared.length + Number(opening) + Number(timing),
  };
}
