import { useWatch, type UseFormReturn } from 'react-hook-form';
import { FileText } from 'lucide-react';
import {
  EARLIEST_BIRTH_DATE,
  examsInCourses,
  GENDERS,
  instituteDateTimeLabel,
  STUDENT_TYPES,
  todayISO,
  type ExamCourse,
  type StudentDetail,
} from '@iace/contracts';
import {
  Alert,
  Badge,
  Button,
  Combobox,
  DatePicker,
  Field,
  FieldRow,
  FormCombobox,
  FormField,
  FormSection,
  Input,
  MultiCombobox,
  StatRow,
  TruncatedText,
} from '@iace/ui';
import { COURSE_ITEMS, GENDER_LABELS, STUDENT_TYPE_LABELS } from '../../lib/labels';
import { useBranchChoice, useBranches } from '../../lib/use-branches';
import { useExams } from './use-exams';
import { ProgramMultiPicker } from '../../components/access-picker';
import { FIELD_LABELS, type FormValues } from './student-detail-values';

/** One uploaded document. Opens in a new tab — these are short-lived signed links. */
function DocumentLink({ label, url }: Readonly<{ label: string; url?: string | null }>) {
  if (!url) {
    return <Badge variant="neutral">{label}: not uploaded</Badge>;
  }

  return (
    <Button variant="outline" size="sm" asChild>
      <a href={url} target="_blank" rel="noreferrer">
        <FileText aria-hidden />
        {label}
      </a>
    </Button>
  );
}

/** Where a student sits relative to the institute — the fields access resolves through. */
function AccessCard({ form }: Readonly<{ form: UseFormReturn<FormValues> }>) {
  // Unfiltered — an exam retired since they enrolled is offered only to take it off them.
  const { exams: everyExam } = useExams();
  const heldExams = form.formState.defaultValues?.enrolledExams ?? [];
  const exams = everyExam.filter((exam) => exam.isActive || heldExams.includes(exam.code));
  // Unfiltered — a student's branch may have since been retired, and must still resolve to a name, not the raw id.
  const { branches: allBranches } = useBranches();
  const enrolledExams = useWatch({ control: form.control, name: 'enrolledExams' }) ?? [];
  const enrolledCourses = useWatch({ control: form.control, name: 'enrolledCourses' }) ?? [];
  const programs = useWatch({ control: form.control, name: 'programs' }) ?? [];
  const studentType = useWatch({ control: form.control, name: 'studentType' });
  const currentBranchId = useWatch({ control: form.control, name: 'currentBranchId' }) ?? '';
  const branch = useBranchChoice(studentType, form.formState.defaultValues?.currentBranchId);
  const shownBranchId = branch.shownId ?? currentBranchId;
  const currentBranchName = allBranches.find((option) => option.id === shownBranchId)?.name;

  return (
    <FormSection title="Access">
      <div className="flex flex-col gap-4">
        <FormCombobox
          form={form}
          name="studentType"
          label={FIELD_LABELS.studentType}
          items={STUDENT_TYPES.map((value) => ({ value, label: STUDENT_TYPE_LABELS[value] }))}
        />

        <FormField form={form} name="enrolledCourses" label={FIELD_LABELS.enrolledCourses}>
          {({ id, 'aria-describedby': describedBy, 'aria-invalid': invalid }) => (
            <MultiCombobox
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={enrolledCourses}
              onChange={(next) =>
                form.setValue('enrolledCourses', next as ExamCourse[], { shouldDirty: true })
              }
              items={COURSE_ITEMS}
              chips={false}
              placeholder="No courses yet"
              emptyLabel="No course matches that"
            />
          )}
        </FormField>

        <FormField form={form} name="enrolledExams" label={FIELD_LABELS.enrolledExams}>
          {({ id, 'aria-describedby': describedBy, 'aria-invalid': invalid }) => (
            <MultiCombobox
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={enrolledExams}
              onChange={(next) => form.setValue('enrolledExams', next, { shouldDirty: true })}
              items={examsInCourses(exams, enrolledCourses, enrolledExams).map((exam) => ({
                value: exam.code,
                label: exam.code,
                hint: exam.isActive ? exam.name : `${exam.name}, retired`,
              }))}
              chips={false}
              placeholder="No exams yet"
              emptyLabel="No exam matches that"
            />
          )}
        </FormField>

        <FormField form={form} name="programs" label={FIELD_LABELS.programs}>
          {({ id, 'aria-describedby': describedBy, 'aria-invalid': invalid }) => (
            <ProgramMultiPicker
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={programs}
              onChange={(next) => form.setValue('programs', next, { shouldDirty: true })}
              held={form.formState.defaultValues?.programs?.filter((code) => code !== undefined)}
              placeholder="No programs yet"
            />
          )}
        </FormField>

        <FormField
          form={form}
          name="currentBranchId"
          label={FIELD_LABELS.currentBranchId}
          // ui-copy-ok: rule — why the picker is locked, which a disabled control cannot say
          hint={branch.hint}
        >
          {({ id, 'aria-describedby': describedBy, 'aria-invalid': invalid }) => (
            <Combobox
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              disabled={branch.locked}
              value={shownBranchId}
              selectedLabel={currentBranchName}
              onChange={(next) => form.setValue('currentBranchId', next, { shouldDirty: true })}
              items={branch.branches.map((option) => ({ value: option.id, label: option.name }))}
              placeholder="Not recorded"
              emptyLabel="No branch matches that"
            />
          )}
        </FormField>

        {branch.droppedName ? (
          <Alert variant="warning">Saving drops their branch, {branch.droppedName}.</Alert>
        ) : null}
      </div>
    </FormSection>
  );
}

