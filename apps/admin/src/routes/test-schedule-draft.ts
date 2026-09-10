import { fromInstituteWallTime, instituteWallTime, type TestDetail } from '@iace/contracts';

/** The test's clock as the schedule step holds it: institute wall time on screen, instants on the wire. */

export interface ProgramOpening {
  programCode: string;
  /** Institute wall time, which is the only form a picker speaks. */
  opensAt: string;
}

export interface ScheduleDraft {
  opensAt: string;
  programs: readonly ProgramOpening[];
}

export interface ScheduleChanges {
  opening: boolean;
  written: readonly ProgramOpening[];
  cleared: readonly string[];
  count: number;
}

export type ScheduleSource = Pick<TestDetail, 'opensAt' | 'programUnlocks'>;

export const wallOf = (at: string | null): string => (at ? instituteWallTime(new Date(at)) : '');

export const instantOf = (wall: string): string => fromInstituteWallTime(wall).toISOString();

export const savedSchedule = (detail: ScheduleSource): ScheduleDraft => ({
  opensAt: wallOf(detail.opensAt),
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

  return {
    opening,
    written,
    cleared,
    count: written.length + cleared.length + Number(opening),
  };
}
