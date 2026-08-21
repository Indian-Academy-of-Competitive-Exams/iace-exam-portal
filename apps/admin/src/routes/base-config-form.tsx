import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm, useWatch, type Path, type UseFormReturn } from 'react-hook-form';
import { Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  AppException,
  LANGUAGE_CODE,
  LANGUAGE_CODES,
  LANGUAGE_MODE,
  LANGUAGE_MODES,
  MERIT_TYPE,
  MERIT_TYPES,
  NAVIGATION_POLICIES,
  NAVIGATION_POLICY,
  TEST_UI,
  TEST_UIS,
  TIMER_TEMPLATE,
  TIMER_TEMPLATES,
  configTotalsOf,
  type BaseConfigDetail,
  type BaseConfigSection,
  type BaseConfigSectionDraft,
  type LanguageCode,
  type LanguageMode,
  type MeritType,
  type NavigationPolicy,
  type TestUi,
  type TimerTemplate,
} from '@iace/contracts';
import { applyFieldErrors, bannerMessage } from '@iace/app-kit';
import { PageCrumbs } from '@iace/app-kit/browser';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Combobox,
  ConfirmDialog,
  DataTable,
  FormActions,
  FormField,
  FormPanel,
  FormSection,
  Input,
  PageHeader,
  plural,
  Skeleton,
  SkeletonParagraph,
  StatRow,
  type DataTableColumn,
} from '@iace/ui';
import { api } from '../lib/api';
import {
  LANGUAGE_CODE_LABELS,
  LANGUAGE_MODE_HINTS,
  LANGUAGE_MODE_LABELS,
  MERIT_TYPE_HINTS,
  MERIT_TYPE_LABELS,
  NAV_ITEMS,
  NAVIGATION_POLICY_HINTS,
  NAVIGATION_POLICY_LABELS,
  ROUTES,
  TEST_UI_LABELS,
  TIMER_TEMPLATE_HINTS,
  TIMER_TEMPLATE_LABELS,
} from '../lib/constants';
import { durationLabel, minutesFieldOf, secondsFromMinutes } from '../lib/duration';
import { ExamStagePicker } from '../components/exam-picker';
import { SubjectPicker } from '../components/taxonomy-picker';

/**
 * One stage blueprint: the shape a test inherits, and the sections it is made of. `totalQuestions`
 * and `totalMarks` are never typed — the server sums them from the sections, and `configTotalsOf`
 * shows the same sums here while they are still being edited.
 */

interface SectionValues {
  name: string;
  subjectId: string;
  /** The index of the module this sits in — a session paper's only. */
  moduleOrder: string;
  questionCount: string;
  marksPerQuestion: string;
  negativeMarks: string;
  durationMin: string;
  perQuestionSec: string;
  mandatory: boolean;
  meritOrQualifying: MeritType;
  qualifyingCutoff: string;
}

interface ModuleValues {
  name: string;
  durationMin: string;
}

interface ConfigFormValues {
  examStageId: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  durationMin: string;
  timerTemplate: TimerTemplate;
  navigation: NavigationPolicy;
  optionalSectionCount: string;
  defaultTestUi: TestUi;
  languageMode: LanguageMode;
  languages: LanguageCode[];
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  calculatorEnabled: boolean;
  modules: ModuleValues[];
  sections: SectionValues[];
}

function emptySection(): SectionValues {
  return {
    name: '',
    subjectId: '',
    moduleOrder: '',
    questionCount: '',
    marksPerQuestion: '1',
    negativeMarks: '0',
    durationMin: '',
    perQuestionSec: '',
    mandatory: true,
    meritOrQualifying: MERIT_TYPE.MERIT,
    qualifyingCutoff: '',
  };
}

function emptyValues(): ConfigFormValues {
  return {
    examStageId: '',
    name: '',
    isDefault: false,
    isActive: true,
    durationMin: '',
    timerTemplate: TIMER_TEMPLATE.COMPOSITE_FREE,
    navigation: NAVIGATION_POLICY.FREE,
    optionalSectionCount: '',
    defaultTestUi: TEST_UI.CBT,
    languageMode: LANGUAGE_MODE.SINGLE,
    languages: [LANGUAGE_CODE.EN],
    shuffleQuestions: false,
    shuffleOptions: false,
    calculatorEnabled: false,
    modules: [],
    sections: [emptySection()],
  };
}

