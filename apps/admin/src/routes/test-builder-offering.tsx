import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AppException,
  OPENING_HAS_PASSED,
  TEST_STATUS,
  offerRequirements,
  todayISO,
  type TestDetail,
} from '@iace/contracts';
import {
  Checkbox,
  ConfirmDialog,
  DateTimePicker,
  Field,
  FormSection,
  SectionHeading,
  plural,
} from '@iace/ui';
import { api } from '../lib/api';
import { ProgramPicker, TestSeriesPicker } from '../components/access-picker';
import { QUERY_KEYS } from '../lib/constants';
import { opensLabel } from '../lib/schedule-format';
import { instantOf, type ProgramOpening, type ScheduleDraft } from './test-schedule-draft';
import {
  applyOffer,
  type OfferChanges,
  type OfferDraft,
  type OfferWrites,
  type PassedOpenings,
} from './test-offer-draft';
import type { OfferHold, ProgramRefusal } from './use-offer-draft';

/** Who is offered the test, when it opens, and whether it is offered — all written by Done. */

const PROGRAM_RULE = 'A program opening lets that cohort start earlier than everybody else.';

const OVERTAKEN_PROGRAMS_DROPPED = "A program opening later than the test's own is dropped.";

const EVERY_PROGRAM_DROPPED = 'Every program opening is dropped with it.';

type EditOffer = (next: Partial<OfferDraft>) => void;

export function OfferStep({ detail, offer }: Readonly<{ detail: TestDetail; offer: OfferHold }>) {
  const { saved, held } = offer;
  if (!saved || !held) return null;

  const edit: EditOffer = (next) => offer.edit({ ...held, ...next });

  return (
    <>
      <SeriesSection detail={detail} />
      <ScheduleSection
        detail={detail}
        held={held}
        passed={offer.passed}
        refused={offer.refused}
        onEdit={edit}
      />
      <OfferSection detail={detail} saved={saved} held={held} onEdit={edit} />
    </>
  );
}

/** Shown, never changed here: a test moves from its series page, which confirms the move itself. */
function SeriesSection({ detail }: Readonly<{ detail: TestDetail }>) {
  return (
    <FormSection title="Series">
      <Field
        htmlFor="test-series"
        label="Series"
        className="max-w-lg"
        // ui-copy-ok: rule — why the picker is locked, which a disabled control cannot say
        hint={
          detail.attemptCount > 0
            ? 'A test stops moving once anybody has sat it.'
            : 'A test moves to another series from its series page.'
        }
      >
        {(control) => (
          <TestSeriesPicker
            {...control}
            clearable={false}
            value={detail.testSeriesId}
            selectedLabel={detail.testSeriesName}
            disabled
            forExamStageId={detail.examStageId}
            onChange={() => undefined}
          />
        )}
      </Field>
    </FormSection>
  );
}

