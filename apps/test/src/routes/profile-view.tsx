import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, Pencil } from 'lucide-react';
import { type Me } from '@iace/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  FormPanel,
  FormSection,
  PageHeader,
  SkeletonParagraph,
} from '@iace/ui';
import { DocumentCard } from '../components/document-card';
import { PreTestPrompt } from '../components/pre-test-prompt';
import { api } from '../lib/api';
import { PROFILE_QUERY_KEY, ROUTES } from '../lib/constants';

/** The profile as it stands, with editing behind a button — a form is for changing, not checking. */
export function ProfileViewPage() {
  const me = useQuery({ queryKey: PROFILE_QUERY_KEY, queryFn: () => api.me.profile() });

  if (me.isPending) {
    return (
      <Card className="p-6">
        <SkeletonParagraph lines={5} />
      </Card>
    );
  }

  if (me.error || !me.data) {
    // The reason is on the toast; this only has to stop the page being blank.
    return <Alert variant="danger">Could not load your profile.</Alert>;
  }

  const profile = me.data.profile;

  return (
    <FormPanel
      header={
        <PageHeader
          title="Your profile"
          description="What we hold about you, and what is still missing."
          action={
            <Button variant="outline" size="sm" asChild>
              <Link to={ROUTES.PROFILE_EDIT}>
                <Pencil aria-hidden />
                Edit details
              </Link>
            </Button>
          }
        />
      }
    >
      <PreTestPrompt preTestReady={me.data.preTestReady} />

      <Completion me={me.data} />

      <FormSection title="Details">
        <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <Detail label="Name" value={me.data.fullName} />
          <Detail label="Mobile" value={`+91 ${me.data.mobile}`} />
          <Detail label="Mother's name" value={profile?.motherName} />
          <Detail label="Father's name" value={profile?.fatherName} />
          <Detail label="Date of birth" value={profile?.dob} />
          <Detail label="Gender" value={titleCase(profile?.gender)} />
          <Detail label="Email" value={profile?.email} />
          <Detail label="Address" value={profile?.address} />
        </div>
      </FormSection>

      <FormSection
        title="Your photo"
        description="Only you and the institute can see it, and a new one replaces the last. Aadhaar and PAN are checked at the centre — their images are never uploaded or stored here."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <DocumentCard kind="photo" label="Passport photo" url={profile?.photoUrl ?? null} />
        </div>
      </FormSection>

      <HistoryList
        title="Education"
        empty="No qualifications added yet."
        rows={(profile?.educationDetails ?? []).map((entry) => ({
          key: `${entry.level}-${entry.year ?? ''}`,
          main: entry.level,
          detail: [entry.board, entry.institution].filter(Boolean).join(' · '),
          trailing: [entry.year, entry.percentage ? `${entry.percentage}%` : null]
            .filter(Boolean)
            .join(' · '),
        }))}
      />

      <HistoryList
        title="Exams sat elsewhere"
        empty="No previous exams added yet."
        rows={(profile?.pastExamHistory ?? []).map((entry) => ({
          key: `${entry.exam}-${entry.year ?? ''}`,
          main: entry.exam,
          detail: entry.result ?? '',
          trailing: entry.year ? String(entry.year) : '',
        }))}
      />
    </FormPanel>
  );
}

/** What is left to do, as a list rather than a percentage. Each line links to where it is filled in. */
function Completion({ me }: Readonly<{ me: Me }>) {
  const profile = me.profile;
  const items = [
    { label: "Mother's name", done: Boolean(profile?.motherName), preTest: true },
    { label: "Father's name", done: Boolean(profile?.fatherName), preTest: true },
    { label: 'Date of birth', done: Boolean(profile?.dob), preTest: true },
    { label: 'Gender', done: Boolean(profile?.gender), preTest: false },
    { label: 'Passport photo', done: Boolean(profile?.photoUrl), preTest: false },
  ];
  const outstanding = items.filter((item) => !item.done);

  if (outstanding.length === 0) {
    return (
      <Alert variant="success">
        <span className="flex items-center gap-2">
          <Check className="size-4" aria-hidden />
          Your profile is complete. Nothing else needed.
        </span>
      </Alert>
    );
  }

  return (
    <FormSection
      title="Still to add"
      // The three pre-test fields are the only ones that hold anything up.
      description="Only the ones marked 'needed before a test' hold anything up. The rest are optional."
    >
      <div className="flex flex-col gap-2">
        {outstanding.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-foreground">{item.label}</span>
            {item.preTest ? (
              <Badge variant="warning">Needed before a test</Badge>
            ) : (
              <Badge variant="neutral">Optional</Badge>
            )}
          </div>
        ))}
      </div>
    </FormSection>
  );
}

/** Education and past exams read the same way, so they render the same way. */
function HistoryList({
  title,
  empty,
  rows,
}: Readonly<{
  title: string;
  empty: string;
  rows: readonly { key: string; main: string; detail: string; trailing: string }[];
}>) {
  return (
    <FormSection title={title}>
      <div className="flex flex-col gap-3">
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : null}
        {rows.map((row) => (
          <div key={row.key} className="flex items-baseline justify-between gap-4 text-sm">
            <span className="min-w-0">
              <span className="block font-medium text-foreground">{row.main}</span>
              {row.detail ? (
                <span className="block text-xs text-muted-foreground">{row.detail}</span>
              ) : null}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{row.trailing}</span>
          </div>
        ))}
      </div>
    </FormSection>
  );
}

function Detail({ label, value }: Readonly<{ label: string; value: string | null | undefined }>) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">
        {value || <span className="text-muted-foreground">Not added yet</span>}
      </span>
    </div>
  );
}

/** MALE -> Male. The enum is shouted; a profile page should not be. */
function titleCase(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.charAt(0) + value.slice(1).toLowerCase();
}
