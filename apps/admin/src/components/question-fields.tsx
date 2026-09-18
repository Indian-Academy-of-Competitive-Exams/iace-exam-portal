import { useWatch, type Path, type UseFormReturn } from 'react-hook-form';
import {
  ANSWER_MODE,
  ANSWER_MODES,
  DEFAULT_LANGUAGE,
  DIFFICULTY_LEVELS,
  LANGUAGE_LABELS,
  LANGUAGE_ORDER,
  QUESTION_INTAKE_HINTS,
  QUESTION_INTAKE_STATUSES,
  QUESTION_STATUS,
  QUESTION_TYPE,
  QUESTION_TYPES,
  type QuestionDetail,
  type QuestionLanguage,
  QUESTION_IMAGE_ACCEPTED_TYPES,
  QUESTION_IMAGE_MAX_BYTES,
} from '@iace/contracts';
import {
  FormCombobox,
  Alert,
  FormField,
  FormSection,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  type FieldControl,
} from '@iace/ui';
import { RichText } from '@iace/ui/rich-text';
import { api } from '../lib/api';
import { ANSWER_MODE_LABELS, QUESTION_TYPE_LABELS } from '../lib/constants';
import { SubjectPicker, TopicPicker } from './taxonomy-picker';
import type { QuestionFormValues } from './question-draft';

/** The boxes one question is typed into: the bank's own screen, and the proof-reader's edit dialog. */

/** From the contract, so the picker offers exactly what checkQuestionImage will accept. */
const IMAGE_LIMITS = {
  accept: QUESTION_IMAGE_ACCEPTED_TYPES,
  maxBytes: QUESTION_IMAGE_MAX_BYTES,
} as const;

/** ARCHIVED is a retirement, so it is only on offer once there is something to retire. */
function statusChoices(saved: QuestionDetail | undefined) {
  const intake = QUESTION_INTAKE_STATUSES.map((value) => ({
    value,
    label: value,
    hint: QUESTION_INTAKE_HINTS[value],
  }));
  // A draft has nothing to retire, so ARCHIVED appears once the question is in circulation.
  if (!saved || saved.status === QUESTION_STATUS.DRAFT) return intake;

  return [...intake, { value: QUESTION_STATUS.ARCHIVED, label: QUESTION_STATUS.ARCHIVED }];
}

export function QuestionFields({
  form,
  saved,
  filing = true,
}: Readonly<{
  form: UseFormReturn<QuestionFormValues>;
  saved?: QuestionDetail;
  /** Off where the caller has no authority to file: a proof-reader fixes a question, never promotes it. */
  filing?: boolean;
}>) {
  // useWatch, not form.watch: a fresh function each render stops React Compiler memoising.
  const type = useWatch({ control: form.control, name: 'type' });
  const subjectId = useWatch({ control: form.control, name: 'subjectId' });
  // Being drawn settles taxonomy, not being published: a drawn draft would move under its section.
  const taxonomySettled = saved?.inUse === true;
  const topicId = useWatch({ control: form.control, name: 'topicId' });
  // However many it has: a form that always drew four would drop a fifth on the next save.
  const optionCount = useWatch({ control: form.control, name: 'options' }).length;
  const answerMode = useWatch({ control: form.control, name: 'answerMode' });

  return (
    <>
      {/* Being drawn settles taxonomy: a paper records no subject, so a move would misfile it. */}
      <FormSection title="Subject and topic">
        {taxonomySettled ? (
          <Alert variant="info">
            A paper or a result already uses this question, so its subject and topic stay as they
            are. Take it off every paper to move it.
          </Alert>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FormField form={form} name="subjectId" label="Subject">
            {(control) => (
              <SubjectPicker
                id={control.id}
                value={subjectId}
                disabled={taxonomySettled}
                placeholder="Choose a subject"
                onChange={(value) => {
                  form.setValue('subjectId', value, { shouldValidate: true });
                  // A topic under the old subject would file this wrongly.
                  form.setValue('topicId', '');
                }}
              />
            )}
          </FormField>

          <FormField
            form={form}
            name="topicId"
            label="Topic"
            /* ui-copy-ok: rule */
            hint="Optional"
          >
            {(control) => (
              <TopicPicker
                id={control.id}
                subjectId={subjectId}
                value={topicId}
                disabled={taxonomySettled}
                clearable
                placeholder="Choose a topic"
                onChange={(value) => form.setValue('topicId', value)}
              />
            )}
          </FormField>

          <FormCombobox
            form={form}
            name="type"
            label="Type"
            items={QUESTION_TYPES.map((value) => ({ value, label: QUESTION_TYPE_LABELS[value] }))}
          />

          <FormCombobox
            form={form}
            name="difficulty"
            label="Difficulty"
            items={DIFFICULTY_LEVELS.map((value) => ({ value, label: value }))}
          />

          {filing ? (
            <FormCombobox form={form} name="status" label="Status" items={statusChoices(saved)} />
          ) : null}
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
              <LanguagePanel form={form} language={language} type={type} options={optionCount} />
            </TabsContent>
          ))}
        </Tabs>

        {type === QUESTION_TYPE.SINGLE_MCQ ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormCombobox
              form={form}
              name="correctOption"
              label="Correct option"
              items={Array.from({ length: optionCount }, (_, index) => ({
                value: String(index + 1),
                label: `Option ${index + 1}`,
              }))}
            />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormCombobox
              form={form}
              name="answerMode"
              label="How the answer is compared"
              items={ANSWER_MODES.map((mode) => ({ value: mode, label: ANSWER_MODE_LABELS[mode] }))}
            />

            {answerMode === ANSWER_MODE.NUMERIC ? (
              <FormField
                form={form}
                name="tolerance"
                label="Tolerance"
                /* ui-copy-ok: rule */
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
          <FormField
            form={form}
            name="questionCode"
            label="Question code"
            /* ui-copy-ok: rule */
            hint="Optional"
          >
            {(control) => <Input {...control} placeholder="QA-001" />}
          </FormField>
          <FormField
            form={form}
            name="tags"
            label="Tags"
            /* ui-copy-ok: format */
            hint="Separate with a comma"
          >
            {(control) => <Input {...control} placeholder="ssc cgl, percentages" />}
          </FormField>
        </div>
      </FormSection>
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
  options,
}: Readonly<{
  form: UseFormReturn<QuestionFormValues>;
  language: QuestionLanguage;
  type: QuestionFormValues['type'];
  options: number;
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
          {Array.from({ length: options }, (_, index) => (
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
