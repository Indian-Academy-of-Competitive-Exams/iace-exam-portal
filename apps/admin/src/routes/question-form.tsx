import { useEffect, useState } from 'react';
import { Check, Pencil } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch, type Path, type UseFormReturn } from 'react-hook-form';
import {
  ANSWER_MODE,
  ANSWER_MODES,
  DEFAULT_LANGUAGE,
  DIFFICULTY_LEVELS,
  LANGUAGE_LABELS,
  LANGUAGE_ORDER,
  MCQ_OPTION_COUNT,
  QUESTION_INTAKE_HINTS,
  QUESTION_INTAKE_STATUSES,
  QUESTION_STATUS,
  type QUESTION_STATUSES,
  QUESTION_TYPE,
  QUESTION_TYPES,
  TAG_SEPARATOR,
  plainTextOf,
  type QuestionDetail,
  type QuestionDraftInput,
  type QuestionLanguage,
  QUESTION_IMAGE_ACCEPTED_TYPES,
  QUESTION_IMAGE_MAX_BYTES,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
} from '@iace/contracts';
import { applyFieldErrors, bannerMessage } from '@iace/app-kit';
import { PageCrumbs } from '@iace/app-kit/browser';
import {
  Alert,
  Button,
  Combobox,
  ConfirmDialog,
  FormField,
  FormPanel,
  FormSection,
  Input,
  PageHeader,
  Skeleton,
  SkeletonParagraph,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  type FieldControl,
} from '@iace/ui';
import { RichText } from '@iace/ui/rich-text';
import { api } from '../lib/api';
import { useAuth } from '../providers/auth';
import { NAV_ITEMS, ROUTES } from '../lib/constants';
import { SubjectPicker, TopicPicker } from '../components/taxonomy-picker';

/**
 * One question, by hand. The bulk of the bank arrives by sheet; this is for the
 * one an admin writes or fixes.
 *
 * The field names mirror the draft the API takes exactly — `stem.en`,
 * `options.2.text.hi` — so a validation failure from the server lands on the
 * input it is about without a translation table in between.
 */

type LanguageMap = Record<QuestionLanguage, string>;

interface QuestionFormValues {
  type: (typeof QUESTION_TYPES)[number];
  subjectId: string;
  topicId: string;
  difficulty: (typeof DIFFICULTY_LEVELS)[number];
  status: (typeof QUESTION_STATUSES)[number];
  questionCode: string;
  tags: string;
  correctOption: string;
  stem: LanguageMap;
  solution: LanguageMap;
  options: { text: LanguageMap }[];
  answerMode: (typeof ANSWER_MODES)[number];
  answers: LanguageMap;
  tolerance: string;
}

const emptyLanguages = (): LanguageMap => ({ en: '', hi: '', te: '' });

/** From the contract, so the picker offers exactly what checkQuestionImage will accept. */
const IMAGE_LIMITS = {
  accept: QUESTION_IMAGE_ACCEPTED_TYPES,
  maxBytes: QUESTION_IMAGE_MAX_BYTES,
} as const;

/** ARCHIVED is a retirement, so it is only on offer once there is something to retire. */
function statusChoices(existing: boolean) {
  const intake = QUESTION_INTAKE_STATUSES.map((value) => ({
    value,
    label: value,
    hint: QUESTION_INTAKE_HINTS[value],
  }));
  if (!existing) return intake;
  return [...intake, { value: QUESTION_STATUS.ARCHIVED, label: QUESTION_STATUS.ARCHIVED }];
}

function emptyValues(): QuestionFormValues {
  return {
    type: QUESTION_TYPE.SINGLE_MCQ,
    subjectId: '',
    topicId: '',
    difficulty: 'MEDIUM',
    status: QUESTION_STATUS.DRAFT,
    questionCode: '',
    tags: '',
    correctOption: '1',
    stem: emptyLanguages(),
    solution: emptyLanguages(),
    options: Array.from({ length: MCQ_OPTION_COUNT }, () => ({ text: emptyLanguages() })),
    answerMode: ANSWER_MODE.EXACT,
    answers: emptyLanguages(),
    tolerance: '',
  };
}

