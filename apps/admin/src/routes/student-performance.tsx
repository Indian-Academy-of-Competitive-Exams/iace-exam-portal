import { Navigate, useParams } from 'react-router-dom';
import { ROUTES } from '../lib/constants';
import { STUDENT_TABS } from './student-detail-tabs';

/** Performance is a tab on the student now. This keeps a link somebody already sent working. */
export function StudentPerformancePage() {
  const { id = '' } = useParams();

  return <Navigate replace to={`${ROUTES.STUDENT(id)}?tab=${STUDENT_TABS.PERFORMANCE}`} />;
}
