import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useForm, useWatch } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ASSIGNMENT_ROLES,
  PAPER_SOURCES,
  PAPER_SOURCE_LABELS,
  scopedSections,
  instituteDayLabel,
  type Assignment,
  type AssignmentRole,
  type BaseConfigDetail,
  type BaseConfigSection,
  type PaperSource,
  type TestDetail,
} from '@iace/contracts';
import { applyFieldErrors } from '@iace/app-kit';
import { UserPlus, UserRoundPen } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenuItem,
  EmptyState,
  EMPTY_STATE_KINDS,
  Field,
  FormCombobox,
  FormDialog,
  FormSection,
  RadioGroup,
  RadioGroupItem,
  RowActions,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TruncatedText,
  DatePicker,
  linkVariants,
  plural,
  type BadgeProps,
  type DataTableColumn,
} from '@iace/ui';
import { api } from '../lib/api';
import { useAuth } from '../providers/auth';
import { ASSIGNMENT_ROLE_LABELS, QUERY_KEYS, ROUTES } from '../lib/constants';
import { sectionFullness, sectionTally } from './test-paper-view';
import { SectionThreadButton } from '../components/section-thread';

/** Sits beside the paper it staffs: who types and reads each section, before the paper is judged. */

const ROLE_ORDER = [ASSIGNMENT_ROLES.TYPIST, ASSIGNMENT_ROLES.PROOFREADER] as const;

/** What each source means for the people on it, said beside the choice that fixes it for good. */
const SOURCE_CHOICES = {
  [PAPER_SOURCES.FRAMED]: {
    hint: 'A typist writes each section and a proof-reader checks it before it reaches you.',
  },
  [PAPER_SOURCES.PICKED]: {
    hint: 'You pick each section from the bank; a proof-reader checks it and a typist fixes what they send back.',
  },
} as const;

const SOURCE_ORDER = [PAPER_SOURCES.FRAMED, PAPER_SOURCES.PICKED] as const;

/** The holder a role has now; an earlier one stays on the record but no longer acts. */
const holding = (rows: readonly Assignment[], section: string, role: AssignmentRole) =>
  rows.find(
    (row) => row.baseConfigSectionId === section && row.role === role && row.replacedAt === null,
  );

const earlier = (rows: readonly Assignment[], section: string, role: AssignmentRole) =>
  rows.filter(
    (row) => row.baseConfigSectionId === section && row.role === role && row.replacedAt !== null,
  );

interface SectionRow {
  section: BaseConfigSection;
  typist?: Assignment;
  proofreader?: Assignment;
  earlierTypists: Assignment[];
  earlierReaders: Assignment[];
}

interface AssignTarget {
  section: BaseConfigSection;
  role: AssignmentRole;
}