/** Reads a saved question back into the boxes it was typed in. */
function valuesOf(question: QuestionDetail): QuestionFormValues {
  const stem = emptyLanguages();
  const solution = emptyLanguages();
  for (const language of LANGUAGE_ORDER) {
    stem[language] = plainTextOf(question.content[language]?.stem);
    solution[language] = plainTextOf(question.content[language]?.solution);
  }

  const options = Array.from({ length: MCQ_OPTION_COUNT }, (_, index) => {
    const saved = question.options.find((option) => option.position === index + 1);
    const text = emptyLanguages();
    for (const language of LANGUAGE_ORDER) text[language] = plainTextOf(saved?.text[language]);
    return { text };
  });

  const answers = emptyLanguages();
  for (const language of LANGUAGE_ORDER) {
    answers[language] = question.answerKey?.answers[language] ?? '';
  }

  return {
    type: question.type,
    subjectId: question.subject.id,
    topicId: question.topic?.id ?? '',
    difficulty: question.difficulty,
    status: question.status,
    questionCode: question.questionCode ?? '',
    tags: question.tags.join(`${TAG_SEPARATOR} `),
    correctOption: String(question.options.find((option) => option.isCorrect)?.position ?? 1),
    stem,
    solution,
    options,
    answerMode: question.answerKey?.mode ?? ANSWER_MODE.EXACT,
    answers,
    tolerance: question.answerKey?.tolerance == null ? '' : String(question.answerKey.tolerance),
  };
}

/** Blank boxes are absent, never empty strings the validator would have to judge. */
function filled(map: LanguageMap): Partial<LanguageMap> {
  const out: Partial<LanguageMap> = {};
  for (const language of LANGUAGE_ORDER) {
    if (map[language].trim() !== '') out[language] = map[language].trim();
  }
  return out;
}

function toDraft(values: QuestionFormValues): QuestionDraftInput {
  const isMcq = values.type === QUESTION_TYPE.SINGLE_MCQ;

  return {
    type: values.type,
    subjectId: values.subjectId,
    topicId: values.topicId || null,
    difficulty: values.difficulty,
    status: values.status,
    questionCode: values.questionCode.trim() || null,
    stem: filled(values.stem),
    solution: filled(values.solution),
    options: isMcq
      ? values.options
          .map((option, index) => ({
            position: index + 1,
            isCorrect: String(index + 1) === values.correctOption,
            text: filled(option.text),
          }))
          .filter((option) => Object.keys(option.text).length > 0)
      : [],
    answerKey: isMcq
      ? null
      : {
          mode: values.answerMode,
          answers: filled(values.answers),
          ...(values.answerMode === ANSWER_MODE.NUMERIC && values.tolerance.trim() !== ''
            ? { tolerance: values.tolerance }
            : {}),
        },
    tags: values.tags
      .split(TAG_SEPARATOR)
      .map((tag) => tag.trim())
      .filter((tag) => tag !== ''),
  };
}

/** Every path the server can name, so a failure lands on its own input. */
const SERVER_FIELDS = [
  'subjectId',
  'topicId',
  'difficulty',
  'type',
  'status',
  'questionCode',
  'tags',
  'options',
  ...LANGUAGE_ORDER.map((language) => `stem.${language}` as const),
  ...LANGUAGE_ORDER.map((language) => `solution.${language}` as const),
] as const;

