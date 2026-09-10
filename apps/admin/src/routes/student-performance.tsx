import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  EmptyState,
  EMPTY_STATE_KINDS,
  PageFrame,
  PageHeader,
  Skeleton,
  SkeletonParagraph,
} from '@iace/ui';
import { PageCrumbs } from '@iace/app-kit/browser';
import { StudentPerformancePanel } from '../components/student-performance';
import { api } from '../lib/api';
import { NAV_ITEMS, QUERY_KEYS, ROUTES } from '../lib/constants';

/** A student's analytics, off the detail page so neither has to be scrolled past to reach the other. */
export function StudentPerformancePage() {
  const { id = '' } = useParams();

  const student = useQuery({
    queryKey: [...QUERY_KEYS.STUDENT, id],
    queryFn: () => api.admin.students.detail(id),
  });

  // Framed while it loads, or the scrollport appears only once the name lands.
  if (student.isPending) {
    return (
      <PageFrame>
        <div className="flex flex-col gap-5">
          <Skeleton variant="title" />
          <SkeletonParagraph lines={5} />
        </div>
      </PageFrame>
    );
  }
  if (student.error || !student.data) {
    return (
      <PageFrame>
        <EmptyState
          kind={EMPTY_STATE_KINDS.FAILURE}
          title="Could not load this student"
          onRetry={student.refetch}
        />
      </PageFrame>
    );
  }

  const detail = student.data;
  const name = detail.fullName ?? detail.mobile;

  return (
    <PageFrame
      header={
        <PageHeader
          breadcrumbs={
            <PageCrumbs
              nav={NAV_ITEMS}
              tail={[{ label: name, to: ROUTES.STUDENT(detail.id) }, { label: 'Performance' }]}
            />
          }
          title={name}
          meta={`+91 ${detail.mobile}`}
        />
      }
    >
      <StudentPerformancePanel studentId={detail.id} />
    </PageFrame>
  );
}
