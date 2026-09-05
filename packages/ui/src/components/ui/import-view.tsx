import * as React from 'react';
import { Download, Upload } from 'lucide-react';
import { Alert } from './alert';
import { Button } from './button';
import { Card } from './card';
import { FileDropzone, type FileDropzoneProps } from './file-dropzone';
import { FormSection } from './form-panel';
import { LoadingState } from './spinner';
import { PageFrame } from './table-frame';
import { StatRow } from './stat-row';

/** One counted line of the preview — what the file would do, before it does it. */
export interface ImportStat {
  label: string;
  value: React.ReactNode;
}

export interface ImportViewProps {
  /** Pinned above the two panes — usually a `PageHeader`. */
  header?: React.ReactNode;
  onDownloadTemplate: () => void;
  downloadingTemplate?: boolean;
  /** Another way to stage a plan, as its own section above the file picker. */
  otherSource?: React.ReactNode;
  dropzone: FileDropzoneProps;
  /** Between the file and Import: anything that changes what committing would do. */
  options?: React.ReactNode;
  previewing?: boolean;
  action: {
    label: string;
    loading?: boolean;
    disabled?: boolean;
    onClick: () => void;
  };
  /** Why the file could not be read at all — never a row-level problem. */
  fileErrors?: readonly string[];
  /** What the commit reported, once it has run. */
  outcome?: React.ReactNode;
  stats?: readonly ImportStat[];
  /** The preview table. */
  children: React.ReactNode;
}

/** Preview beside the controls that change it: two panes, each scrolling on its own. */
export function ImportView({
  header,
  onDownloadTemplate,
  downloadingTemplate,
  otherSource,
  dropzone,
  options,
  previewing,
  action,
  fileErrors,
  outcome,
  stats,
  children,
}: Readonly<ImportViewProps>) {
  return (
    <PageFrame className="lg:overflow-hidden" header={header}>
      <div className="grid gap-5 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="relative order-2 p-4 lg:order-1 lg:min-h-0 lg:overflow-y-auto">
          {fileErrors?.length ? (
            <Alert variant="danger" className="mb-4">
              <span>{fileErrors.join(' ')}</span>
            </Alert>
          ) : null}

          {outcome ? (
            <Alert variant="success" className="mb-4">
              <span>{outcome}</span>
            </Alert>
          ) : null}

          {children}
        </Card>

        <Card className="relative order-1 flex flex-col gap-6 p-4 lg:order-2 lg:min-h-0 lg:overflow-y-auto">
          {/* The template comes first: the shape of the file matters before anywhere to put one. */}
          <FormSection title="Start from the template">
            <Button
              variant="outline"
              icon={<Download aria-hidden />}
              loading={downloadingTemplate}
              onClick={onDownloadTemplate}
            >
              Download template
            </Button>
          </FormSection>

          {otherSource}

          <FormSection title="Your file">
            <div className="flex flex-col gap-3">
              <FileDropzone {...dropzone} />

              {previewing ? <LoadingState>Reading the file…</LoadingState> : null}

              {options}

              <Button
                icon={<Upload aria-hidden />}
                loading={action.loading}
                disabled={action.disabled}
                onClick={action.onClick}
              >
                {action.label}
              </Button>
            </div>
          </FormSection>

          {stats?.length ? (
            <FormSection title="Preview">
              <div className="flex flex-col gap-2 text-sm">
                {stats.map((stat) => (
                  <StatRow key={stat.label} label={stat.label} value={stat.value} />
                ))}
              </div>
            </FormSection>
          ) : null}
        </Card>
      </div>
    </PageFrame>
  );
}
