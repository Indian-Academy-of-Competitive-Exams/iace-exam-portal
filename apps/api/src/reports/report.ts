/**
 * What every report is: the facts it covers, its headline figures and its sheets. A sheet is an
 * export sheet, so the document a screen prints and the workbook a download holds are written off
 * one column list and cannot disagree.
 */
import {
  REPORTS,
  REPORT_MAX_ROWS,
  type ReportCell,
  type ReportDocument,
  type ReportFact,
  type ReportKey,
  type ReportQuery,
  type ReportQueryOf,
  type ReportTable,
} from '@iace/contracts';
import { type AccessResolverService } from '../access';
import { type TestAnalyticsService } from '../attempts';
import {
  EXPORT_DATE_FORMATS,
  exportInstant,
  type ExportColumn,
  type ExportDateFormat,
  type ExportSheet,
} from '../common/exporting';
import { type PrismaService } from '../prisma/prisma.service';

export interface Report {
  about: ReportFact[];
  figures: ReportFact[];
  sheets: ExportSheet[];
}

/** What a builder reads through: the database, and each owner's own account of a figure it defines. */
export interface ReportSources {
  prisma: PrismaService;
  analytics: TestAnalyticsService;
  access: AccessResolverService;
}

/** A builder names the query it reads; the registry holds it to what its catalogue row requires. */
export type ReportBuilder<Query extends ReportQuery = ReportQuery> = (
  sources: ReportSources,
  query: Query,
) => Promise<Report>;

export type ReportBuilders = { [K in ReportKey]: ReportBuilder<ReportQueryOf<K>> };

/** A date cell's UTC fields ARE its wall clock (`exportInstant`, a `@db.Date`), so UTC is the zone it is read in. */
const DATE_LABELS: Record<ExportDateFormat, Intl.DateTimeFormat> = {
  [EXPORT_DATE_FORMATS.DAY]: new Intl.DateTimeFormat('en-IN', {
    timeZone: 'UTC',
    dateStyle: 'medium',
  }),
  [EXPORT_DATE_FORMATS.INSTANT]: new Intl.DateTimeFormat('en-IN', {
    timeZone: 'UTC',
    dateStyle: 'medium',
    timeStyle: 'short',
  }),
};

function cellOf<Row>(column: ExportColumn<Row>, row: Row): ReportCell {
  const value = column.value(row);
  if (!(value instanceof Date)) return value;
  return DATE_LABELS[column.date ?? EXPORT_DATE_FORMATS.DAY].format(value);
}

function tableOf(sheet: ExportSheet): ReportTable {
  const columns = sheet.columns.filter((column) => !column.fileOnly);
  return {
    title: sheet.name,
    columns: columns.map((column) => column.header),
    rows: sheet.rows
      .slice(0, REPORT_MAX_ROWS)
      .map((row) => columns.map((column) => cellOf(column, row))),
    total: sheet.rows.length,
  };
}

export function toDocument(key: ReportKey, report: Report, asOf = new Date()): ReportDocument {
  return {
    key,
    title: REPORTS[key].title,
    asOf: asOf.toISOString(),
    about: report.about,
    figures: report.figures,
    tables: report.sheets.map(tableOf),
  };
}

const FACT_COLUMNS: ExportColumn<{ label: string; value: ReportCell | Date }>[] = [
  { header: 'Figure', width: 28, value: (row) => row.label },
  { header: 'Value', width: 36, value: (row) => row.value },
];

/** The file's own cover: a spreadsheet handed on has to say what it is and when it was true. */
export function aboutSheet(key: ReportKey, report: Report, asOf = new Date()): ExportSheet {
  return {
    name: 'About',
    columns: FACT_COLUMNS,
    rows: [
      { label: 'Report', value: REPORTS[key].title },
      ...report.about,
      ...report.figures,
      {
        label: 'As of',
        value: DATE_LABELS[EXPORT_DATE_FORMATS.INSTANT].format(exportInstant(asOf) ?? asOf),
      },
    ],
  };
}

/** How many rows a report holds across its sheets: what an export's audit row records. */
export const rowsIn = (report: Report): number =>
  report.sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);