/** A section names its module by order, and the modules are new rows on every save. */
function moduleFieldOf(detail: BaseConfigDetail, section: BaseConfigSection): string {
  const index = detail.modules.findIndex((module) => module.id === section.moduleId);
  return index < 0 ? '' : String(index);
}

function valuesOf(detail: BaseConfigDetail | null): ConfigFormValues {
  if (detail === null) return emptyValues();

  return {
    examStageId: detail.examStageId,
    name: detail.name,
    isDefault: detail.isDefault,
    isActive: detail.isActive,
    durationMin: minutesFieldOf(detail.durationSec),
    timerTemplate: detail.timerTemplate,
    navigation: detail.navigation,
    optionalSectionCount:
      detail.optionalSectionCount === null ? '' : String(detail.optionalSectionCount),
    defaultTestUi: detail.defaultTestUi,
    languageMode: detail.languageMode,
    languages: [...detail.languages],
    shuffleQuestions: detail.shuffleQuestions,
    shuffleOptions: detail.shuffleOptions,
    calculatorEnabled: detail.calculatorEnabled,
    modules: detail.modules.map((module) => ({
      name: module.name,
      durationMin: minutesFieldOf(module.durationSec),
    })),
    sections: detail.sections.map((section) => ({
      name: section.name,
      subjectId: section.subjectId ?? '',
      moduleOrder: moduleFieldOf(detail, section),
      questionCount: String(section.questionCount),
      marksPerQuestion: String(section.marksPerQuestion),
      negativeMarks: String(section.negativeMarks),
      durationMin: minutesFieldOf(section.durationSec),
      perQuestionSec: section.perQuestionSec === null ? '' : String(section.perQuestionSec),
      mandatory: section.mandatory,
      meritOrQualifying: section.meritOrQualifying,
      qualifyingCutoff: section.qualifyingCutoff === null ? '' : String(section.qualifyingCutoff),
    })),
  };
}

function numberOr(raw: string, fallback: number): number {
  const trimmed = raw.trim();
  const value = Number(trimmed);
  return trimmed === '' || Number.isNaN(value) ? fallback : value;
}

function optionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  const value = Number(trimmed);
  return trimmed === '' || Number.isNaN(value) ? null : value;
}

function toSectionDraft(section: SectionValues, index: number): BaseConfigSectionDraft {
  return {
    name: section.name,
    // The list order IS the paper's order: nothing types a position two sections could share.
    order: index,
    moduleOrder: optionalNumber(section.moduleOrder),
    subjectId: section.subjectId || null,
    questionCount: numberOr(section.questionCount, 0),
    marksPerQuestion: numberOr(section.marksPerQuestion, 0),
    negativeMarks: numberOr(section.negativeMarks, 0),
    durationSec: secondsFromMinutes(section.durationMin),
    perQuestionSec: optionalNumber(section.perQuestionSec),
    mandatory: section.mandatory,
    meritOrQualifying: section.meritOrQualifying,
    qualifyingCutoff:
      section.meritOrQualifying === MERIT_TYPE.QUALIFYING
        ? optionalNumber(section.qualifyingCutoff)
        : null,
  };
}

function shapeOf(values: ConfigFormValues) {
  const sessionPaper = values.timerTemplate === TIMER_TEMPLATE.SESSION_MODULE_LOCKED;

  return {
    durationSec: secondsFromMinutes(values.durationMin) ?? 0,
    timerTemplate: values.timerTemplate,
    navigation: values.navigation,
    optionalSectionCount: optionalNumber(values.optionalSectionCount),
    defaultTestUi: values.defaultTestUi,
    languageMode: values.languageMode,
    languages: values.languages,
    shuffleQuestions: values.shuffleQuestions,
    shuffleOptions: values.shuffleOptions,
    calculatorEnabled: values.calculatorEnabled,
    sections: values.sections.map((section, index) => toSectionDraft(section, index)),
    // Only a session paper has modules; the server refuses a paper that carries them otherwise.
    modules: sessionPaper
      ? values.modules.map((module, index) => ({
          name: module.name,
          order: index,
          durationSec: secondsFromMinutes(module.durationMin),
        }))
      : [],
  };
}