export function QuestionFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const existing = id !== undefined;
  // A new question opens ready to type; one that already exists opens read-only.
  const [isEditing, setIsEditing] = useState(!existing);

  const question = useQuery({
    queryKey: ['admin', 'question', id],
    queryFn: () => api.admin.questions.detail(id!),
    enabled: existing,
  });

  const form = useForm<QuestionFormValues>({ defaultValues: emptyValues() });

  // The saved question arrives after the first render; reset rather than key the
  // whole form off it, so a half-typed edit is not thrown away by a refetch.
  const loaded = question.data;
  useEffect(() => {
    if (loaded) form.reset(valuesOf(loaded));
  }, [loaded, form]);

  const save = useMutation({
    meta: { success: existing ? 'Question saved.' : 'Question added.' },
    mutationFn: (values: QuestionFormValues) =>
      existing
        ? api.admin.questions.update(id!, toDraft(values))
        : api.admin.questions.create(toDraft(values)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'questions'] });
      navigate(ROUTES.QUESTIONS);
    },
    onError: (error) => applyFieldErrors(error, form.setError, [...SERVER_FIELDS]),
  });

  // useWatch, not form.watch: a fresh function each render stops React Compiler memoising.
  const type = useWatch({ control: form.control, name: 'type' });
  const subjectId = useWatch({ control: form.control, name: 'subjectId' });
  const topicId = useWatch({ control: form.control, name: 'topicId' });
  const correctOption = useWatch({ control: form.control, name: 'correctOption' });
  const answerMode = useWatch({ control: form.control, name: 'answerMode' });
  const difficulty = useWatch({ control: form.control, name: 'difficulty' });
  const status = useWatch({ control: form.control, name: 'status' });
  const banner = bannerMessage(save.error, [...SERVER_FIELDS]);

  let title = 'New question';
  if (existing) title = isEditing ? 'Edit question' : 'Question';

  /** A new question has nowhere to fall back to, so Cancel leaves; an existing one returns to itself. */
  const cancel = () => {
    if (!existing) return navigate(ROUTES.QUESTIONS);
    form.reset();
    setIsEditing(false);
  };

  if (existing && question.isLoading) {
    // The form has a known shape, so it is drawn and held rather than spun at.
    return (
      <div className="flex flex-col gap-4">
        <Skeleton variant="title" />
        <SkeletonParagraph lines={6} />
      </div>
    );
  }

  return (
    <FormPanel
      disabled={!isEditing}
      onSubmit={form.handleSubmit((values) => save.mutate(values))}
      footer={
        isEditing ? (
          <>
            <Button type="button" variant="outline" onClick={cancel}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              {existing ? 'Save question' : 'Add question'}
            </Button>
          </>
        ) : undefined
      }
      header={
        <>
          <PageHeader
            breadcrumbs={<PageCrumbs nav={NAV_ITEMS} />}
            title={title}
            action={
              <HeaderActions
                isEditing={isEditing}
                isDraft={question.data?.status === QUESTION_STATUS.DRAFT}
                id={id}
                onEdit={() => setIsEditing(true)}
              />
            }
          />

          {banner ? (
            <Alert variant="danger" className="mb-4">
              {banner}
            </Alert>
          ) : null}
        </>
      }
    >
      <FormSection title="Where it is filed">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FormField form={form} name="subjectId" label="Subject">
            {(control) => (
              <SubjectPicker
                id={control.id}
                value={subjectId}
                placeholder="Choose a subject"
                onChange={(value) => {
                  form.setValue('subjectId', value, { shouldValidate: true });
                  // A topic under the old subject would file this wrongly.
                  form.setValue('topicId', '');
                }}
              />
            )}
          </FormField>

          <FormField form={form} name="topicId" label="Topic" hint="Optional">
            {(control) => (
              <TopicPicker
                id={control.id}
                subjectId={subjectId}
                value={topicId}
                clearable
                placeholder="Choose a topic"
                onChange={(value) => form.setValue('topicId', value)}
              />
            )}
          </FormField>

          <FormField form={form} name="type" label="Type">
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control['aria-describedby']}
                aria-invalid={control['aria-invalid']}
                clearable={false}
                value={type}
                onChange={(next) =>
                  form.setValue('type', next as QuestionFormValues['type'], { shouldDirty: true })
                }
                items={QUESTION_TYPES.map((value) => ({
                  value,
                  label: value === QUESTION_TYPE.SINGLE_MCQ ? 'Multiple choice' : 'Typed answer',
                }))}
              />
            )}
          </FormField>

          <FormField form={form} name="difficulty" label="Difficulty">
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control['aria-describedby']}
                aria-invalid={control['aria-invalid']}
                clearable={false}
                value={difficulty}
                onChange={(next) =>
                  form.setValue('difficulty', next as QuestionFormValues['difficulty'], {
                    shouldDirty: true,
                  })
                }
                items={DIFFICULTY_LEVELS.map((value) => ({ value, label: value }))}
              />
            )}
          </FormField>

          <FormField form={form} name="status" label="Status">
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control['aria-describedby']}
                aria-invalid={control['aria-invalid']}
                clearable={false}
                value={status}
                onChange={(next) =>
                  form.setValue('status', next as QuestionFormValues['status'], {
                    shouldDirty: true,
                  })
                }
                items={statusChoices(existing)}
              />
            )}
          </FormField>
        </div>
      </FormSection>

      <FormSection title="The question">
        <Tabs defaultValue={DEFAULT_LANGUAGE}>
          <TabsList>
            {LANGUAGE_ORDER.map((language) => (
              <TabsTrigger key={language} value={language}>
                {LANGUAGE_LABELS[language]}
                {language === DEFAULT_LANGUAGE ? ' *' : ''}
              </TabsTrigger>
            ))}
          </TabsList>

          {LANGUAGE_ORDER.map((language) => (
            <TabsContent key={language} value={language} className="flex flex-col gap-4">
              <LanguagePanel form={form} language={language} type={type} />
            </TabsContent>
          ))}
        </Tabs>

        {type === QUESTION_TYPE.SINGLE_MCQ ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField form={form} name="correctOption" label="Correct option">
              {(control) => (
                <Combobox
                  id={control.id}
                  aria-describedby={control['aria-describedby']}
                  aria-invalid={control['aria-invalid']}
                  clearable={false}
                  value={correctOption}
                  onChange={(value) => form.setValue('correctOption', value)}
                  items={Array.from({ length: MCQ_OPTION_COUNT }, (_, index) => ({
                    value: String(index + 1),
                    label: `Option ${index + 1}`,
                  }))}
                />
              )}
            </FormField>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField form={form} name="answerMode" label="How the answer is compared">
              {(control) => (
                <Combobox
                  id={control.id}
                  aria-describedby={control['aria-describedby']}
                  aria-invalid={control['aria-invalid']}
                  clearable={false}
                  value={answerMode ?? ANSWER_MODE.EXACT}
                  onChange={(next) =>
                    form.setValue('answerMode', next as QuestionFormValues['answerMode'], {
                      shouldDirty: true,
                    })
                  }
                  items={ANSWER_MODES.map((mode) => ({
                    value: mode,
                    label: mode === ANSWER_MODE.EXACT ? 'Exact text' : 'Numeric',
                  }))}
                />
              )}
            </FormField>

            {answerMode === ANSWER_MODE.NUMERIC ? (
              <FormField
                form={form}
                name="tolerance"
                label="Tolerance"
                hint="How far either side still counts"
              >
                {(control) => <Input {...control} inputMode="decimal" placeholder="0.01" />}
              </FormField>
            ) : null}
          </div>
        )}
      </FormSection>

      <FormSection title="Filing">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField form={form} name="questionCode" label="Question code" hint="Optional">
            {(control) => <Input {...control} placeholder="QA-001" />}
          </FormField>
          <FormField form={form} name="tags" label="Tags" hint="Separate with a comma">
            {(control) => <Input {...control} placeholder="ssc cgl, percentages" />}
          </FormField>
        </div>
      </FormSection>
    </FormPanel>
  );
}

