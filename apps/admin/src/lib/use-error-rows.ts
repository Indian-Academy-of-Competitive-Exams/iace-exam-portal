import { useMutation } from '@tanstack/react-query';
import { EXPORT_KINDS, exportFilename } from '@iace/contracts';
import { type ImportViewProps } from '@iace/ui';
import { saveBlob } from './save-blob';

/** The previewed file posted back for the lines it would skip; nothing while none would be. */
export function useErrorRows(
  file: File | null,
  invalid: number,
  download: (file: File) => Promise<Blob>,
): ImportViewProps['errorRows'] {
  const errorRows = useMutation({
    mutationFn: download,
    onSuccess: (blob) => saveBlob(blob, exportFilename(EXPORT_KINDS.IMPORT_ERRORS)),
  });

  if (file === null || invalid === 0) return undefined;
  return { loading: errorRows.isPending, onDownload: () => errorRows.mutate(file) };
}
