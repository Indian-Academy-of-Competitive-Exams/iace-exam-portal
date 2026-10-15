import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import {
  AppException,
  ErrorCodes,
  EXAM_TEMPLATE,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  TEST_UI,
  TIMER_TEMPLATE,
  type BaseConfigDetail,
} from '@iace/contracts';
import { bannerMessage } from '@iace/app-kit';
import { plural, toast } from '@iace/ui';
import { api } from '../../lib/api';
import { QUERY_KEYS, defaultBaseConfigQueryKey } from '../../lib/query-keys';
import { ROUTES } from '../../lib/constants';
import { useAuth } from '../../providers/auth';
import { sectionsAfterSessionRemoved, sectionsInSession } from './base-config-sessions';
import {
  type ConfigFormValues,
  valuesOf,
  shapeOf,
  serverFields,
  sectionIssuesOf,
  applyServerErrors,
  shownElsewhere,
} from './base-config-values';

/** The sections a removed session held and where they went; null when it held none. */
function displacedNote(
  sessions: ConfigFormValues['modules'],
  index: number,
  moved: number,
): string | null {
  const first = sessions.find((_, at) => at !== index);
  if (!first || moved === 0) return null;
  const removed = sessions[index]?.name || `Session ${index + 1}`;
  return `${removed} held ${plural(moved, 'section')}, now in ${first.name || 'the first session'}.`;
}

export function configTitle(detail: BaseConfigDetail | null, isEditing: boolean): string {
  if (!detail) return 'New base configuration';
  return isEditing ? `Edit ${detail.name}` : detail.name;
}

export function stageMetaOf(detail: BaseConfigDetail | null): string | undefined {
  if (!detail) return undefined;
  return `${detail.examStage.exam.code} / ${detail.examStage.name}, version ${detail.version}`;
}

export function useConfigEditor({
  detail,
  onEditingChange,
}: Readonly<{
  detail: BaseConfigDetail | null;
  onEditingChange: (editing: boolean) => void;
}>) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { identity, can } = useAuth();
  const canWrite = can(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.WRITE);
  const existing = detail !== null;
  const saveLabel = existing ? 'Save configuration' : 'Create configuration';
  // A locked config can never be edited, so it is the one that never leaves read-only.
  const locked = detail?.locked ?? false;
  const editingBy = detail?.editingBy ?? null;
  const elsewhere = editingBy?.adminId === identity?.id ? null : editingBy;
  const [asking, setAsking] = useState(false);
  const [promoting, setPromoting] = useState<ConfigFormValues | null>(null);
  const [losingDefault, setLosingDefault] = useState<string | null>(null);
  const [displaced, setDisplaced] = useState<string | null>(null);

  const form = useForm<ConfigFormValues>({ defaultValues: valuesOf(detail) });
  const sections = useFieldArray({ control: form.control, name: 'sections' });
  const modules = useFieldArray({ control: form.control, name: 'modules' });

  // Silent: the form's own banner and fields say what went wrong, so a toast would say it twice.
  const save = useMutation({
    meta: { silent: true },
    mutationFn: (values: ConfigFormValues) =>
      detail
        ? api.admin.baseConfigs.update(detail.id, {
            name: values.name,
            isDefault: values.isDefault,
            isActive: values.isActive,
            expectedUpdatedAt: detail.updatedAt,
            ...shapeOf(values),
          })
        : api.admin.baseConfigs.create({
            examStageId: values.examStageId,
            name: values.name,
            isDefault: values.isDefault,
            ...shapeOf(values),
          }),
    onSuccess: async () => {
      toast.success(existing ? 'Configuration saved.' : 'Configuration created.');
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.BASE_CONFIGS });
      navigate(ROUTES.BASE_CONFIGS);
    },
    onError: (error) => {
      // Closed, or the banner and fields holding the error stay behind its overlay.
      setPromoting(null);
      applyServerErrors(error, form);
      // A save refused as out of date leaves that copy cached, to be opened and refused again.
      if (AppException.is(error) && error.code === ErrorCodes.CONFLICT) {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.BASE_CONFIGS });
      }
    },
  });

  const examStageId = useWatch({ control: form.control, name: 'examStageId' });
  const examTemplate = useWatch({ control: form.control, name: 'examTemplate' });
  const defaultTestUi = useWatch({ control: form.control, name: 'defaultTestUi' });
  // A bubble sheet is the default template's affordance; no other skin draws one.
  const omrNeedsDefault = defaultTestUi === TEST_UI.OMR && examTemplate !== EXAM_TEMPLATE.DEFAULT;
  const timerTemplate = useWatch({ control: form.control, name: 'timerTemplate' });
  const sessionPaper = timerTemplate === TIMER_TEMPLATE.SESSION_MODULE_LOCKED;

  /** A new config has nowhere to fall back to, so Cancel leaves; a saved one returns to itself. */
  const cancel = () => {
    if (!existing) return navigate(ROUTES.BASE_CONFIGS);
    form.reset();
    setDisplaced(null);
    onEditingChange(false);
  };

  /** A section names its session by position, so the sections follow the removal and the ones it held are named. */
  const removeSession = (index: number) => {
    const sessions = form.getValues('modules');
    const before = form.getValues('sections');
    const moved = sectionsInSession(before, index).length;

    modules.remove(index);
    sectionsAfterSessionRemoved(before, index).forEach((section, at) =>
      form.setValue(`sections.${at}.moduleOrder`, section.moduleOrder, { shouldDirty: true }),
    );
    setDisplaced(displacedNote(sessions, index, moved));
  };

  const issues = sectionIssuesOf(save.error);
  const banner = bannerMessage(save.error, [
    ...serverFields(sections.fields.length, modules.fields.length).map(String),
    ...shownElsewhere(save.error),
  ]);

  /** Taking the stage's default off another configuration is confirmed before anything is saved. */
  const submit = form.handleSubmit(async (values) => {
    if (!values.isDefault || !values.examStageId) return save.mutate(values);

    // Read as the save is made: one from when the form opened may not have answered, or may predate another admin's change.
    const current = await queryClient
      .fetchQuery({
        queryKey: defaultBaseConfigQueryKey(values.examStageId),
        queryFn: () =>
          api.admin.baseConfigs.list({
            examStageId: values.examStageId,
            defaultOnly: 'true',
            pageSize: 1,
          }),
        staleTime: 0,
      })
      .catch(() => null);
    // The failed read is already announced, and saving unasked is what this exists to stop.
    if (current === null) return;

    // Only a config other than this one can lose the badge; re-saving the default takes nothing.
    const losing = current.items.find((row) => row.id !== detail?.id);
    if (!losing) return save.mutate(values);
    setLosingDefault(losing.name);
    setPromoting(values);
  });

  return {
    canWrite,
    existing,
    saveLabel,
    locked,
    elsewhere,
    asking,
    setAsking,
    promoting,
    setPromoting,
    losingDefault,
    displaced,
    form,
    sections,
    modules,
    save,
    examStageId,
    omrNeedsDefault,
    timerTemplate,
    sessionPaper,
    cancel,
    removeSession,
    issues,
    banner,
    submit,
  };
}