type StudentProfile = NonNullable<StudentDetail['profile']>;
type EducationEntry = NonNullable<StudentProfile['educationDetails']>[number];
type PastExamEntry = NonNullable<StudentProfile['pastExamHistory']>[number];

interface HistoryRow {
  primary: string;
  secondary: string;
}

const dotted = (parts: readonly (string | number | undefined)[]) =>
  parts.filter((part) => part !== undefined && part !== '').join(' · ');

const educationRow = (entry: EducationEntry): HistoryRow => ({
  primary: entry.level,
  secondary: dotted([
    entry.board,
    entry.institution,
    entry.year,
    entry.percentage === undefined ? undefined : `${entry.percentage}%`,
  ]),
});

const pastExamRow = (entry: PastExamEntry): HistoryRow => ({
  primary: entry.exam,
  secondary: dotted([entry.year, entry.result]),
});

/** What the student reported about themselves; nothing here is editable by an admin. */
function HistorySection({ title, rows }: Readonly<{ title: string; rows: readonly HistoryRow[] }>) {
  if (rows.length === 0) return null;

  return (
    <FormSection title={title}>
      <ul className="flex flex-col gap-2 text-sm">
        {rows.map((row) => (
          <li key={`${row.primary}|${row.secondary}`} className="flex min-w-0 flex-col">
            <TruncatedText className="font-medium">{row.primary}</TruncatedText>
            {row.secondary ? (
              <TruncatedText className="text-muted-foreground">{row.secondary}</TruncatedText>
            ) : null}
          </li>
        ))}
      </ul>
    </FormSection>
  );
}

/** The one tab the form owns: everything Edit and Save reach. */
export function DetailsTab({
  form,
  detail,
}: Readonly<{ form: UseFormReturn<FormValues>; detail: StudentDetail }>) {
  const dob = useWatch({ control: form.control, name: 'dob' }) ?? '';

  return (
    <>
      <FormSection title="Uploads">
        <div className="flex flex-wrap gap-2">
          <DocumentLink label="Passport photo" url={detail.profile?.photoUrl} />
          <DocumentLink label="Class 10 marksheet" url={detail.profile?.tenthMarksheetUrl} />
        </div>
      </FormSection>

      <div className="grid gap-8 lg:grid-cols-2">
        <FormSection title="Details">
          <div className="flex flex-col gap-4">
            <FormField form={form} name="fullName" label={FIELD_LABELS.fullName}>
              {(control) => <Input {...control} />}
            </FormField>

            <FieldRow>
              <FormField form={form} name="motherName" label={FIELD_LABELS.motherName}>
                {(control) => <Input {...control} />}
              </FormField>
              <FormField form={form} name="fatherName" label={FIELD_LABELS.fatherName}>
                {(control) => <Input {...control} />}
              </FormField>
            </FieldRow>

            <FieldRow>
              <Field
                htmlFor="dob"
                label={FIELD_LABELS.dob}
                error={form.formState.errors.dob?.message}
              >
                {/* Bounded both ends: a picker offering what the server refuses is a dead end. */}
                {(control) => (
                  <DatePicker
                    {...control}
                    min={EARLIEST_BIRTH_DATE}
                    max={todayISO()}
                    value={dob}
                    onChange={(next) => form.setValue('dob', next, { shouldDirty: true })}
                  />
                )}
              </Field>
              <FormCombobox
                form={form}
                name="gender"
                label={FIELD_LABELS.gender}
                clearable
                placeholder="Not recorded"
                items={GENDERS.map((value) => ({ value, label: GENDER_LABELS[value] }))}
              />
            </FieldRow>

            <FormField form={form} name="email" label={FIELD_LABELS.email}>
              {(control) => <Input {...control} type="email" />}
            </FormField>

            <FormField form={form} name="address" label={FIELD_LABELS.address}>
              {(control) => <Input {...control} />}
            </FormField>
          </div>
        </FormSection>

        <div className="flex flex-col gap-8">
          <AccessCard form={form} />

          <FormSection title="Record">
            <div className="flex flex-col gap-2">
              <StatRow label="Created" value={instituteDateTimeLabel(detail.createdAt)} />
              <StatRow label="Last changed" value={instituteDateTimeLabel(detail.updatedAt)} />
            </div>
          </FormSection>

          <HistorySection
            title="Education"
            rows={(detail.profile?.educationDetails ?? []).map(educationRow)}
          />
          <HistorySection
            title="Past exams"
            rows={(detail.profile?.pastExamHistory ?? []).map(pastExamRow)}
          />
        </div>
      </div>
    </>
  );
}