function ScheduleSection({
  detail,
  held,
  passed,
  refused,
  onEdit,
}: Readonly<{
  detail: TestDetail;
  held: OfferDraft;
  passed: PassedOpenings;
  refused: ProgramRefusal | null;
  onEdit: EditOffer;
}>) {
  const { schedule } = held;
  const sat = detail.attemptCount > 0;
  const today = todayISO();

  const programError = (programCode: string): string | undefined => {
    if (refused?.programCode === programCode) return refused.message;
    return passed.programs.has(programCode) ? OPENING_HAS_PASSED : undefined;
  };

  const setSchedule = (next: Partial<ScheduleDraft>) =>
    onEdit({ schedule: { ...schedule, ...next } });

  const setProgram = (programCode: string, opensAt: string) =>
    setSchedule({
      programs: schedule.programs.map((row) =>
        row.programCode === programCode ? { ...row, opensAt } : row,
      ),
    });

  const addProgram = (programCode: string) => {
    if (schedule.programs.some((row) => row.programCode === programCode)) return;
    setSchedule({ programs: [...schedule.programs, { programCode, opensAt: schedule.opensAt }] });
  };

  return (
    <FormSection title="Schedule">
      <div className="flex flex-wrap items-start gap-4">
        <Field
          htmlFor="test-opens"
          label="Opens (IST)"
          className="min-w-72 flex-1"
          /* ui-copy-ok: rule */
          hint={
            sat
              ? 'A test stops opening again once anybody has sat it.'
              : 'Blank opens it the moment a student reaches it.'
          }
          error={passed.opening ? OPENING_HAS_PASSED : undefined}
        >
          {(control) => (
            <DateTimePicker
              id={control.id}
              aria-label="Opens"
              aria-describedby={control['aria-describedby']}
              value={schedule.opensAt}
              onChange={(opensAt) => setSchedule({ opensAt })}
              minDate={today}
              disabled={sat}
            />
          )}
        </Field>
      </div>

      <SectionHeading level={3} title="Program openings" />

      <p className="text-sm text-muted-foreground">{PROGRAM_RULE}</p>

      {schedule.programs.map((row, index) => (
        <ProgramOpeningRow
          key={row.programCode}
          row={row}
          index={index}
          minDate={today}
          error={programError(row.programCode)}
          onChange={(next) => setProgram(row.programCode, next)}
        />
      ))}

      <div className="w-72">
        <ProgramPicker
          value=""
          clearable={false}
          placeholder="Add a program"
          aria-label="Add a program"
          onChange={addProgram}
        />
      </div>
    </FormSection>
  );
}

/** One program and when it opens. Its own component so the index only ever names the control. */
function ProgramOpeningRow({
  row,
  index,
  minDate,
  error,
  onChange,
}: Readonly<{
  row: ProgramOpening;
  index: number;
  minDate: string;
  error?: string;
  onChange: (opensAt: string) => void;
}>) {
  return (
    <Field
      htmlFor={`program-opens-${index}`}
      label={`${row.programCode} opens (IST)`}
      className="max-w-lg"
      // ui-copy-ok: rule
      hint="Blank drops this opening"
      error={error}
    >
      {(control) => (
        <DateTimePicker
          id={control.id}
          aria-label={`${row.programCode} opens`}
          aria-describedby={control['aria-describedby']}
          value={row.opensAt}
          onChange={onChange}
          minDate={minDate}
        />
      )}
    </Field>
  );
}

function OfferSection({
  detail,
  saved,
  held,
  onEdit,
}: Readonly<{ detail: TestDetail; saved: OfferDraft; held: OfferDraft; onEdit: EditOffer }>) {
  const ready = offerRequirements(detail).every((requirement) => requirement.met);

  return (
    <FormSection title="Offer">
      <Checkbox
        id="test-offered"
        checked={held.offered}
        disabled={!held.offered && !ready}
        onChange={(event) => onEdit({ offered: event.target.checked })}
        label="Offered to students"
        /* ui-copy-ok: consequence */ hint={offerNote(detail, saved, held)}
      />
    </FormSection>
  );
}

/** What the switch means right now, said beside it because Done is the only thing that acts on it. */
function offerNote(detail: TestDetail, saved: OfferDraft, held: OfferDraft): string {
  if (held.offered && saved.offered) {
    return `Offered to every student reached through ${held.series.name}. Its paper is frozen, and editing it takes the test back out until it is offered again.`;
  }
  if (held.offered) {
    const freeze = detail.isLocked
      ? ''
      : `freezes its ${plural(detail.totalQuestions, 'question')} and `;
    return `Pressing Done ${freeze}offers it to every student reached through ${held.series.name}.`;
  }
  if (saved.offered) {
    return `Pressing Done stops offering it to students reached through ${saved.series.name}. Attempts already sat keep their results.`;
  }

  const unmet = offerRequirements(detail).find((requirement) => !requirement.met);
  if (!unmet) return 'No student is offered it yet.';
  const owed = unmet.owed ? ` (${unmet.owed})` : '';
  return `It can be offered once ${unmet.label.charAt(0).toLowerCase()}${unmet.label.slice(1)}${owed}.`;
}

const whenOf = (wall: string): string => `${opensLabel(instantOf(wall))} IST`;

