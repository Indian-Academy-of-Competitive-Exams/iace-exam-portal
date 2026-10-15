import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { BaseConfigDetail } from '@iace/contracts';
import { PageCrumbs } from '@iace/app-kit/browser';
import {
  Alert,
  Button,
  Card,
  EMPTY_STATE_KINDS,
  EmptyState,
  FormPanel,
  PageHeader,
  Skeleton,
  SkeletonParagraph,
} from '@iace/ui';
import { api } from '../../lib/api';
import { NAV_ITEMS } from '../../lib/nav';
import { baseConfigQueryKey } from '../../lib/query-keys';
import { configTitle, stageMetaOf, useConfigEditor } from './base-config-editor';
import {
  EditorBanners,
  EditorDialogs,
  HeaderAction,
  PaperSection,
  SectionsSection,
  SessionsSection,
  StageSection,
} from './base-config-form-sections';
import { Totals } from './base-config-fields';

// One stage blueprint; totalQuestions/totalMarks are never typed — the server sums them, and configTotalsOf mirrors that while editing.

export function BaseConfigFormPage() {
  const { id } = useParams();
  const existing = id !== undefined;
  const configId = id ?? '';
  // Set while it is being edited: a newer version arriving mid-edit must not rebuild the form under the typing.
  const [held, setHeld] = useState<BaseConfigDetail | null>(null);
  const editing = held !== null && held.id === id;

  const config = useQuery({
    queryKey: baseConfigQueryKey(id),
    queryFn: () => api.admin.baseConfigs.detail(configId),
    enabled: existing,
  });

  // The form has a known shape, so it is drawn and held rather than spun at.
  if (existing && config.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton variant="title" />
        <Card className="p-6">
          <SkeletonParagraph lines={5} />
        </Card>
        <Card className="p-6">
          <SkeletonParagraph lines={6} />
        </Card>
      </div>
    );
  }

  if (existing && !editing && (config.error || !config.data)) {
    return (
      <EmptyState
        kind={EMPTY_STATE_KINDS.FAILURE}
        title="Could not load this configuration"
        onRetry={config.refetch}
      />
    );
  }

  const detail = editing ? held : (config.data ?? null);

  // Remounted only when the saved version moves, so a refetch of the same one keeps a half-typed edit.
  return (
    <ConfigEditor
      key={detail?.updatedAt}
      detail={detail}
      isEditing={editing || !existing}
      onEditingChange={(next) => setHeld(next ? detail : null)}
    />
  );
}

// ============================================================================
// The editor
// ============================================================================

function ConfigEditor({
  detail,
  isEditing,
  onEditingChange,
}: Readonly<{
  detail: BaseConfigDetail | null;
  isEditing: boolean;
  onEditingChange: (editing: boolean) => void;
}>) {
  const editor = useConfigEditor({ detail, onEditingChange });
  const { form, save } = editor;

  return (
    <FormPanel
      disabled={!isEditing}
      onSubmit={editor.submit}
      footer={
        isEditing ? (
          <>
            <Button type="button" variant="outline" onClick={editor.cancel}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending || form.formState.isSubmitting}>
              {editor.saveLabel}
            </Button>
          </>
        ) : null
      }
      header={
        <>
          <PageHeader
            breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
            title={configTitle(detail, isEditing)}
            meta={stageMetaOf(detail)}
            action={
              editor.canWrite ? (
                <HeaderAction
                  isEditing={isEditing}
                  locked={editor.locked}
                  onClone={() => editor.setAsking(true)}
                  onEdit={() => onEditingChange(true)}
                />
              ) : undefined
            }
          />

          {editor.banner ? <Alert variant="danger">{editor.banner}</Alert> : null}
        </>
      }
    >
      <EditorBanners elsewhere={editor.elsewhere} locked={editor.locked} />

      <StageSection form={form} detail={detail} examStageId={editor.examStageId} />

      <PaperSection form={form} omrNeedsDefault={editor.omrNeedsDefault} />

      {editor.sessionPaper ? (
        <SessionsSection
          form={form}
          modules={editor.modules}
          displaced={editor.displaced}
          onRemove={editor.removeSession}
        />
      ) : null}

      <SectionsSection
        form={form}
        sections={editor.sections}
        issues={editor.issues}
        timerTemplate={editor.timerTemplate}
        sessionPaper={editor.sessionPaper}
      />

      <Totals form={form} />

      <EditorDialogs
        detail={detail}
        asking={editor.asking}
        onAskingChange={editor.setAsking}
        promoting={editor.promoting !== null}
        onPromotingClose={() => editor.setPromoting(null)}
        saving={save.isPending}
        losingDefault={editor.losingDefault}
        onPromote={() => editor.promoting && save.mutate(editor.promoting)}
      />
    </FormPanel>
  );
}
