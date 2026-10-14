import { Prisma } from '@prisma/client';
import {
  ASSIGNMENT_ROLES,
  AppException,
  ErrorCodes,
  PAPER_SOURCES,
  REVIEW_STATES,
  SECTION_SEATS,
  type AdminAuthority,
  type Assignment,
  type AssignmentRole,
  type DifficultyLevel,
  type PaperSource,
  type QuestionDraft,
  type QuestionReview,
  type QuestionTime,
  type SectionSeat,
  SECTION_QUESTION_TYPES,
  sectionAnswerKindOf,
  type SectionAnswerKind,
  type LanguageCode,
} from '@iace/contracts';

/** Who is asking: the controller knows their grants, this service knows the section. */
export interface SectionViewer extends AdminAuthority {
  id: string;
}

export interface Pair {
  testId: string;
  baseConfigSectionId: string;
}

/** Everything a rule about the section turns on, read once per request. */
export interface Context {
  pair: Pair;
  viewer: SectionViewer;
  test: {
    title: string | null;
    paperSource: PaperSource;
    finalizedAt: Date | null;
    baseConfig: { languages: LanguageCode[] };
  };
  section: {
    name: string;
    questionCount: number;
    subjectId: string | null;
    typingPreset: string | null;
    descriptive: boolean;
    languages: LanguageCode[];
  };
  rows: Assignment[];
  typist: Assignment | null;
  reader: Assignment | null;
  /** The viewer's own row: the one they hold now, else the last they held. */
  mine: Assignment | null;
  seat: SectionSeat;
  ownerWrites: boolean;
}

export interface ScopedQuestion {
  id: string;
  order: number | null;
  typed: boolean;
  createdById: string | null;
  difficulty: DifficultyLevel;
  preview: string;
  review: QuestionReview;
}

export const NOT_YOURS = 'No such section';
export const OFFERED_MESSAGE =
  'This test has been offered, so its questions no longer change here.';
export const NOT_EDITABLE_MESSAGE =
  'This question is not yours to change at this point in the section.';
export const NOT_DELETABLE_MESSAGE =
  'Only a question you typed for this section, and may still change, can be deleted.';
export const READERS_ONLY_MESSAGE = "Only this section's proof-reader reviews its questions.";
export const NOT_HANDED_MESSAGE = 'This section has not reached you yet.';
export const RELEASED_MESSAGE = 'You have released this section, so its review is closed.';
export const WITH_TYPIST_MESSAGE = 'This question is with the typist until they mark it fixed.';
export const NO_TYPIST_MESSAGE = 'This section has no typist to send a question back to.';
export const NOT_SENT_BACK_MESSAGE = 'This question was not sent back to you.';
export const TYPISTS_ONLY_MESSAGE = "Only this section's typist marks a question fixed.";
const WRONG_KIND_MESSAGES: Readonly<Record<SectionAnswerKind, string>> = {
  CHOICE: 'A typing passage or a descriptive question belongs in a section of its own kind.',
  TYPING: 'This section is a typing test, so it takes a typing passage.',
  WRITING: 'This section is descriptive, so it takes a descriptive question.',
};
const TYPING_ONLY_MESSAGE = "Only this section's typist does that.";
const NO_LONGER_TYPING_MESSAGE =
  'This section is no longer yours, so nothing new is typed into it.';
const NOTHING_TO_TYPE_MESSAGE =
  'This test is picked from the bank, so its sections are not typed. Fix what is sent back to you.';
export const SEATS_ONLY_MESSAGE =
  "Only this section's typist or proof-reader has time counted on it.";
const SECTION_HANDED_OVER_MESSAGE =
  'You have marked this section done. New questions go to the bank, not this paper.';

const UNCHECKED_REVIEW: QuestionReview = {
  state: REVIEW_STATES.UNCHECKED,
  reason: null,
  note: null,
  sentBackAt: null,
  fixedAt: null,
  checkedAt: null,
};

type ReviewRow = Prisma.QuestionReviewGetPayload<object>;

export const isOpenSendBack = (row: ReviewRow | null | undefined): boolean =>
  Boolean(row?.sentBackAt && !row.fixedAt);

export function reviewOf(row: ReviewRow | undefined): QuestionReview {
  if (!row) return UNCHECKED_REVIEW;
  let state: QuestionReview['state'] = REVIEW_STATES.UNCHECKED;
  if (isOpenSendBack(row)) state = REVIEW_STATES.SENT_BACK;
  else if (row.checkedAt) state = REVIEW_STATES.CHECKED;
  else if (row.fixedAt) state = REVIEW_STATES.FIXED;
  return {
    state,
    reason: row.reason,
    note: row.note,
    sentBackAt: row.sentBackAt?.toISOString() ?? null,
    fixedAt: row.fixedAt?.toISOString() ?? null,
    checkedAt: row.checkedAt?.toISOString() ?? null,
  };
}