/** The server clears program rows an opening overtakes, and every one of them when it is cleared. */
function openingLines(saved: OfferDraft, held: OfferDraft): string[] {
  const { opensAt } = held.schedule;
  const lines = [opensAt ? `Opens ${whenOf(opensAt)}.` : 'Opens the moment a student reaches it.'];

  if (saved.schedule.programs.length > 0) {
    lines.push(opensAt ? OVERTAKEN_PROGRAMS_DROPPED : EVERY_PROGRAM_DROPPED);
  }
  return lines;
}

/** Every write Done is about to make, in plain words, so the one confirm names each of them. */
function changeLines(saved: OfferDraft, held: OfferDraft, changes: OfferChanges): string[] {
  const lines: string[] = [];
  const { schedule } = changes;

  if (changes.retiring) {
    lines.push(`Stops offering it to students reached through ${saved.series.name}.`);
  }
  if (schedule.opening) lines.push(...openingLines(saved, held));
  for (const row of schedule.written) {
    lines.push(`${row.programCode} opens ${whenOf(row.opensAt)}.`);
  }
  for (const programCode of schedule.cleared) {
    lines.push(`${programCode} no longer opens early.`);
  }
  if (changes.offering) {
    lines.push(`Offers it to every student reached through ${held.series.name}.`);
  }

  return lines;
}

/** The server owns the rule; this only puts its refusal under the row that caused it. */
const refusalOf = (programCode: string, error: unknown): ProgramRefusal | null => {
  const message = AppException.is(error) ? error.fieldErrors?.opensAt?.[0] : undefined;
  return message ? { programCode, message } : null;
};

function writesFor(
  testId: string,
  onRefused: (refusal: ProgramRefusal | null) => void,
): OfferWrites {
  return {
    retire: () => api.admin.tests.setStatus(testId, { status: TEST_STATUS.INACTIVE }),
    setOpening: (testSeriesId, unlockAt) =>
      api.admin.testSeries.setTestUnlock(testSeriesId, testId, { unlockAt }),
    setProgramOpening: async (programCode, opensAt) => {
      try {
        return await api.admin.tests.setProgramUnlock(testId, programCode, { opensAt });
      } catch (error) {
        onRefused(refusalOf(programCode, error));
        throw error;
      }
    },
    clearProgramOpening: (programCode) => api.admin.tests.clearProgramUnlock(testId, programCode),
    // One call: the freeze and the opening are one transaction, so neither lands without the other.
    offer: () => api.admin.tests.offer(testId),
  };
}

const savedMessage = (changes: OfferChanges | null): string => {
  if (changes?.offering) return 'Test offered to students.';
  if (changes?.retiring) return 'Test retired.';
  return 'Test saved.';
};

/** Done's one confirm, and the only place the Offer step writes anything. */
export function OfferSaveDialog({
  detail,
  offer,
  open,
  onOpenChange,
  onSaved,
}: Readonly<{
  detail: TestDetail;
  offer: OfferHold;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}>) {
  const queryClient = useQueryClient();
  const { saved, held, changes } = offer;

  const save = useMutation({
    meta: { success: savedMessage(changes), fields: ['opensAt'] },
    mutationFn: async () => {
      if (held && changes) await applyOffer(held, changes, writesFor(detail.id, offer.refuse));
    },
    onMutate: () => offer.refuse(null),
    onSuccess: () => {
      offer.discard();
      onSaved();
    },
    // Closed so a refusal under its row can be read; the draft stays for another try.
    onError: () => onOpenChange(false),
    // An opening deletes every program row it overtakes, so what stuck is read back, never assumed.
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TEST });
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TESTS });
    },
  });

  if (!saved || !held || !changes) return null;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      destructive={changes.retiring}
      title={`Save ${plural(changes.count, 'change')}?`}
      description="They are saved together, and you return to the tests list."
      confirmLabel="Save changes"
      loading={save.isPending}
      onConfirm={() => save.mutate()}
    >
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
        {changeLines(saved, held, changes).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </ConfirmDialog>
  );
}
