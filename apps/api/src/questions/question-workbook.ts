import ExcelJS from 'exceljs';
import {
  ANSWER_MODES,
  DIFFICULTY_LEVELS,
  LANGUAGE_LABELS,
  LANGUAGE_ORDER,
  MCQ_OPTION_COUNT,
  QUESTION_IMPORT_COLUMNS,
  QUESTION_IMPORT_SHEETS,
  QUESTION_TYPES,
  TAG_SEPARATOR,
  type QuestionImportColumnKey,
} from '@iace/contracts';
import { type TaxonomyCatalog } from './taxonomy-context';

/**
 * The template an admin fills in. Generated from `QUESTION_IMPORT_COLUMNS`, so
 * it cannot document a format the parser will not accept, and from the LIVE
 * taxonomy, so its dropdowns offer the subjects the bank actually holds.
 *
 * The three taxonomy columns cascade: topic offers the topics of the subject on
 * that row, sub-topic the sub-topics of that topic. Excel does this with a named
 * range per list and INDIRECT() over the cell beside it — there is no other way
 * to make one dropdown depend on another in a plain .xlsx.
 */

/** Rows the dropdowns are wired for. Beyond this a row still imports, unvalidated. */
const VALIDATED_ROWS = 300;

/** Excel names may not hold a space or start with a digit, so every one is prefixed. */
const TOPIC_RANGE_PREFIX = 'T_';
const SUB_TOPIC_RANGE_PREFIX = 'U_';
const SUBJECTS_RANGE = 'SUBJECTS';
const TYPES_RANGE = 'QTYPES';
const DIFFICULTIES_RANGE = 'DIFFICULTIES';
const ANSWER_MODES_RANGE = 'ANSWERMODES';
const CORRECT_OPTIONS_RANGE = 'CORRECTOPTIONS';

const HEADER_FILL = 'FFF3F4F6';
const REQUIRED_FILL = 'FFFDE8E8';

export async function buildQuestionTemplate(catalog: TaxonomyCatalog): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'IACE';

  const sheet = workbook.addWorksheet(QUESTION_IMPORT_SHEETS.QUESTIONS);
  const instructions = workbook.addWorksheet(QUESTION_IMPORT_SHEETS.INSTRUCTIONS);
  const lists = workbook.addWorksheet(QUESTION_IMPORT_SHEETS.LISTS);

  writeHeader(sheet);
  writeExamples(sheet, catalog);
  writeLists(workbook, lists, catalog);
  writeValidations(sheet, catalog);
  writeInstructions(instructions);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function writeHeader(sheet: ExcelJS.Worksheet): void {
  sheet.columns = QUESTION_IMPORT_COLUMNS.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width,
  }));

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.eachCell((cell, columnNumber) => {
    const column = QUESTION_IMPORT_COLUMNS[columnNumber - 1];
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: column?.required ? REQUIRED_FILL : HEADER_FILL },
    };
  });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

/** Two rows an admin can read the format off, using taxonomy that really exists. */
function writeExamples(sheet: ExcelJS.Worksheet, catalog: TaxonomyCatalog): void {
  const first = catalog.subjects[0];
  const topic = first?.topics[0];
  const subTopic = topic?.subTopics[0];

  const mcq: Partial<Record<QuestionImportColumnKey, string | number>> = {
    type: 'SINGLE_MCQ',
    subject: first?.name ?? 'QUANTITATIVE APTITUDE',
    topic: topic?.name ?? 'ARITHMETIC',
    subtopic: subTopic?.name ?? 'PERCENTAGES',
    difficulty: 'MEDIUM',
    stem_en: 'What is 20% of 150?',
    stem_hi: '150 का 20% कितना है?',
    stem_te: '150లో 20% ఎంత?',
    option1_en: '25',
    option2_en: '30',
    option3_en: '35',
    option4_en: '40',
    option1_hi: '25',
    option2_hi: '30',
    option3_hi: '35',
    option4_hi: '40',
    correct_option: 2,
    solution_en: '20% of 150 = 150 × 0.2 = 30.',
    marks: 2,
    negative_marks: 0.5,
    tags: `ssc cgl${TAG_SEPARATOR} percentages`,
  };

  const typed: Partial<Record<QuestionImportColumnKey, string | number>> = {
    type: 'TEXT_FIELD',
    subject: first?.name ?? 'QUANTITATIVE APTITUDE',
    topic: topic?.name ?? 'ARITHMETIC',
    difficulty: 'LOW',
    stem_en: 'Write the value of pi correct to two decimal places.',
    answer_mode: 'NUMERIC',
    answer_en: '3.14',
    answer_tolerance: 0.01,
    marks: 1,
  };

  for (const example of [mcq, typed]) {
    sheet.addRow(
      QUESTION_IMPORT_COLUMNS.map((column) => example[column.key as QuestionImportColumnKey] ?? ''),
    );
  }
}