const CONFIG_SERVER_FIELDS = ['examStageId', 'name'] as const;
const SECTION_SERVER_FIELDS = [
  'name',
  'questionCount',
  'marksPerQuestion',
  'negativeMarks',
  'qualifyingCutoff',
] as const;

/** Every path the server can name that this form registers, so a failure lands on its own input. */
function serverFields(sectionCount: number): Path<ConfigFormValues>[] {
  const sections = Array.from({ length: sectionCount }, (_, index) =>
    SECTION_SERVER_FIELDS.map((field) => `sections.${index}.${field}` as Path<ConfigFormValues>),
  ).flat();
  return [...CONFIG_SERVER_FIELDS, ...sections];
}

/** The whole-paper rules. They name no single input, so they are listed above the sections. */
function sectionIssuesOf(error: unknown): string[] {
  return AppException.is(error) ? (error.fieldErrors?.sections ?? []) : [];
}

/** The API names its clocks in seconds and the form asks for minutes — the same input either way. */
function minutesFieldFor(key: string): Path<ConfigFormValues> | null {
  if (key === 'durationSec') return 'durationMin';
  const section = /^sections\.(\d+)\.durationSec$/.exec(key);
  return section ? (`sections.${section[1]}.durationMin` as Path<ConfigFormValues>) : null;
}

function applyServerErrors(
  error: unknown,
  form: UseFormReturn<ConfigFormValues>,
  sectionCount: number,
): void {
  applyFieldErrors(error, form.setError, serverFields(sectionCount));
  if (!AppException.is(error) || !error.fieldErrors) return;

  for (const [key, messages] of Object.entries(error.fieldErrors)) {
    const field = minutesFieldFor(key);
    if (field && messages[0]) form.setError(field, { type: 'server', message: messages[0] });
  }
}

/** What the banner would repeat: `sections` has its own list, the clocks their own inputs. */
const BANNER_HANDLED_ELSEWHERE = ['sections', 'durationSec'] as const;

