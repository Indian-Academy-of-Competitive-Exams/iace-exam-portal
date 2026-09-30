import { useEffect } from 'react';
import { Pencil } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { PageCrumbs } from '@iace/app-kit/browser';
import {
  Button,
  EMPTY_STATE_KINDS,
  EmptyState,
  FormPanel,
  PageHeader,
  Skeleton,
  SkeletonParagraph,
} from '@iace/ui';
import { api } from '../lib/api';
import { NAV_ITEMS, ROUTES, questionQueryKey } from '../lib/constants';
import { QuestionFields } from '../components/question-fields';
import { emptyValues, valuesOf, type QuestionFormValues } from '../components/question-draft';

/** One bank question, read. Writing and correcting happen on the authoring page. */
export function QuestionFormPage() {
  const { id = '' } = useParams();

  const question = useQuery({
    queryKey: questionQueryKey(id),
    queryFn: () => api.admin.questions.detail(id),
  });

  const form = useForm<QuestionFormValues>({ defaultValues: emptyValues() });

  // The saved question arrives after first render; reset rather than key the form off it.
  const loaded = question.data;
  useEffect(() => {
    if (loaded) form.reset(valuesOf(loaded));
  }, [loaded, form]);

  if (question.isLoading) {
    // The form has a known shape, so it is drawn and held rather than spun at.
    return (
      <div className="flex flex-col gap-4">
        <Skeleton variant="title" />
        <SkeletonParagraph lines={6} />
      </div>
    );
  }

  if (question.error || !loaded) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Could not load this question"
        onRetry={question.refetch}
      />
    );
  }

  return (
    <FormPanel
      disabled
      header={
        <PageHeader
          breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
          title="Question"
          action={
            <Button asChild variant="outline" size="sm">
              <Link to={ROUTES.QUESTION_EDIT(id)}>
                <Pencil aria-hidden />
                Edit question
              </Link>
            </Button>
          }
        />
      }
    >
      <QuestionFields form={form} saved={loaded} />
    </FormPanel>
  );
}