export function AssignStep({
  detail,
  config,
}: Readonly<{ detail: TestDetail | null; config: BaseConfigDetail | null }>) {
  const { identity } = useAuth();
  const assignments = useQuery({
    queryKey: [...QUERY_KEYS.ASSIGNMENTS, detail?.id ?? ''],
    queryFn: () => api.admin.assignments.forTest(detail?.id ?? ''),
    enabled: Boolean(detail?.id),
  });
  const paper = useQuery({
    queryKey: [...QUERY_KEYS.TEST_PAPER, detail?.id ?? ''],
    queryFn: () => api.admin.tests.readPaper(detail?.id ?? ''),
    enabled: Boolean(detail?.paperSource),
  });
  const [assigning, setAssigning] = useState<AssignTarget | null>(null);
  const [removing, setRemoving] = useState<Assignment | null>(null);
  const [handingOver, setHandingOver] = useState<BaseConfigSection | null>(null);

  if (!detail || !config) {
    return (
      <EmptyState title="No paper yet" /* ui-copy-ok: rule */ hint="Save this test to build one." />
    );
  }
  const sections = scopedSections(config.sections, detail.scope, detail.scopeRef);
  if (sections.length === 0) {
    return (
      <EmptyState
        title="No sections"
        /* ui-copy-ok: consequence */
        hint="This test's configuration has none, so there is no paper to build."
      />
    );
  }

  if (detail.paperSource === null) return <SourceDialog testId={detail.id} />;

  if (assignments.isError) {
    return (
      <FormSection title="Assignments">
        <EmptyState
          kind={EMPTY_STATE_KINDS.FAILURE}
          title="Could not load the assignments"
          onRetry={assignments.refetch}
        />
      </FormSection>
    );
  }

  const all = assignments.data ?? [];
  const rowOf = (section: BaseConfigSection): SectionRow => ({
    section,
    typist: holding(all, section.id, ASSIGNMENT_ROLES.TYPIST),
    proofreader: holding(all, section.id, ASSIGNMENT_ROLES.PROOFREADER),
    earlierTypists: earlier(all, section.id, ASSIGNMENT_ROLES.TYPIST),
    earlierReaders: earlier(all, section.id, ASSIGNMENT_ROLES.PROOFREADER),
  });
  const outstanding = all.some(
    (row) =>
      row.replacedAt === null &&
      row.finalizedAt === null &&
      (row.role === ASSIGNMENT_ROLES.PROOFREADER || detail.paperSource === PAPER_SOURCES.FRAMED),
  );
  // The server refuses anybody else, so a box they cannot post from is not shown at all.
  const mayComment = (row: SectionRow): boolean =>
    (identity?.isSuperAdmin ?? false) ||
    [row.typist, row.proofreader].some((held) => held?.assigneeId === identity?.id);

  const held = paper.data ? heldBySection(paper.data) : null;

  return (
    <FormSection title="Sections" meta={PAPER_SOURCE_LABELS[detail.paperSource]}>
      {outstanding && !detail.finalizedAt ? (
        <Alert variant="info">
          A test cannot be offered until every section is released by its proof-reader.
        </Alert>
      ) : null}

      <DataTable
        columns={columnsOf({
          testId: detail.id,
          source: detail.paperSource,
          held,
          mayComment,
          // An offered paper takes nobody new and loses nobody: there is nothing left to type or read.
          onAssign: detail.finalizedAt ? null : setAssigning,
          onRemove: detail.finalizedAt ? null : setRemoving,
          onHandOver: detail.finalizedAt ? null : setHandingOver,
        })}
        rows={sections.map(rowOf)}
        rowKey={(row) => row.section.id}
        isLoading={assignments.isLoading}
        empty="No sections"
      />

      {assigning ? (
        <AssignDialog
          key={`${assigning.section.id}-${assigning.role}`}
          testId={detail.id}
          section={assigning.section}
          role={assigning.role}
          onClose={() => setAssigning(null)}
          onAssigned={() => assignments.refetch()}
        />
      ) : null}

      <RemoveDialog
        assignment={removing}
        onClose={() => setRemoving(null)}
        onRemoved={() => assignments.refetch()}
      />

      <HandOverDialog
        testId={detail.id}
        section={handingOver}
        onClose={() => setHandingOver(null)}
        onHanded={() => assignments.refetch()}
      />
    </FormSection>
  );
}

/** Amber only where work has started and stalled: an untouched section is not a warning. */
const CHIP_VARIANT = {
  EMPTY: 'neutral',
  SHORT: 'warning',
  FULL: 'success',
} as const;

function heldBySection(paper: {
  sections: readonly { baseConfigSectionId: string; questions: readonly unknown[] }[];
}): ReadonlyMap<string, number> {
  return new Map(paper.sections.map((one) => [one.baseConfigSectionId, one.questions.length]));
}

function PaperCell({
  section,
  held,
}: Readonly<{ section: BaseConfigSection; held: ReadonlyMap<string, number> | null }>) {
  const fullness = sectionFullness(section, held);
  const tally = sectionTally(section, held);
  if (!fullness || !tally) return <Badge variant="neutral">{section.questionCount}</Badge>;
  return <Badge variant={CHIP_VARIANT[fullness]}>{tally}</Badge>;
}

interface ColumnsInput {
  testId: string;
  source: PaperSource;
  held: ReadonlyMap<string, number> | null;
  mayComment: (row: SectionRow) => boolean;
  onAssign: ((target: AssignTarget) => void) | null;
  onRemove: ((assignment: Assignment) => void) | null;
  onHandOver: ((section: BaseConfigSection) => void) | null;
}