export function BaseConfigFormPage() {
  const { id } = useParams();
  const editing = id !== undefined;
  const [openForEditing, setOpenForEditing] = useState(false);

  const config = useQuery({
    queryKey: ['admin', 'base-config', id],
    queryFn: () => api.admin.baseConfigs.detail(id!),
    enabled: editing,
  });

  // The form has a known shape, so it is drawn and held rather than spun at.
  if (editing && config.isLoading) {
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

  if (editing && (config.error || !config.data)) {
    return <Alert variant="danger">Could not load this config.</Alert>;
  }

  // A saved config is READ first. Editing is a thing you choose, not the state you land in.
  if (config.data && !openForEditing) {
    return <ConfigView config={config.data} onEdit={() => setOpenForEditing(true)} />;
  }

  // Mounted only once the saved config is here, so a refetch cannot throw away a half-typed edit.
  return <ConfigEditor detail={config.data ?? null} onClose={() => setOpenForEditing(false)} />;
}

// ============================================================================
// Locked: the shape is frozen, so the screen states it rather than offering it
// ============================================================================

const yesNo = (on: boolean) => (on ? 'Yes' : 'No');

function lockedSectionColumns(): DataTableColumn<BaseConfigSection>[] {
  return [
    {
      key: 'name',
      header: 'Section',
      className: 'font-medium',
      cell: (section) => (
        <span className="inline-flex items-center gap-2">
          {section.name}
          {section.mandatory ? null : <Badge variant="neutral">Optional</Badge>}
        </span>
      ),
    },
    {
      key: 'questions',
      header: 'Questions',
      numeric: true,
      cell: (section) => section.questionCount,
    },
    {
      key: 'marks',
      header: 'Marks per question',
      numeric: true,
      cell: (section) => section.marksPerQuestion,
    },
    {
      key: 'negative',
      header: 'Negative',
      numeric: true,
      cell: (section) => section.negativeMarks,
    },
    {
      key: 'time',
      header: 'Time',
      numeric: true,
      cell: (section) => durationLabel(section.durationSec),
    },
    {
      key: 'merit',
      header: 'Merit or qualifying',
      cell: (section) => (
        <span className="text-muted-foreground">
          {MERIT_TYPE_LABELS[section.meritOrQualifying]}
          {section.qualifyingCutoff === null ? '' : ` — cutoff ${section.qualifyingCutoff}`}
        </span>
      ),
    },
  ];
}

/**
 * A locked config refuses every shape change, so no form is offered: filling one in and being
 * told no at the end is worse than being told first. Cloning is the way forward and is the
 * primary action here.
 */
function ConfigView({
  config,
  onEdit,
}: Readonly<{ config: BaseConfigDetail; onEdit: () => void }>) {
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);

  const clone = useMutation({
    meta: { success: 'Config cloned.' },
    mutationFn: () => api.admin.baseConfigs.clone(config.id, {}),
    onSuccess: (copy: BaseConfigDetail) => {
      setAsking(false);
      navigate(ROUTES.BASE_CONFIG(copy.id));
    },
    onError: () => setAsking(false),
  });

  return (
    <FormPanel
      footer={
        <Button variant="outline" asChild>
          <Link to={ROUTES.BASE_CONFIGS}>Back to configs</Link>
        </Button>
      }
      header={
        <PageHeader
          breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
          title={config.name}
          description={`${config.examStage.exam.code} / ${config.examStage.name} — version ${config.version}`}
          action={
            config.locked ? (
              <Button size="sm" onClick={() => setAsking(true)}>
                <Copy aria-hidden />
                Clone to change it
              </Button>
            ) : (
              <Button size="sm" onClick={onEdit}>
                <Pencil aria-hidden />
                Edit
              </Button>
            )
          }
        />
      }
    >
      {config.locked ? (
        <Alert variant="warning">
          <span>
            This config is locked — a test built from it has already been finalized, and a paper
            somebody has sat cannot change shape underneath them. The duration, the timer, the
            navigation, the languages and every section below are fixed for good, which is why there
            is no form here to fill in. Clone it to carry all of this into a copy you can edit: the
            copy starts unlocked and is not the stage&apos;s default until you promote it. The name,
            and whether this one is still offered, can be changed from the configs list.
          </span>
        </Alert>
      ) : null}

      <FormSection title="How the paper runs">
        <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          <StatRow label="Timing pattern" value={TIMER_TEMPLATE_LABELS[config.timerTemplate]} />
          <StatRow label="Navigation" value={NAVIGATION_POLICY_LABELS[config.navigation]} />
          <StatRow label="Duration" value={durationLabel(config.durationSec)} />
          <StatRow label="Test interface" value={TEST_UI_LABELS[config.defaultTestUi]} />
          <StatRow
            label="Languages"
            value={config.languages.map((code) => LANGUAGE_CODE_LABELS[code]).join(', ') || '—'}
          />
          <StatRow label="Language mode" value={LANGUAGE_MODE_LABELS[config.languageMode]} />
          <StatRow label="Shuffle questions" value={yesNo(config.shuffleQuestions)} />
          <StatRow label="Shuffle options" value={yesNo(config.shuffleOptions)} />
          <StatRow label="Calculator" value={yesNo(config.calculatorEnabled)} />
          <StatRow
            label="Optional sections"
            value={config.optionalSectionCount ?? 'None — every section counts'}
          />
          <StatRow label="Tests built from it" value={config.testCount} />
        </div>
      </FormSection>

      {config.modules.length > 0 ? (
        <FormSection title="Sessions">
          <div className="flex flex-col gap-2">
            {config.modules.map((module) => (
              <StatRow
                key={module.id}
                label={module.name}
                value={durationLabel(module.durationSec)}
              />
            ))}
          </div>
        </FormSection>
      ) : null}

      <FormSection
        title="Sections"
        description={`${plural(config.sections.length, 'section')}, adding up to ${plural(config.totalQuestions, 'question')} and ${config.totalMarks} marks.`}
      >
        <DataTable
          columns={lockedSectionColumns()}
          rows={config.sections}
          rowKey={(section) => section.id}
          isLoading={false}
          empty="This config has no sections."
        />
      </FormSection>

      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        loading={clone.isPending}
        title={`Clone ${config.name}?`}
        description={`The copy carries every setting and all ${plural(config.totalQuestions, 'question')} of its sections as they stand now. It starts unlocked, is not the stage's default, and ${config.name} is left exactly as it is. You will land on the copy.`}
        confirmLabel="Clone config"
        onConfirm={() => clone.mutate()}
      />
    </FormPanel>
  );
}

