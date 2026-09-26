import { useMutation } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { FEATURE_KEYS, PERMISSION_LEVELS, exportFilename, type ExportKind } from '@iace/contracts';
import { Button } from '@iace/ui';
import { saveBlob } from '../lib/save-blob';
import { useAuth } from '../providers/auth';

/** A screen's download as .xlsx; left out for an admin without the export permission. */
export function ExportButton({
  kind,
  download,
  label = 'Export',
  disabled = false,
}: Readonly<{
  kind: ExportKind;
  download: () => Promise<Blob>;
  label?: string;
  disabled?: boolean;
}>) {
  const { can } = useAuth();
  const exporting = useMutation({
    mutationFn: download,
    onSuccess: (blob) => saveBlob(blob, exportFilename(kind)),
  });

  if (!can(FEATURE_KEYS.DATA_EXPORT, PERMISSION_LEVELS.READ)) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      icon={<Download aria-hidden />}
      loading={exporting.isPending}
      disabled={disabled}
      onClick={() => exporting.mutate()}
    >
      {label}
    </Button>
  );
}
