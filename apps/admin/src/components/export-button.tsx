import { useMutation } from '@tanstack/react-query';
import { ChevronDown, Download } from 'lucide-react';
import { FEATURE_KEYS, PERMISSION_LEVELS, exportFilename, type ExportKind } from '@iace/contracts';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@iace/ui';
import { saveBlob } from '../lib/save-blob';
import { useAuth } from '../providers/auth';

export interface ExportChoice {
  kind: ExportKind;
  label: string;
  download: () => Promise<Blob>;
}

/** A screen's download as .xlsx; left out for an admin without the export permission. */
export function ExportButton({
  label = 'Export',
  disabled = false,
  ...props
}: Readonly<
  { label?: string; disabled?: boolean } & (
    | { kind: ExportKind; download: () => Promise<Blob> }
    /** More than one file from the same rows: the button opens a menu naming each. */
    | { choices: readonly ExportChoice[] }
  )
>) {
  const { can } = useAuth();
  const exporting = useMutation({
    mutationFn: async (choice: ExportChoice) => ({
      kind: choice.kind,
      blob: await choice.download(),
    }),
    onSuccess: ({ kind, blob }) => saveBlob(blob, exportFilename(kind)),
  });

  if (!can(FEATURE_KEYS.DATA_EXPORT, PERMISSION_LEVELS.READ)) return null;
  const choices = 'choices' in props ? props.choices : [{ ...props, label }];

  const button = (onClick?: () => void) => (
    <Button
      variant="outline"
      size="sm"
      icon={<Download aria-hidden />}
      loading={exporting.isPending}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
      {choices.length > 1 ? <ChevronDown aria-hidden /> : null}
    </Button>
  );

  const [only] = choices;
  if (choices.length === 1 && only) return button(() => exporting.mutate(only));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{button()}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {choices.map((choice) => (
          <DropdownMenuItem key={choice.kind} onSelect={() => exporting.mutate(choice)}>
            {choice.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
