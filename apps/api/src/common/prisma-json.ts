/**
 * A `Json` column read back as the contract shape it holds. Prisma hands these over as
 * `JsonValue`, so every reader is a cast, and a cast written at a call site is a cast nobody
 * checks — these are the only ones in the API.
 */
import { type Prisma } from '@prisma/client';
import { type AnswerKey, type QuestionOption, type TestScopeRef } from '@iace/contracts';

/** A `QuestionVersion`'s options. Anything that is not an array has none at all. */
export function optionsIn(stored: unknown): QuestionOption[] {
  return Array.isArray(stored) ? (stored as QuestionOption[]) : [];
}

/** A `QuestionVersion`'s answer key. An array or a scalar is not one, and reads as none. */
export function answerKeyIn(stored: unknown): AnswerKey | null {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return null;
  return stored as AnswerKey;
}

/** A `Test`'s scope reference: `Prisma.JsonNull` and a SQL NULL both read as none. */
export function scopeRefOf(row: { scopeRef: Prisma.JsonValue }): TestScopeRef | null {
  return (row.scopeRef as TestScopeRef | null) ?? null;
}