/** A section is answered, typed or written, and a typist writes only the kind its paper can draw. */
export function assertTypeFits(section: Context['section'], draft: QuestionDraft): void {
  const kind = sectionAnswerKindOf(section);
  if (SECTION_QUESTION_TYPES[kind].includes(draft.type)) return;
  const message = WRONG_KIND_MESSAGES[kind];
  throw new AppException(ErrorCodes.VALIDATION_ERROR, message, {
    fieldErrors: { type: [message] },
  });
}

/** The rule each seat works under; a test owner's is the section being back with them. */
export function editable(context: Context, question: ScopedQuestion): boolean {
  if (context.test.finalizedAt) return context.viewer.isSuperAdmin;
  if (context.viewer.isSuperAdmin) return true;

  const own = typingOrHeld(context);
  const sentBack = question.review.state === REVIEW_STATES.SENT_BACK;
  if (own?.role === ASSIGNMENT_ROLES.TYPIST) {
    if (sentBack) return true;
    const typing = context.test.paperSource === PAPER_SOURCES.FRAMED && !own.finalizedAt;
    if (typing && question.typed) return true;
  }
  if (own?.role === ASSIGNMENT_ROLES.PROOFREADER) {
    if (own.handedAt && !own.finalizedAt && question.order !== null && !sentBack) return true;
  }
  return context.ownerWrites && withOwner(context);
}

/** A draft typed here by the viewer, off the paper, that they may still change; a paper row is never deleted. */
export function deletable(context: Context, question: ScopedQuestion): boolean {
  const { viewer } = context;
  const own = viewer.isSuperAdmin || question.createdById === viewer.id;
  return question.typed && question.order === null && own && editable(context, question);
}

export const reviewRow = (tx: Prisma.TransactionClient, testId: string, questionId: string) =>
  tx.questionReview.findUnique({ where: { testId_questionId: { testId, questionId } } });

/** The owner's seat and a super admin read every seat's time; a typist and a reader read their own. */
export const seesEverySeat = (context: Context): boolean =>
  context.seat === SECTION_SEATS.OWNER || context.viewer.isSuperAdmin === true;

export const noTime = (everySeat: boolean): QuestionTime => ({
  own: 0,
  typist: everySeat ? 0 : null,
  reader: everySeat ? 0 : null,
});

/** For a super admin whoever holds the role now, a seat they once left included; else the viewer's own row in it. */
export function actingAs(context: Context, role: AssignmentRole): Assignment {
  const holder = role === ASSIGNMENT_ROLES.TYPIST ? context.typist : context.reader;
  if (holder && context.viewer.isSuperAdmin) return holder;
  if (context.mine?.role === role) return context.mine;
  const only = role === ASSIGNMENT_ROLES.TYPIST ? TYPING_ONLY_MESSAGE : READERS_ONLY_MESSAGE;
  throw new AppException(ErrorCodes.FORBIDDEN, only);
}

/** A typing job still open: held, on a typed paper not yet offered, and not yet done. */
export function typingRow(context: Context): Assignment {
  const row = actingAs(context, ASSIGNMENT_ROLES.TYPIST);
  if (row.replacedAt) throw new AppException(ErrorCodes.FORBIDDEN, NO_LONGER_TYPING_MESSAGE);
  if (context.test.paperSource !== PAPER_SOURCES.FRAMED) {
    throw new AppException(ErrorCodes.CONFLICT, NOTHING_TO_TYPE_MESSAGE);
  }
  if (context.test.finalizedAt) throw new AppException(ErrorCodes.CONFLICT, OFFERED_MESSAGE);
  if (row.finalizedAt) throw new AppException(ErrorCodes.CONFLICT, SECTION_HANDED_OVER_MESSAGE);
  return row;
}

/** The row the viewer holds right now; a replaced one only reads. */
export const heldNow = (context: Context): Assignment | null =>
  context.mine?.replacedAt === null ? context.mine : null;

/** The row held now, or the section's last typist row when nobody took the seat after it: those drafts are nobody else's. */
function typingOrHeld(context: Context): Assignment | null {
  const held = heldNow(context);
  if (held || context.typist) return held;
  const last = context.rows.findLast((row) => row.role === ASSIGNMENT_ROLES.TYPIST);
  return last && last.id === context.mine?.id ? last : null;
}

/** Picked and not yet handed on, or released by its reader: then the section is back with its owner. */
function withOwner(context: Context): boolean {
  const { reader } = context;
  if (reader?.finalizedAt) return true;
  return context.test.paperSource === PAPER_SOURCES.PICKED && !reader?.handedAt;
}
