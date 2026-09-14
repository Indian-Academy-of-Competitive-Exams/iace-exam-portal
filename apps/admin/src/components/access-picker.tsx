import { usePagedPicker } from '@iace/app-kit';
import { Combobox, MultiCombobox, plural } from '@iace/ui';
import { api } from '../lib/api';
import { QUERY_KEYS, QUERY_SCOPES } from '../lib/constants';
import { type MultiPickerProps, type PickerProps } from './picker-props';

/** A program is picked by its CODE: a student row and a series both store that string with no FK. */

/** Only active programs: the server refuses a retired one, so it is never offered. */
export function ProgramPicker(props: Readonly<PickerProps>) {
  const programs = usePagedPicker({
    queryKey: [...QUERY_KEYS.PROGRAMS, QUERY_SCOPES.PICKER],
    fetchPage: (params) => api.admin.programs.list({ ...params, activeOnly: 'true' }),
  });

  return (
    <Combobox
      {...props}
      {...programs.paging}
      placeholder={props.placeholder ?? 'Any program'}
      items={programs.items.map((program) => ({
        value: program.code,
        label: program.code,
        hint: program.name,
      }))}
      searchPlaceholder="Search programs"
      emptyLabel="No program matches that"
    />
  );
}

/** Only active events: an event nobody is running is not a roster to build a series on. */
export function EventPicker(props: Readonly<PickerProps>) {
  const events = usePagedPicker({
    queryKey: [...QUERY_KEYS.EVENTS, QUERY_SCOPES.PICKER],
    fetchPage: (params) => api.admin.events.list({ ...params, activeOnly: 'true' }),
  });

  return (
    <Combobox
      {...props}
      {...events.paging}
      placeholder={props.placeholder ?? 'Any event'}
      items={events.items.map((event) => ({
        value: event.id,
        label: event.name,
        hint: plural(event.candidateCount, 'candidate'),
      }))}
      searchPlaceholder="Search events"
      emptyLabel="No event matches that"
    />
  );
}

/** What the dialog that grants a series has to say about it before the row is written. */
export interface ChosenSeries {
  id: string;
  name: string;
  /** A grant onto a switched-off series opens nothing yet, which only the dialog can say. */
  isEnabled: boolean;
}

/** What a cleared series picker hands back, so nothing has to spell out the empty shape twice. */
export const NO_SERIES: ChosenSeries = {
  id: '',
  name: '',
  isEnabled: false,
};

/** The row comes back with the id because what asks for a series next is a dialog naming it. */
export function TestSeriesPicker({
  notReachedBy,
  forExamStageId,
  onChange,
  ...props
}: Readonly<
  Omit<PickerProps, 'onChange'> & {
    /** A student id: the server drops what they already reach, so a grant that does nothing is unofferable. */
    notReachedBy?: string;
    /** The stage of the test being offered: hides series built for a different one. */
    forExamStageId?: string;
    onChange: (chosen: ChosenSeries) => void;
  }
>) {
  // Empty is a stage ASKED for and not yet picked, which the server would read as no filter at all.
  const awaitingStage = forExamStageId === '';

  const series = usePagedPicker({
    queryKey: [
      ...QUERY_KEYS.TEST_SERIES,
      QUERY_SCOPES.PICKER,
      notReachedBy ?? '',
      forExamStageId ?? '',
    ],
    fetchPage: (params) => api.admin.testSeries.list({ ...params, notReachedBy, forExamStageId }),
    enabled: !awaitingStage,
  });

  const chosenOf = (value: string): ChosenSeries => {
    const row = series.items.find((held) => held.id === value);
    if (!row) return NO_SERIES;
    return { id: row.id, name: row.name, isEnabled: row.isEnabled };
  };

  return (
    <Combobox
      {...props}
      {...series.paging}
      disabled={awaitingStage || props.disabled}
      placeholder={awaitingStage ? 'Choose a stage first' : (props.placeholder ?? 'No series')}
      items={series.items.map((row) => ({
        value: row.id,
        label: row.name,
        hint: row.examStage ? `${row.examStage.examCode} / ${row.examStage.name}` : undefined,
      }))}
      onChange={(value) => onChange(chosenOf(value))}
      searchPlaceholder="Search series"
      emptyLabel="No series matches that"
    />
  );
}

/** A FILTER, so unlike `ProgramPicker` it reaches retired programs — students are still on them. */
export function ProgramMultiPicker({
  placeholder = 'Any program',
  ...props
}: Readonly<MultiPickerProps>) {
  const programs = usePagedPicker({
    queryKey: [...QUERY_KEYS.PROGRAMS, QUERY_SCOPES.FILTER],
    fetchPage: (params) => api.admin.programs.list(params),
  });

  return (
    <MultiCombobox
      {...props}
      {...programs.paging}
      chips={false}
      placeholder={placeholder}
      items={programs.items.map((program) => ({
        value: program.code,
        label: program.code,
        hint: program.name,
      }))}
      searchPlaceholder="Search programs"
      emptyLabel="No program matches that"
    />
  );
}

/** Which events a roster is being read through — the events themselves, not their candidates. */
export function EventMultiPicker({
  placeholder = 'Any event',
  ...props
}: Readonly<MultiPickerProps>) {
  const events = usePagedPicker({
    queryKey: [...QUERY_KEYS.EVENTS, QUERY_SCOPES.FILTER],
    fetchPage: (params) => api.admin.events.list(params),
  });

  return (
    <MultiCombobox
      {...props}
      {...events.paging}
      chips={false}
      placeholder={placeholder}
      items={events.items.map((event) => ({ value: event.id, label: event.name }))}
      searchPlaceholder="Search events"
      emptyLabel="No event matches that"
    />
  );
}

/** A candidate on an event is a student row, so a roster is picked out of the directory itself. */
export function StudentMultiPicker({
  placeholder = 'No students chosen',
  ...props
}: Readonly<MultiPickerProps>) {
  const students = usePagedPicker({
    queryKey: [...QUERY_KEYS.STUDENTS, QUERY_SCOPES.PICKER],
    fetchPage: (params) => api.admin.students.list(params),
  });

  return (
    <MultiCombobox
      {...props}
      {...students.paging}
      placeholder={placeholder}
      items={students.items.map((student) => ({
        value: student.id,
        label: student.fullName ?? student.mobile,
        hint: student.mobile,
      }))}
      searchPlaceholder="Search by name or mobile number"
      emptyLabel="No student matches that"
    />
  );
}
