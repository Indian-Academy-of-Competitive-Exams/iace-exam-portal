import { useState } from 'react';
import { Route } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  cn,
} from '@iace/ui';
import { EXAM_MODE_LABELS, type ExamBrief } from '@iace/contracts';

/** The exam's stages in order, with the one this paper prepares for marked. */
export function ExamJourney({ journey }: Readonly<{ journey: NonNullable<ExamBrief['journey']> }>) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Route aria-hidden />
        Exam journey
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Exam journey</DialogTitle>
            <DialogDescription>{journey.exam}</DialogDescription>
          </DialogHeader>

          <DialogBody className="py-5">
            <ol className="flex flex-col gap-3">
              {journey.stages.map((stage, index) => {
                const current = stage.id === journey.stageId;
                return (
                  <li
                    key={stage.id}
                    aria-current={current ? 'step' : undefined}
                    className="flex items-center gap-3"
                  >
                    <span
                      className={cn(
                        'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                        current
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border text-muted-foreground',
                      )}
                    >
                      {index + 1}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium text-foreground">
                        {stage.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {EXAM_MODE_LABELS[stage.mode]}
                      </span>
                    </span>
                    {current ? <Badge variant="primary">This test</Badge> : null}
                  </li>
                );
              })}
            </ol>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
