import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { firstValueFrom, map, of, timer } from 'rxjs';
import { AppException, ErrorCodes } from '@iace/contracts';
import { API_ROLES } from '../src/config/api-role';
import {
  REQUEST_BUDGET_MS,
  examBudgetMs,
  underBudget,
  withStatementTimeout,
} from '../src/common/request-budget';

describe('the statement timeout the exam role connects with', () => {
  it('opens a query string on a url that has none', () => {
    assert.equal(
      withStatementTimeout('postgresql://u:p@db:5432/iace', 6_000),
      'postgresql://u:p@db:5432/iace?options=-c%20statement_timeout%3D6000',
    );
  });

  it('joins the parameters a pooled url already carries', () => {
    assert.equal(
      withStatementTimeout('postgresql://db/iace?schema=public&connection_limit=25', 6_000),
      'postgresql://db/iace?schema=public&connection_limit=25&options=-c%20statement_timeout%3D6000',
    );
  });

  /** The failure this prevents: a second `options` is ignored, so ours would silently replace theirs. */
  it('leaves options an operator set themselves alone', () => {
    const chosen = 'postgresql://db/iace?options=-c%20statement_timeout%3D30000';
    assert.equal(withStatementTimeout(chosen), chosen);
  });
});

describe('the budget a role runs under', () => {
  it('is the exam budget on the exam role', () => {
    assert.equal(examBudgetMs(API_ROLES.EXAM), REQUEST_BUDGET_MS);
  });

  /** ALL is every role at once, and the scoring sweeps it also runs take minutes on purpose. */
  it('is none under all, core or worker', () => {
    for (const role of [API_ROLES.ALL, API_ROLES.CORE, API_ROLES.WORKER]) {
      assert.equal(examBudgetMs(role), 0);
    }
  });
});

describe('a request that outstays its budget', () => {
  it('is refused as SERVICE_UNAVAILABLE, which the paper knows to send again', async () => {
    let refusals = 0;
    const slow = timer(200).pipe(map(() => 'answered'));

    const thrown: unknown = await firstValueFrom(
      underBudget(slow, 10, () => {
        refusals += 1;
      }),
    ).catch((error: unknown) => error);

    assert.ok(AppException.is(thrown));
    assert.equal(thrown.code, ErrorCodes.SERVICE_UNAVAILABLE);
    assert.equal(thrown.httpStatus, 503);
    assert.equal(refusals, 1);
  });

  it('lets an answer inside the budget through untouched', async () => {
    assert.equal(await firstValueFrom(underBudget(of('answered'), 1_000, fail)), 'answered');
  });

  it('is never refused where the role carries no budget', async () => {
    const slow = timer(20).pipe(map(() => 'answered'));
    assert.equal(await firstValueFrom(underBudget(slow, 0, fail)), 'answered');
  });
});

function fail(): never {
  throw new Error('refused a request that was inside its budget');
}