function columnsOf({
  testId,
  source,
  held,
  mayComment,
  onAssign,
  onRemove,
  onHandOver,
}: ColumnsInput): DataTableColumn<SectionRow>[] {
  return [
    {
      key: 'section',
      header: 'Section',
      className: 'max-w-[14rem] font-medium',
      cell: (row) => (
        <Link to={ROUTES.SECTION(testId, row.section.id)} className={linkVariants()}>
          <TruncatedText>{row.section.name}</TruncatedText>
        </Link>
      ),
    },
    {
      key: 'paper',
      header: 'Paper',
      cell: (row) => <PaperCell section={row.section} held={held} />,
    },
    {
      key: 'typist',
      header: 'Typist',
      className: 'max-w-[12rem]',
      cell: (row) => (
        <RoleCell
          assignment={row.typist}
          earlier={row.earlierTypists}
          questionCount={row.section.questionCount}
          onAssign={
            onAssign
              ? () => onAssign({ section: row.section, role: ASSIGNMENT_ROLES.TYPIST })
              : undefined
          }
        />
      ),
    },
    {
      key: 'proofreader',
      header: 'Proof-reader',
      className: 'max-w-[12rem]',
      cell: (row) => (
        <RoleCell
          assignment={row.proofreader}
          earlier={row.earlierReaders}
          questionCount={row.section.questionCount}
          onAssign={
            onAssign
              ? () => onAssign({ section: row.section, role: ASSIGNMENT_ROLES.PROOFREADER })
              : undefined
          }
        />
      ),
    },
    {
      key: 'comments',
      header: 'Comments',
      cell: (row) => (
        <SectionThreadButton
          testId={testId}
          sectionId={row.section.id}
          canWrite={mayComment(row)}
        />
      ),
    },
    {
      key: 'actions',
      className: 'text-right',
      cell: (row) => (
        <SectionActions
          testId={testId}
          row={row}
          onRemove={onRemove}
          onHandOver={handOverFor(row, source, held, onHandOver)}
        />
      ),
    },
  ];
}

/** Offered only where it would succeed: a picked section, full, with a reader it has not reached. */
function handOverFor(
  row: SectionRow,
  source: PaperSource,
  held: ReadonlyMap<string, number> | null,
  onHandOver: ((section: BaseConfigSection) => void) | null,
): (() => void) | null {
  const reader = row.proofreader;
  const full = (held?.get(row.section.id) ?? 0) >= row.section.questionCount;
  const ready = source === PAPER_SOURCES.PICKED && full && reader && !reader.handedAt;
  return ready && onHandOver ? () => onHandOver(row.section) : null;
}

/** Framed or picked, chosen in a dialog the first time the paper is opened, and never again. */
function SourceDialog({ testId }: Readonly<{ testId: string }>) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(true);
  const [chosen, setChosen] = useState<PaperSource | ''>('');

  const choose = useMutation({
    meta: { success: 'Question source set.' },
    mutationFn: (paperSource: PaperSource) => api.admin.tests.update(testId, { paperSource }),
    onSuccess: async (saved) => {
      queryClient.setQueryData([...QUERY_KEYS.TEST, saved.id], saved);
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ASSIGNMENTS });
      setOpen(false);
    },
  });

  return (
    <>
      <EmptyState
        title="No question source yet"
        action={
          <Button type="button" onClick={() => setOpen(true)}>
            Choose question source
          </Button>
        }
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Question source</DialogTitle>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <Alert variant="warning">
              Chosen once for this test. Nobody can change it afterwards.
            </Alert>
            <RadioGroup
              name="paper-source"
              legend="Question source"
              hideLegend
              value={chosen}
              onValueChange={(next) => setChosen(next as PaperSource)}
              className="grid gap-3"
            >
              {SOURCE_ORDER.map((source) => (
                <RadioGroupItem
                  key={source}
                  id={`paper-source-${source}`}
                  value={source}
                  className="rounded-lg border border-border p-3 has-[input:checked]:border-primary"
                  label={
                    <span className="flex flex-col gap-1">
                      <span className="font-medium">{PAPER_SOURCE_LABELS[source]}</span>
                      <span className="text-sm text-muted-foreground">
                        {SOURCE_CHOICES[source].hint}
                      </span>
                    </span>
                  }
                />
              ))}
            </RadioGroup>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              disabled={chosen === ''}
              loading={choose.isPending}
              onClick={() => chosen && choose.mutate(chosen)}
            >
              Choose
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A picked section goes to its reader; from then the paper is theirs to read until they release it. */
function HandOverDialog({
  testId,
  section,
  onClose,
  onHanded,
}: Readonly<{
  testId: string;
  section: BaseConfigSection | null;
  onClose: () => void;
  onHanded: () => void;
}>) {
  const queryClient = useQueryClient();
  const handOver = useMutation({
    meta: { success: `${section?.name ?? 'Section'} handed to its proof-reader.` },
    mutationFn: (sectionId: string) => api.admin.tests.handOverSection(testId, sectionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TEST_PAPER });
      onHanded();
      onClose();
    },
  });

  return (
    <ConfirmDialog
      open={section !== null}
      onOpenChange={(open) => !open && onClose()}
      title={`Hand ${section?.name ?? 'this section'} to its proof-reader?`}
      description={`Its ${plural(section?.questionCount ?? 0, 'question')} go to the proof-reader to check. You cannot change this section's paper until they release it.`}
      confirmLabel="Hand over"
      loading={handOver.isPending}
      onConfirm={() => section && handOver.mutate(section.id)}
    />
  );
}

