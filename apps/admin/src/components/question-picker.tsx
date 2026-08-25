import { useMemo, useState } from 'react';
import { DIFFICULTY_LEVELS, QUESTION_STATUS, type QuestionSummary } from '@iace/contracts';
import { useListScreen, useLocalFilters } from '@iace/app-kit/browser';
import {
  Badge,
  BadgeList,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ListView,
  TruncatedText,
  plural,
  type DataTableColumn,
  type ListFilterMultiControl,
} from '@iace/ui';
import { api } from '../lib/api';
import { TopicMultiPicker } from './taxonomy-picker';

/** Choosing questions for one section: the bank, filtered the way its own screen filters it. */

const DIFFICULTY_VARIANT: Readonly<
  Record<QuestionSummary['difficulty'], 'success' | 'warning' | 'danger'>
> = {
  LOW: 'success',
  MEDIUM: 'warning',
  HIGH: 'danger',
};

function questionColumns(): DataTableColumn<QuestionSummary>[] {
  return [
    {
      key: 'code',
      header: 'Code',
      className: 'max-w-[8rem] font-mono text-sm',
      cell: (question) => <TruncatedText>{question.questionCode}</TruncatedText>,
    },
    {
      key: 'stem',
      header: 'Question',
      className: 'max-w-[26rem] font-medium',
      cell: (question) => <TruncatedText>{question.stemPreview}</TruncatedText>,
    },
    {
      key: 'topic',
      header: 'Topic',
      className: 'max-w-[12rem] text-muted-foreground',
      cell: (question) => <TruncatedText>{question.topic?.name ?? null}</TruncatedText>,
    },
    {
      key: 'difficulty',
      header: 'Difficulty',
      cell: (question) => (
        <Badge variant={DIFFICULTY_VARIANT[question.difficulty]}>{question.difficulty}</Badge>
      ),
    },
    {
      key: 'tags',
      header: 'Tags',
      className: 'max-w-[12rem]',
      cell: (question) => <BadgeList items={question.tags} label={(tag) => tag} />,
    },
  ];
}

export interface QuestionPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** The section's own subject: the draw uses it, so the picker must not offer past it. */
  subjectId: string | null;
  chosen: readonly string[];
  onChosen: (next: string[]) => void;
  /** How many the section holds, so the footer can say what is still owed. */
  needed?: number;
  /** One question replaces one row, so the dialog closes on the first pick. */
  single?: boolean;
}

export function QuestionPicker({
  open,
  onOpenChange,
  title,
  subjectId,
  chosen,
  onChosen,
  needed,
  single,
}: Readonly<QuestionPickerProps>) {
  const store = useLocalFilters();
  const columns = useMemo(() => questionColumns(), []);

  const filterSpec = [
    {
      key: 'q',
      kind: 'search',
      label: 'Search questions',
      placeholder: 'Search the question text or a code',
      primary: true,
    },
    {
      key: 'topicId',
      kind: 'customMulti',
      label: 'Topic',
      primary: true,
      render: (control: ListFilterMultiControl) => (
        <TopicMultiPicker {...control} subjectIds={subjectId ? [subjectId] : []} />
      ),
    },
    {
      key: 'difficulty',
      kind: 'multi',
      label: 'Difficulty',
      placeholder: 'Any difficulty',
      items: DIFFICULTY_LEVELS.map((level) => ({ value: level, label: level })),
    },
  ] as const;

  const questions = useListScreen({
    queryKey: ['admin', 'questions', 'picker', subjectId ?? ''],
    filters: filterSpec,
    store,
    toQuery: (values) => ({
      q: values.q || undefined,
      topicId: values.topicId,
      difficulty: values.difficulty as QuestionSummary['difficulty'][],
      status: [QUESTION_STATUS.ACTIVE],
      subjectId: subjectId ? [subjectId] : undefined,
    }),
    fetchPage: (params) => api.admin.questions.list(params),
    enabled: open,
  });

  const pick = (next: ReadonlySet<string>) => {
    if (!single) {
      onChosen([...next]);
      return;
    }
    const added = [...next].find((id) => !chosen.includes(id));
    if (added) {
      onChosen([added]);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <DialogBody>
          <ListView
            list={questions}
            filters={filterSpec}
            columns={columns}
            rowKey={(question) => question.id}
            selection={{
              selected: new Set(chosen),
              onChange: pick,
              label: 'Choose this question',
            }}
            empty="The bank holds no live question for this section yet."
            emptyFiltered="No question matches those filters."
          />
        </DialogBody>

        <DialogFooter>
          <span className="mr-auto text-sm text-muted-foreground">
            {needed === undefined
              ? `${chosen.length} chosen`
              : `${chosen.length} of ${plural(needed, 'question')} chosen — the draw fills the rest`}
          </span>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A button that says how many are chosen and opens the picker for one section. */
export function QuestionPickerButton({
  label,
  subjectId,
  chosen,
  onChosen,
  needed,
  disabled,
}: Readonly<{
  label: string;
  subjectId: string | null;
  chosen: readonly string[];
  onChosen: (next: string[]) => void;
  needed: number;
  disabled?: boolean;
}>) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="outline" disabled={disabled} onClick={() => setOpen(true)}>
        {chosen.length === 0 ? 'Choose by hand' : `${chosen.length} chosen by hand`}
      </Button>

      {open ? (
        <QuestionPicker
          open={open}
          onOpenChange={setOpen}
          title={label}
          subjectId={subjectId}
          chosen={chosen}
          onChosen={onChosen}
          needed={needed}
        />
      ) : null}
    </>
  );
}
