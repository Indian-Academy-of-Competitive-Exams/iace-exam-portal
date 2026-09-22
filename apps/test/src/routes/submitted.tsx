/**
 * The moment after a paper is handed in. Marking is a queued job, so this shows what the
 * sitting knows about ITSELF and hands the student the way to their result when they want it.
 */
import { Link, useLocation, useParams } from 'react-router-dom';
import { Alert, Button, PageFrame, PageHeader, plural } from '@iace/ui';
import { type EndedSitting } from '@iace/app-kit';
import { PageCrumbs } from '@iace/app-kit/browser';
import { DividedList, DividedRow, PageBody, Section } from '../components/ui';
import { NAV_ITEMS, ROUTES } from '../lib/constants';

export function SubmittedPage() {
  const { attemptId = '' } = useParams();
  const handedIn = useLocation().state as EndedSitting | null;

  return (
    <PageFrame
      header={
        <PageHeader breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />} size="display" title="Handed in" />
      }
    >
      <PageBody>
        {handedIn ? <OwnEffort sitting={handedIn} /> : null}

        <Alert variant="info">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>Your paper is safe. Marking is queued, so your result may take a moment.</span>
            <Button size="sm" asChild>
              <Link to={ROUTES.REPORT(attemptId)}>See your result</Link>
            </Button>
          </div>
        </Alert>
      </PageBody>
    </PageFrame>
  );
}

/** Their own paper, not the cohort's: nothing here needs the marking to have run. */
function OwnEffort({ sitting }: Readonly<{ sitting: EndedSitting }>) {
  return (
    <Section title="Your paper">
      <DividedList>
        {sitting.sections.map((section) => (
          <DividedRow
            key={section.id}
            title={section.name}
            meta={`${plural(section.total, 'question')} · ${section.attempted} attempted · ${section.unattempted} unattempted`}
          />
        ))}
      </DividedList>
    </Section>
  );
}