/** Assigning is the icon beside the tag now, so the menu is only ever what is already there. */
function SectionActions({
  testId,
  row,
  onRemove,
  onHandOver,
}: Readonly<{
  testId: string;
  row: SectionRow;
  onRemove: ((assignment: Assignment) => void) | null;
  onHandOver: (() => void) | null;
}>) {
  return (
    <RowActions label={`Actions for ${row.section.name}`}>
      <DropdownMenuItem asChild>
        <Link to={ROUTES.SECTION(testId, row.section.id)}>Open section</Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link to={`${ROUTES.TEST_PAPER(testId)}?section=${row.section.id}`}>Open paper</Link>
      </DropdownMenuItem>
      {onHandOver ? (
        <DropdownMenuItem onSelect={onHandOver}>Hand over to proof-reader</DropdownMenuItem>
      ) : null}
      {onRemove ? removeItemsFor(row, onRemove) : null}
    </RowActions>
  );
}

function removeItemsFor(row: SectionRow, onRemove: (assignment: Assignment) => void): ReactNode[] {
  const items: ReactNode[] = [];
  for (const role of ROLE_ORDER) {
    const assignment = role === ASSIGNMENT_ROLES.TYPIST ? row.typist : row.proofreader;
    const word = ASSIGNMENT_ROLE_LABELS[role].toLowerCase();

    // Worked under means on the record: the role passes to somebody else instead.
    if (assignment?.removable) {
      items.push(
        <DropdownMenuItem key={role} destructive onSelect={() => onRemove(assignment)}>
          Remove {word}
        </DropdownMenuItem>,
      );
    }
  }
  return items;
}

function RoleCell({
  assignment,
  earlier,
  questionCount,
  onAssign,
}: Readonly<{
  assignment: Assignment | undefined;
  earlier: readonly Assignment[];
  questionCount: number;
  onAssign?: () => void;
}>) {
  if (!assignment && !onAssign) {
    return <span className="text-sm text-muted-foreground">Unassigned</span>;
  }
  if (!assignment) {
    return (
      <span className="flex items-center gap-1">
        <span className="text-sm text-muted-foreground">Unassigned</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon" variant="ghost" onClick={onAssign}>
              <UserPlus />
              <span className="sr-only">Assign</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Assign</TooltipContent>
        </Tooltip>
      </span>
    );
  }

  const progress = progressOf(assignment, questionCount);
  return (
    <div className="flex flex-col gap-1">
      <span className="flex min-w-0 items-center gap-1">
        <TruncatedText className="font-medium">{assignment.assigneeName}</TruncatedText>
        {onAssign ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="ghost" onClick={onAssign}>
                <UserRoundPen />
                <span className="sr-only">Give to somebody else</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Give to somebody else</TooltipContent>
          </Tooltip>
        ) : null}
      </span>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {assignment.dueAt ? `Due ${instituteDayLabel(assignment.dueAt)}` : 'No due date'}
        </span>
        <Badge variant={progress.variant}>{progress.label}</Badge>
      </div>
      {earlier.length > 0 ? (
        <TruncatedText className="text-xs text-muted-foreground">
          {`Earlier: ${earlier.map((row) => row.assigneeName).join(', ')}`}
        </TruncatedText>
      ) : null}
    </div>
  );
}