/**
 * Every list a dropdown reads, each as a named range. One range per subject
 * holds its topics; one per subject+topic holds that topic's sub-topics — keyed
 * by BOTH names because a topic name repeats across subjects and a name that
 * collides would silently offer the wrong subject's sub-topics.
 */
function writeLists(
  workbook: ExcelJS.Workbook,
  lists: ExcelJS.Worksheet,
  catalog: TaxonomyCatalog,
): void {
  let column = 1;

  const addList = (title: string, values: readonly (string | number)[], rangeName: string) => {
    const letter = columnLetter(column);
    lists.getColumn(column).width = Math.max(title.length + 2, 24);
    lists.getCell(`${letter}1`).value = title;
    lists.getCell(`${letter}1`).font = { bold: true };

    values.forEach((value, index) => {
      lists.getCell(`${letter}${index + 2}`).value = value;
    });

    if (values.length > 0) {
      workbook.definedNames.add(
        `${QUESTION_IMPORT_SHEETS.LISTS}!$${letter}$2:$${letter}$${values.length + 1}`,
        rangeName,
      );
    }
    column += 1;
  };

  addList(
    'Subjects',
    catalog.subjects.map((subject) => subject.name),
    SUBJECTS_RANGE,
  );
  addList('Types', QUESTION_TYPES, TYPES_RANGE);
  addList('Difficulty', DIFFICULTY_LEVELS, DIFFICULTIES_RANGE);
  addList('Answer mode', ANSWER_MODES, ANSWER_MODES_RANGE);
  addList(
    'Correct option',
    Array.from({ length: MCQ_OPTION_COUNT }, (_, index) => index + 1),
    CORRECT_OPTIONS_RANGE,
  );

  for (const subject of catalog.subjects) {
    addList(
      `${subject.name} — topics`,
      subject.topics.map((topic) => topic.name),
      topicRangeName(subject.name),
    );

    for (const topic of subject.topics) {
      if (topic.subTopics.length === 0) continue;
      addList(
        `${topic.name} — sub-topics`,
        topic.subTopics.map((subTopic) => subTopic.name),
        subTopicRangeName(subject.name, topic.name),
      );
    }
  }
}

const rangeToken = (name: string) => name.replace(/\s+/g, '_');

const topicRangeName = (subject: string) => `${TOPIC_RANGE_PREFIX}${rangeToken(subject)}`;

const subTopicRangeName = (subject: string, topic: string) =>
  `${SUB_TOPIC_RANGE_PREFIX}${rangeToken(subject)}_${rangeToken(topic)}`;

/**
 * The cascade. INDIRECT builds the range NAME from the cells beside it, so the
 * topic list follows the subject on that row and the sub-topic list follows both.
 * A row whose subject is not in the bank simply offers nothing, which is the
 * right answer — the importer reports it by name either way.
 */
