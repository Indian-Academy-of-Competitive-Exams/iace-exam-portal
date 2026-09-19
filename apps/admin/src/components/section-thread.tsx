import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { INSTITUTE_TIME_ZONE, type SectionComment } from '@iace/contracts';
import {
  Button,
  EmptyState,
  EMPTY_STATE_KINDS,
  plural,
  SectionHeading,
  SkeletonParagraph,
  Textarea,
} from '@iace/ui';
import { api } from '../lib/api';
import { ADMIN_ROLE_LABELS, QUERY_KEYS } from '../lib/constants';

/** The discussion on one (test, section) — spec §9, and what replaced the per-question flag. */

const SAID_AT = new Intl.DateTimeFormat('en-IN', {
  timeZone: INSTITUTE_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

const sectionThreadKey = (testId: string, sectionId: string) =>
  [...QUERY_KEYS.SECTION_THREAD, testId, sectionId] as const;

export function SectionThread({
  testId,
  sectionId,
  canWrite,
}: Readonly<{ testId: string; sectionId: string; canWrite: boolean }>) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');

  const thread = useQuery({
    queryKey: sectionThreadKey(testId, sectionId),
    queryFn: () => api.admin.assignments.comments(testId, sectionId),
  });

  const add = useMutation({
    meta: { success: 'Comment added.' },
    mutationFn: () => api.admin.assignments.comment(testId, sectionId, { body }),
    onSuccess: () => {
      setBody('');
      void queryClient.invalidateQueries({ queryKey: sectionThreadKey(testId, sectionId) });
    },
  });

  const rows = thread.data ?? [];

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading
        title="Comments"
        meta={thread.data ? plural(rows.length, 'comment') : undefined}
      />

      {thread.isLoading ? <SkeletonParagraph lines={4} /> : null}

      {thread.isError ? (
        <EmptyState
          kind={EMPTY_STATE_KINDS.FAILURE}
          size="sm"
          level={3}
          title="Could not load the comments"
          onRetry={thread.refetch}
        />
      ) : null}

      {thread.data && rows.length === 0 ? (
        <EmptyState kind={EMPTY_STATE_KINDS.EMPTY} size="sm" level={3} title="No comments yet" />
      ) : null}

      {rows.length > 0 ? (
        <ol className="flex flex-col gap-3">
          {rows.map((comment) => (
            <Comment key={comment.id} comment={comment} />
          ))}
        </ol>
      ) : null}

      {/* Not a <form>: this sits inside the test builder's own form, and a nested one submits that. */}
      {canWrite ? (
        <div className="flex flex-col items-end gap-2">
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Add a comment"
            aria-label="Add a comment"
            rows={3}
          />
          <Button
            size="sm"
            type="button"
            loading={add.isPending}
            disabled={body.trim() === ''}
            onClick={() => add.mutate()}
          >
            Add comment
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function Comment({ comment }: Readonly<{ comment: SectionComment }>) {
  return (
    <li className="flex flex-col gap-1 border-b border-border pb-3 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-medium text-foreground">{comment.authorName}</span>
        <span className="text-muted-foreground">{ADMIN_ROLE_LABELS[comment.authorRole]}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {SAID_AT.format(new Date(comment.createdAt))}
        </span>
      </div>
      <p className="whitespace-pre-wrap text-sm text-foreground">{comment.body}</p>
    </li>
  );
}