/** A reader's state is where the section is with them; a typist's, how much of it is written. */
function progressOf(
  assignment: Assignment,
  questionCount: number,
): { variant: BadgeProps['variant']; label: string } {
  if (assignment.role === ASSIGNMENT_ROLES.PROOFREADER) {
    if (assignment.finalizedAt) return { variant: 'success', label: 'Released' };
    return assignment.handedAt
      ? { variant: 'warning', label: 'Reading' }
      : { variant: 'neutral', label: 'Not reached' };
  }
  if (assignment.finalizedAt) return { variant: 'success', label: 'Done' };
  const { writtenCount } = assignment;
  if (writtenCount === 0) return { variant: 'neutral', label: `0/${questionCount}` };
  return {
    variant: writtenCount < questionCount ? 'warning' : 'success',
    label: `${writtenCount}/${questionCount}`,
  };
}

interface AssignFormValues {
  assigneeId: string;
  dueAt: string;
}

/** Who may hold a role — the server already narrows this to active admins holding its feature key. */
function useAssigneeOptions(role: AssignmentRole) {
  const assignable = useQuery({
    queryKey: [...QUERY_KEYS.ASSIGNMENTS, 'assignable', role],
    queryFn: () => api.admin.assignments.assignable({ role }),
  });

  return {
    isLoading: assignable.isLoading,
    items: (assignable.data ?? []).map((admin) => ({
      value: admin.id,
      label: admin.fullName ?? 'Unnamed admin',
    })),
  };
}

function AssignDialog({
  testId,
  section,
  role,
  onClose,
  onAssigned,
}: Readonly<{
  testId: string;
  section: BaseConfigSection;
  role: AssignmentRole;
  onClose: () => void;
  onAssigned: () => void;
}>) {
  const form = useForm<AssignFormValues>({ defaultValues: { assigneeId: '', dueAt: '' } });
  const dueAt = useWatch({ control: form.control, name: 'dueAt' }) ?? '';
  const assignees = useAssigneeOptions(role);
  const word = ASSIGNMENT_ROLE_LABELS[role].toLowerCase();

  const assign = useMutation({
    meta: { success: `${section.name} assigned to a ${word}.`, fields: ['assigneeId'] },
    mutationFn: (values: AssignFormValues) =>
      api.admin.assignments.assign(testId, {
        baseConfigSectionId: section.id,
        assigneeId: values.assigneeId,
        role,
        dueAt: values.dueAt || null,
      }),
    onSuccess: () => {
      onAssigned();
      onClose();
    },
    onError: (error) => applyFieldErrors(error, form.setError, ['assigneeId']),
  });

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      form={form}
      onSubmit={(values) => assign.mutate(values)}
      title={`Assign a ${word} to ${section.name}`}
      submitLabel="Assign"
      loading={assign.isPending}
    >
      <FormCombobox
        form={form}
        name="assigneeId"
        label="Assignee"
        clearable={false}
        placeholder="Choose an admin"
        emptyLabel={`No admin holds ${word} access`}
        items={assignees.items}
        isLoading={assignees.isLoading}
      />

      {/* ui-copy-ok: rule */}
      <Field htmlFor="dueAt" label="Due date" hint="Optional">
        {(control) => (
          <DatePicker
            {...control}
            value={dueAt}
            onChange={(next) => form.setValue('dueAt', next, { shouldDirty: true })}
          />
        )}
      </Field>
    </FormDialog>
  );
}

function RemoveDialog({
  assignment,
  onClose,
  onRemoved,
}: Readonly<{
  assignment: Assignment | null;
  onClose: () => void;
  onRemoved: () => void;
}>) {
  const remove = useMutation({
    meta: {
      success: assignment
        ? `${assignment.assigneeName} removed from ${assignment.sectionName}.`
        : undefined,
    },
    mutationFn: (id: string) => api.admin.assignments.remove(id),
    onSuccess: () => {
      onRemoved();
      onClose();
    },
  });

  return (
    <ConfirmDialog
      open={assignment !== null}
      onOpenChange={(open) => !open && onClose()}
      destructive
      title={`Remove ${assignment?.assigneeName ?? ''} from ${assignment?.sectionName ?? ''}?`}
      description="The questions they have already written stay in the bank; only the assignment record is removed."
      confirmLabel="Remove"
      loading={remove.isPending}
      onConfirm={() => assignment && remove.mutate(assignment.id)}
    />
  );
}