/** Editing hides both: while the form is live, Save and Cancel are the only decisions on offer. */
function HeaderActions({
  isEditing,
  isDraft,
  id,
  onEdit,
}: Readonly<{ isEditing: boolean; isDraft: boolean; id?: string; onEdit: () => void }>) {
  if (isEditing) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isDraft && id ? <ApproveButton id={id} /> : null}
      <Button variant="outline" size="sm" onClick={onEdit}>
        <Pencil aria-hidden />
        Edit question
      </Button>
    </div>
  );
}

/** Reviewing here rather than only from the list: the reader who just read it is the one deciding. */
function ApproveButton({ id }: Readonly<{ id: string }>) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);

  const approve = useMutation({
    meta: { success: 'Question approved.' },
    mutationFn: () => api.admin.questions.setStatus(id, { status: QUESTION_STATUS.ACTIVE }),
    onSuccess: async () => {
      setAsking(false);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'question', id] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'questions'] });
    },
    onError: () => setAsking(false),
  });

  if (!can(FEATURE_KEYS.QUESTION_MANAGEMENT, PERMISSION_LEVELS.WRITE)) return null;

  return (
    <>
      <Button size="sm" onClick={() => setAsking(true)}>
        <Check aria-hidden />
        Approve
      </Button>

      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        loading={approve.isPending}
        title="Approve this question?"
        description="It goes into the bank as ACTIVE and can be drawn into any paper built from now on. Approving does not put it into a paper that already exists."
        confirmLabel="Approve it"
        onConfirm={() => approve.mutate()}
      />
    </>
  );
}

