import type { ReactNode } from 'react';
import { TableBody, TableState } from '@iace/ui';

export function PreviewRows({
  rows,
  colSpan,
  children,
}: Readonly<{ rows: readonly unknown[] | undefined; colSpan: number; children: ReactNode }>) {
  return (
    <TableBody>
      <TableState
        isLoading={false}
        isEmpty={!rows?.length}
        colSpan={colSpan}
        empty={
          rows
            ? 'No rows in that file'
            : {
                title: 'Nothing to preview yet',
                hint: 'Choose a file. Nothing is written until you press Import.',
              }
        }
      >
        {children}
      </TableState>
    </TableBody>
  );
}