function writeValidations(sheet: ExcelJS.Worksheet, catalog: TaxonomyCatalog): void {
  const subject = columnLetterOf('subject');
  const topic = columnLetterOf('topic');

  const listOf = (formula: string) => ({
    type: 'list' as const,
    allowBlank: true,
    formulae: [formula],
  });

  for (let row = 2; row <= VALIDATED_ROWS + 1; row += 1) {
    sheet.getCell(`${columnLetterOf('type')}${row}`).dataValidation = listOf(`=${TYPES_RANGE}`);
    sheet.getCell(`${columnLetterOf('difficulty')}${row}`).dataValidation = listOf(
      `=${DIFFICULTIES_RANGE}`,
    );
    sheet.getCell(`${columnLetterOf('correct_option')}${row}`).dataValidation = listOf(
      `=${CORRECT_OPTIONS_RANGE}`,
    );
    sheet.getCell(`${columnLetterOf('answer_mode')}${row}`).dataValidation = listOf(
      `=${ANSWER_MODES_RANGE}`,
    );

    if (catalog.subjects.length === 0) continue;

    sheet.getCell(`${subject}${row}`).dataValidation = listOf(`=${SUBJECTS_RANGE}`);
    sheet.getCell(`${topic}${row}`).dataValidation = listOf(
      `=INDIRECT("${TOPIC_RANGE_PREFIX}"&SUBSTITUTE($${subject}$${row}," ","_"))`,
    );
    sheet.getCell(`${columnLetterOf('subtopic')}${row}`).dataValidation = listOf(
      `=INDIRECT("${SUB_TOPIC_RANGE_PREFIX}"&SUBSTITUTE($${subject}$${row}," ","_")&"_"&SUBSTITUTE($${topic}$${row}," ","_"))`,
    );
  }
}

function writeInstructions(sheet: ExcelJS.Worksheet): void {
  sheet.getColumn(1).width = 104;
  for (const line of INSTRUCTIONS) sheet.addRow([line]);
  sheet.getRow(1).font = { bold: true };
}

const LANGUAGE_LIST = LANGUAGE_ORDER.map(
  (language) => `${LANGUAGE_LABELS[language]} (_${language})`,
).join(', ');

const INSTRUCTIONS = [
  'How to fill this in',
  '',
  'One row is one question. Fill in the Questions tab; the Lists tab is what the',
  'dropdowns read, so leave it alone.',
  '',
  `Languages — ${LANGUAGE_LIST}.`,
  'English is required on every question. Hindi and Telugu are optional, but a',
  'question written in one of them needs BOTH its question text and all of its',
  'options in that language: a half-translated paper cannot be sat in it.',
  'Type or paste the script straight into the cell.',
  '',
  'subject / topic / subtopic — pick from the dropdowns. They cascade: the topics',
  'offered are the ones under the subject on that row, and the sub-topics the ones',
  'under that topic. Nothing is created by an import — a name that matches nothing',
  'in the bank is reported against its line.',
  '',
  `SINGLE_MCQ — fill option1..option${MCQ_OPTION_COUNT} and correct_option (1 to ${MCQ_OPTION_COUNT}).`,
  'TEXT_FIELD — leave the options empty and fill answer_mode and answer_en.',
  '  EXACT compares the text, ignoring case and spacing.',
  '  NUMERIC compares the number, and answer_tolerance is how far either side',
  '  still counts (0.01 accepts 3.13 to 3.15 for an answer of 3.14).',
  '',
  `tags — separate several with "${TAG_SEPARATOR}". question_code is your own reference and`,
  'must be unique across the bank; leave it blank if you do not use one.',
  '',
  'marks / negative_marks — numbers, at most two decimal places. Blank means the',
  'test decides.',
  '',
  'Nothing is written until you press Import. The preview shows what would happen',
  'to every row: rows with problems are listed with the reason and skipped, and a',
  'question already in the bank is skipped as a duplicate rather than reported as',
  'an error — re-uploading a sheet with new questions on the end is normal.',
];

const ALPHABET_SIZE = 26;
const CHAR_CODE_A = 65;

/** 1 -> A, 27 -> AA. Excel's own column naming, which exceljs does not expose. */
function columnLetter(index: number): string {
  let remaining = index;
  let letters = '';
  while (remaining > 0) {
    const position = (remaining - 1) % ALPHABET_SIZE;
    letters = String.fromCodePoint(CHAR_CODE_A + position) + letters;
    remaining = Math.floor((remaining - position - 1) / ALPHABET_SIZE);
  }
  return letters;
}

function columnLetterOf(key: QuestionImportColumnKey): string {
  const index = QUESTION_IMPORT_COLUMNS.findIndex((column) => column.key === key);
  return columnLetter(index + 1);
}

export { columnLetter, subTopicRangeName, topicRangeName };