/** `useWatch` per field, so a keystroke in one language does not re-render the other three. */
function Rich({
  control,
  form,
  name,
  lang,
  singleLine,
}: Readonly<{
  control: FieldControl;
  form: UseFormReturn<QuestionFormValues>;
  name: Path<QuestionFormValues>;
  lang: QuestionLanguage;
  singleLine?: boolean;
}>) {
  const value = useWatch({ control: form.control, name }) as string | undefined;

  return (
    <RichText
      id={control.id}
      aria-describedby={control['aria-describedby']}
      aria-invalid={control['aria-invalid']}
      lang={lang}
      singleLine={singleLine}
      onUploadImage={(file) => api.admin.questions.uploadImage(file)}
      imageLimits={IMAGE_LIMITS}
      value={value ?? ''}
      onChange={(html) => form.setValue(name, html as never, { shouldDirty: true })}
    />
  );
}

function LanguagePanel({
  form,
  language,
  type,
}: Readonly<{
  form: UseFormReturn<QuestionFormValues>;
  language: QuestionLanguage;
  type: QuestionFormValues['type'];
}>) {
  const label = LANGUAGE_LABELS[language];

  return (
    <>
      <FormField form={form} name={`stem.${language}`} label={`Question text (${label})`}>
        {(control) => (
          <Rich control={control} form={form} name={`stem.${language}`} lang={language} />
        )}
      </FormField>

      {type === QUESTION_TYPE.SINGLE_MCQ ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: MCQ_OPTION_COUNT }, (_, index) => (
            <FormField
              key={index}
              form={form}
              name={`options.${index}.text.${language}`}
              label={`Option ${index + 1} (${label})`}
            >
              {(control) => (
                <Rich
                  control={control}
                  form={form}
                  name={`options.${index}.text.${language}`}
                  lang={language}
                  singleLine
                />
              )}
            </FormField>
          ))}
        </div>
      ) : (
        <FormField form={form} name={`answers.${language}`} label={`Answer (${label})`}>
          {(control) => (
            <Rich
              control={control}
              form={form}
              name={`answers.${language}`}
              lang={language}
              singleLine
            />
          )}
        </FormField>
      )}

      <FormField form={form} name={`solution.${language}`} label={`Explanation (${label})`}>
        {(control) => (
          <Rich control={control} form={form} name={`solution.${language}`} lang={language} />
        )}
      </FormField>
    </>
  );
}