// ============================================================================
// The editor
// ============================================================================

function ConfigEditor({
  detail,
  onClose,
}: Readonly<{ detail: BaseConfigDetail | null; onClose: () => void }>) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const editing = detail !== null;

  const form = useForm<ConfigFormValues>({ defaultValues: valuesOf(detail) });
  const sections = useFieldArray({ control: form.control, name: 'sections' });
  const modules = useFieldArray({ control: form.control, name: 'modules' });

  const save = useMutation({
    meta: { success: editing ? 'Config saved.' : 'Config created.' },
    mutationFn: (values: ConfigFormValues) =>
      detail
        ? api.admin.baseConfigs.update(detail.id, {
            name: values.name,
            isDefault: values.isDefault,
            isActive: values.isActive,
            ...shapeOf(values),
          })
        : api.admin.baseConfigs.create({
            examStageId: values.examStageId,
            name: values.name,
            isDefault: values.isDefault,
            ...shapeOf(values),
          }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'base-configs'] });
      navigate(ROUTES.BASE_CONFIGS);
    },
    onError: (error) => applyServerErrors(error, form, form.getValues('sections').length),
  });

  const examStageId = useWatch({ control: form.control, name: 'examStageId' });
  const timerTemplate = useWatch({ control: form.control, name: 'timerTemplate' });
  const navigation = useWatch({ control: form.control, name: 'navigation' });
  const defaultTestUi = useWatch({ control: form.control, name: 'defaultTestUi' });
  const languageMode = useWatch({ control: form.control, name: 'languageMode' });
  const watchedSections = useWatch({ control: form.control, name: 'sections' }) ?? [];
  const sessionPaper = timerTemplate === TIMER_TEMPLATE.SESSION_MODULE_LOCKED;
  const watchedModules = useWatch({ control: form.control, name: 'modules' }) ?? [];

  const issues = sectionIssuesOf(save.error);
  const banner = bannerMessage(save.error, [
    ...serverFields(watchedSections.length).map(String),
    ...BANNER_HANDLED_ELSEWHERE,
  ]);

  return (
    <FormPanel
      onSubmit={form.handleSubmit((values) => save.mutate(values))}
      footer={
        <>
          {editing ? (
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
          ) : (
            <Button type="button" variant="outline" asChild>
              <Link to={ROUTES.BASE_CONFIGS}>Cancel</Link>
            </Button>
          )}
          <Button type="submit" loading={save.isPending}>
            {editing ? 'Save config' : 'Create config'}
          </Button>
        </>
      }
      header={
        <>
          <PageHeader
            breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
            title={editing ? `Edit ${detail.name}` : 'New base config'}
          />

          {banner ? (
            <Alert variant="danger" className="mb-4">
              {banner}
            </Alert>
          ) : null}
        </>
      }
    >
      <FormSection title="Which stage this is for">
        <div className="grid gap-4 sm:grid-cols-2">
          {editing ? (
            <ReadOnlyField
              label="Stage"
              value={`${detail.examStage.exam.code} / ${detail.examStage.name}`}
            />
          ) : (
            <FormField form={form} name="examStageId" label="Stage">
              {(control) => (
                <ExamStagePicker
                  id={control.id}
                  value={examStageId}
                  placeholder="Choose a stage"
                  onChange={(value) =>
                    form.setValue('examStageId', value, { shouldValidate: true })
                  }
                />
              )}
            </FormField>
          )}

          <FormField form={form} name="name" label="Name">
            {(control) => <Input {...control} placeholder="SSC CGL Tier 1 — 2024 pattern" />}
          </FormField>

          <ToggleField form={form} name="isDefault" label="The stage's default pattern" />

          {editing ? (
            <ToggleField
              form={form}
              name="isActive"
              label="Offered when building a test"
              hint="Tests already built keep it"
            />
          ) : null}
        </div>
      </FormSection>

      <FormSection title="How the paper runs">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FormField form={form} name="durationMin" label="Duration (minutes)">
            {(control) => <Input {...control} inputMode="numeric" placeholder="60" />}
          </FormField>

          <FormField form={form} name="timerTemplate" label="Timing pattern">
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control['aria-describedby']}
                aria-invalid={control['aria-invalid']}
                clearable={false}
                value={timerTemplate}
                onChange={(next) =>
                  form.setValue('timerTemplate', next as TimerTemplate, { shouldDirty: true })
                }
                items={TIMER_TEMPLATES.map((value) => ({
                  value,
                  label: TIMER_TEMPLATE_LABELS[value],
                  hint: TIMER_TEMPLATE_HINTS[value],
                }))}
              />
            )}
          </FormField>

          <FormField form={form} name="navigation" label="Navigation">
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control['aria-describedby']}
                aria-invalid={control['aria-invalid']}
                clearable={false}
                value={navigation}
                onChange={(next) =>
                  form.setValue('navigation', next as NavigationPolicy, { shouldDirty: true })
                }
                items={NAVIGATION_POLICIES.map((value) => ({
                  value,
                  label: NAVIGATION_POLICY_LABELS[value],
                  hint: NAVIGATION_POLICY_HINTS[value],
                }))}
              />
            )}
          </FormField>

          <FormField form={form} name="defaultTestUi" label="Test interface">
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control['aria-describedby']}
                aria-invalid={control['aria-invalid']}
                clearable={false}
                value={defaultTestUi}
                onChange={(next) =>
                  form.setValue('defaultTestUi', next as TestUi, { shouldDirty: true })
                }
                items={TEST_UIS.map((value) => ({ value, label: TEST_UI_LABELS[value] }))}
              />
            )}
          </FormField>

          <FormField form={form} name="languageMode" label="Language mode">
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control['aria-describedby']}
                aria-invalid={control['aria-invalid']}
                clearable={false}
                value={languageMode}
                onChange={(next) =>
                  form.setValue('languageMode', next as LanguageMode, { shouldDirty: true })
                }
                items={LANGUAGE_MODES.map((value) => ({
                  value,
                  label: LANGUAGE_MODE_LABELS[value],
                  hint: LANGUAGE_MODE_HINTS[value],
                }))}
              />
            )}
          </FormField>

          <FormField
            form={form}
            name="optionalSectionCount"
            label="Optional sections"
            hint="Blank means none"
          >
            {(control) => <Input {...control} inputMode="numeric" placeholder="0" />}
          </FormField>

          <div className="sm:col-span-2 lg:col-span-3">
            <LanguageChoice form={form} />
          </div>

          <div className="flex flex-wrap gap-x-8 gap-y-2 sm:col-span-2 lg:col-span-3">
            <ToggleField form={form} name="shuffleQuestions" label="Shuffle the questions" />
            <ToggleField form={form} name="shuffleOptions" label="Shuffle the options" />
            <ToggleField form={form} name="calculatorEnabled" label="Offer a calculator" />
          </div>
        </div>
      </FormSection>

      {sessionPaper ? (
        <FormSection title="Sessions">
          <div className="flex flex-col gap-3">
            {modules.fields.map((field, index) => (
              <div
                key={field.id}
                className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3"
              >
                <FormField
                  form={form}
                  name={`modules.${index}.name`}
                  label="Session"
                  className="min-w-48 flex-1"
                >
                  {(control) => <Input {...control} placeholder="Session 1" />}
                </FormField>
                <FormField
                  form={form}
                  name={`modules.${index}.durationMin`}
                  label="Minutes"
                  className="w-28"
                >
                  {(control) => <Input {...control} inputMode="numeric" />}
                </FormField>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Remove session ${index + 1}`}
                  onClick={() => modules.remove(index)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ))}

            <FormActions className="pt-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => modules.append({ name: '', durationMin: '' })}
              >
                <Plus aria-hidden />
                Add a session
              </Button>
            </FormActions>
          </div>
        </FormSection>
      ) : null}

      <FormSection title="Sections">
        <div className="flex flex-col gap-4">
          {issues.length > 0 ? (
            <Alert variant="danger">
              <ul className="flex list-disc flex-col gap-1 pl-4">
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </Alert>
          ) : null}

          {sections.fields.map((field, index) => (
            <SectionCard
              key={field.id}
              form={form}
              index={index}
              sectionalClocks={timerTemplate === TIMER_TEMPLATE.SECTIONAL_LOCKED}
              moduleNames={sessionPaper ? watchedModules.map((module) => module.name) : []}
              canRemove={sections.fields.length > 1}
              onRemove={() => sections.remove(index)}
            />
          ))}

          <FormActions className="pt-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => sections.append(emptySection())}
            >
              <Plus aria-hidden />
              Add a section
            </Button>
          </FormActions>
        </div>
      </FormSection>

      <Totals sections={watchedSections} />
    </FormPanel>
  );
}

/** A boolean the form owns. Controlled, because `register` alone cannot hold a checkbox's state. */
/** A value the form cannot change, drawn like the fields beside it rather than as a table row. */
function ReadOnlyField({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <span className="flex h-9 items-center text-sm text-muted-foreground">{value}</span>
    </div>
  );
}

function ToggleField({
  form,
  name,
  label,
  hint,
}: Readonly<{
  form: UseFormReturn<ConfigFormValues>;
  name: 'isDefault' | 'isActive' | 'shuffleQuestions' | 'shuffleOptions' | 'calculatorEnabled';
  label: string;
  hint?: string;
}>) {
  const checked = useWatch({ control: form.control, name });

  return (
    <Checkbox
      checked={checked}
      onChange={(event) => form.setValue(name, event.target.checked)}
      label={label}
      hint={hint}
    />
  );
}

/** Which languages the paper is offered in. Three fixed codes, so checkboxes rather than a list. */
function LanguageChoice({ form }: Readonly<{ form: UseFormReturn<ConfigFormValues> }>) {
  const languages = useWatch({ control: form.control, name: 'languages' }) ?? [];

  const toggle = (code: LanguageCode) =>
    form.setValue(
      'languages',
      languages.includes(code) ? languages.filter((kept) => kept !== code) : [...languages, code],
    );

  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-sm font-medium text-foreground">Languages</legend>
      <div className="flex flex-wrap gap-1">
        {LANGUAGE_CODES.map((code) => (
          <Checkbox
            key={code}
            checked={languages.includes(code)}
            onChange={() => toggle(code)}
            label={LANGUAGE_CODE_LABELS[code]}
          />
        ))}
      </div>
    </fieldset>
  );
}

function SectionCard({
  form,
  index,
  sectionalClocks,
  moduleNames,
  canRemove,
  onRemove,
}: Readonly<{
  form: UseFormReturn<ConfigFormValues>;
  index: number;
  sectionalClocks: boolean;
  moduleNames: readonly string[];
  canRemove: boolean;
  onRemove: () => void;
}>) {
  const subjectId = useWatch({ control: form.control, name: `sections.${index}.subjectId` });
  const merit = useWatch({ control: form.control, name: `sections.${index}.meritOrQualifying` });
  const moduleOrder = useWatch({ control: form.control, name: `sections.${index}.moduleOrder` });

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-foreground">Section {index + 1}</span>
        {canRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Remove section ${index + 1}`}
            onClick={onRemove}
          >
            <Trash2 aria-hidden />
            Remove
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FormField form={form} name={`sections.${index}.name`} label="Name">
          {(control) => <Input {...control} placeholder="General Intelligence" />}
        </FormField>

        <FormField form={form} name={`sections.${index}.subjectId`} label="Subject" hint="Optional">
          {(control) => (
            <SubjectPicker
              id={control.id}
              value={subjectId}
              clearable
              placeholder="Any subject"
              onChange={(value) => form.setValue(`sections.${index}.subjectId`, value)}
            />
          )}
        </FormField>

        <FormField form={form} name={`sections.${index}.questionCount`} label="Questions">
          {(control) => <Input {...control} inputMode="numeric" placeholder="25" />}
        </FormField>

        <FormField
          form={form}
          name={`sections.${index}.marksPerQuestion`}
          label="Marks per question"
        >
          {(control) => <Input {...control} inputMode="decimal" placeholder="2" />}
        </FormField>

        <FormField
          form={form}
          name={`sections.${index}.negativeMarks`}
          label="Negative marks"
          hint="Per wrong answer"
        >
          {(control) => <Input {...control} inputMode="decimal" placeholder="0.5" />}
        </FormField>

        <FormField
          form={form}
          name={`sections.${index}.durationMin`}
          label="Minutes"
          hint={sectionalClocks ? 'Required — this paper has a clock per section' : 'Optional'}
        >
          {(control) => <Input {...control} inputMode="numeric" />}
        </FormField>

        <FormField
          form={form}
          name={`sections.${index}.perQuestionSec`}
          label="Seconds per question"
          hint="Optional"
        >
          {(control) => <Input {...control} inputMode="numeric" />}
        </FormField>

        <FormField
          form={form}
          name={`sections.${index}.meritOrQualifying`}
          label="Merit or qualifying"
        >
          {(control) => (
            <Combobox
              id={control.id}
              aria-describedby={control['aria-describedby']}
              aria-invalid={control['aria-invalid']}
              clearable={false}
              value={merit}
              onChange={(next) =>
                form.setValue(`sections.${index}.meritOrQualifying`, next as MeritType, {
                  shouldDirty: true,
                })
              }
              items={MERIT_TYPES.map((value) => ({
                value,
                label: MERIT_TYPE_LABELS[value],
                hint: MERIT_TYPE_HINTS[value],
              }))}
            />
          )}
        </FormField>

        {merit === MERIT_TYPE.QUALIFYING ? (
          <FormField
            form={form}
            name={`sections.${index}.qualifyingCutoff`}
            label="Qualifying cutoff"
          >
            {(control) => <Input {...control} inputMode="decimal" />}
          </FormField>
        ) : null}

        {moduleNames.length > 0 ? (
          <FormField form={form} name={`sections.${index}.moduleOrder`} label="Session">
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control['aria-describedby']}
                aria-invalid={control['aria-invalid']}
                clearable={false}
                value={moduleOrder ?? ''}
                onChange={(next) =>
                  form.setValue(`sections.${index}.moduleOrder`, next, { shouldDirty: true })
                }
                items={[
                  { value: '', label: 'The first session' },
                  ...moduleNames.map((name, moduleIndex) => ({
                    value: String(moduleIndex),
                    label: name || `Session ${moduleIndex + 1}`,
                  })),
                ]}
              />
            )}
          </FormField>
        ) : null}
      </div>

      <ToggleSection form={form} index={index} />
    </div>
  );
}

/** `mandatory` is per section and is the only boolean on one. */
function ToggleSection({
  form,
  index,
}: Readonly<{ form: UseFormReturn<ConfigFormValues>; index: number }>) {
  const mandatory = useWatch({ control: form.control, name: `sections.${index}.mandatory` });

  return (
    <Checkbox
      checked={mandatory}
      onChange={(event) => form.setValue(`sections.${index}.mandatory`, event.target.checked)}
      label="Every student must attempt this section"
    />
  );
}

/** The cache the server keeps on the config, summed live so it is never typed. */
function Totals({ sections }: Readonly<{ sections: readonly SectionValues[] }>) {
  const totals = configTotalsOf(sections.map((section, index) => toSectionDraft(section, index)));

  return (
    <FormSection title="What this adds up to">
      <div className="grid gap-x-8 gap-y-2 sm:grid-cols-3">
        <StatRow label="Sections" value={sections.length} />
        <StatRow label="Questions" value={totals.totalQuestions} />
        <StatRow label="Marks" value={totals.totalMarks} />
      </div>
    </FormSection>
  );
}
