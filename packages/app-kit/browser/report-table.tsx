import { useMemo } from 'react';
import { holdsFigures, type ReportCell, type ReportTable } from '@iace/contracts';
import { Alert, DataTable, TruncatedText, type DataTableColumn } from '@iace/ui';

/** A screen previews a report; the printer and the spreadsheet carry it whole. */
const PREVIEW_ROWS = 200;

interface PreviewRow {
  id: string;
  cells: readonly ReportCell[];
}

const count = (rows: number): string => rows.toLocaleString('en-IN');

function cellOf(value: ReportCell) {
  return typeof value === 'number' ? value : <TruncatedText>{value}</TruncatedText>;
}

/** The first column of words, not figures: a rank counts a row, the student beside it names it. */
function namingColumn(table: ReportTable): number {
  const named = table.columns.findIndex((_, at) => !holdsFigures(table, at));
  return Math.max(named, 0);
}

/** One table of a report as a screen shows it; `carriesAll` names what holds the rows a preview leaves out. */
export function ReportTableView({
  table,
  carriesAll,
}: Readonly<{ table: ReportTable; carriesAll: string }>) {
  const rows = useMemo(
    () => table.rows.slice(0, PREVIEW_ROWS).map((cells, at) => ({ id: String(at), cells })),
    [table.rows],
  );
  const columns = useMemo(() => {
    const pinned = namingColumn(table);
    return table.columns.map((header, at): DataTableColumn<PreviewRow> => ({
      key: String(at),
      header: <span className="whitespace-nowrap">{header}</span>,
      numeric: holdsFigures(table, at),
      pinned: at === pinned,
      className: 'max-w-[18rem]',
      cell: (row) => cellOf(row.cells[at] ?? null),
    }));
  }, [table]);

  return (
    <>
      {table.total > rows.length ? (
        <div className="shrink-0 pt-3">
          <Alert variant="info">
            {`The first ${count(rows.length)} of ${count(table.total)} rows. ${carriesAll}`}
          </Alert>
        </div>
      ) : null}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        isLoading={false}
        empty="No rows"
      />
    </>
  );
}
