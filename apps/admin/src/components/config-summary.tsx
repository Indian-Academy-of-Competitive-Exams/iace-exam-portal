import { useState } from 'react';
import { Layers } from 'lucide-react';
import { type BaseConfigDetail } from '@iace/contracts';
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  StatRow,
  type DataTableColumn,
} from '@iace/ui';
import {
  LANGUAGE_CODE_LABELS,
  MERIT_TYPE_LABELS,
  NAVIGATION_POLICY_LABELS,
  TIMER_TEMPLATE_LABELS,
} from '../lib/constants';
import { durationLabel } from '../lib/duration';

/** The shape a test reads off its blueprint — never the test's to change, so never in its way. */

type Section = BaseConfigDetail['sections'][number];

function sectionColumns(): DataTableColumn<Section>[] {
  return [
    { key: 'name', header: 'Section', className: 'font-medium', cell: (section) => section.name },
    {
      key: 'questions',
      header: 'Questions',
      numeric: true,
      cell: (section) => section.questionCount,
    },
    {
      key: 'marks',
      header: 'Marks each',
      numeric: true,
      cell: (section) => section.marksPerQuestion,
    },
    {
      key: 'negative',
      header: 'Negative',
      numeric: true,
      cell: (section) => section.negativeMarks,
    },
    {
      key: 'duration',
      header: 'Duration',
      numeric: true,
      cell: (section) => (section.durationSec ? durationLabel(section.durationSec) : '—'),
    },
    {
      key: 'merit',
      header: 'Counts as',
      cell: (section) => (
        <Badge variant="neutral">{MERIT_TYPE_LABELS[section.meritOrQualifying]}</Badge>
      ),
    },
  ];
}

export function ConfigSummaryButton({ config }: Readonly<{ config: BaseConfigDetail }>) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Layers aria-hidden />
        {config.name}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{config.name}</DialogTitle>
          </DialogHeader>

          <DialogBody className="flex flex-col gap-6">
            <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
              <StatRow label="Sections" value={config.sections.length} />
              <StatRow label="Questions" value={config.totalQuestions} />
              <StatRow label="Marks" value={config.totalMarks} />
              <StatRow label="Duration" value={durationLabel(config.durationSec)} />
              <StatRow label="Timing pattern" value={TIMER_TEMPLATE_LABELS[config.timerTemplate]} />
              <StatRow label="Navigation" value={NAVIGATION_POLICY_LABELS[config.navigation]} />
              <StatRow
                label="Languages"
                value={config.languages.map((code) => LANGUAGE_CODE_LABELS[code]).join(', ') || '—'}
              />
            </div>

            <DataTable
              columns={sectionColumns()}
              rows={config.sections}
              rowKey={(section) => section.id}
              isLoading={false}
              empty="This configuration has no sections."
            />
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
