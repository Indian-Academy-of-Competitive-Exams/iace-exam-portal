/**
 * The one page a superior reads: the period's tests, its branches and its toppers, under the
 * institute's headline counts. Built out of the reports it summarises, so a figure on it is the
 * figure on theirs.
 */
import { REPORT_KEYS, type ReportQueryOf } from '@iace/contracts';
import { COHORT_REPORTS } from './cohort-reports';
import { PERIOD_REPORTS } from './period-reports';
import { periodOf } from './period';
import { type ReportBuilder } from './report';
import { percentOf } from './report-figures';
import { ENROLLED } from './report-people';

type PeriodBuilder = ReportBuilder<ReportQueryOf<typeof REPORT_KEYS.DIGEST_WEEKLY>>;

const digest: PeriodBuilder = async (sources, query, viewer) => {
  const { prisma } = sources;
  const { within } = periodOf(query);
  const [activity, branches, toppers, enrolled, joined, questions, sections, sent] =
    await Promise.all([
      PERIOD_REPORTS[REPORT_KEYS.TEST_ACTIVITY_WEEKLY](sources, query, viewer),
      COHORT_REPORTS[REPORT_KEYS.PERFORMANCE_BY_BRANCH](sources, query, viewer),
      COHORT_REPORTS[REPORT_KEYS.TOP_PERFORMERS](sources, query, viewer),
      prisma.student.count({ where: ENROLLED }),
      prisma.student.count({ where: { deletedAt: null, createdAt: within } }),
      prisma.question.count({ where: { createdAt: within } }),
      prisma.questionAssignment.count({ where: { finalizedAt: within } }),
      prisma.announcement.count({ where: { createdAt: within } }),
    ]);
  const sat = activity.figures.find((figure) => figure.label === 'Students who sat')?.value;
  return {
    about: activity.about,
    figures: [
      ...activity.figures,
      { label: 'Students enrolled', value: enrolled },
      {
        label: 'Participation (%)',
        value: typeof sat === 'number' ? percentOf(sat, enrolled) : null,
      },
      { label: 'New students', value: joined },
      { label: 'Questions added', value: questions },
      { label: 'Sections finished', value: sections },
      { label: 'Announcements sent', value: sent },
    ],
    sheets: [...activity.sheets, ...branches.sheets, ...toppers.sheets],
  };
};

export const DIGEST_REPORTS = {
  [REPORT_KEYS.DIGEST_WEEKLY]: digest,
  [REPORT_KEYS.DIGEST_MONTHLY]: digest,
};
