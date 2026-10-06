/**
 * A test's whole paper, to print. It lives here because `attempts` is what shapes a paper for a
 * candidate, and it pays with TEST_MANAGEMENT — the key that opens the paper's own screen, not
 * REPORTS, since an unsat paper is the most sensitive thing the platform holds.
 */
import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  AUDIT_ACTION,
  AUDIT_FEATURE,
  ActorTypes,
  AppException,
  ErrorCodes,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  printablePaperQuerySchema,
  type PrintablePaper,
  type PrintablePaperQuery,
} from '@iace/contracts';
import { Audit, AuditContext } from '../audit';
import { Actors, CurrentUser, RequiresFeature, type AuthenticatedUser } from '../common/security';
import { ZodQuery } from '../common/zod-validation.pipe';
import { AttemptPaperService } from './attempt-paper.service';

@Controller('admin/tests')
@Actors(ActorTypes.ADMIN)
export class AdminPaperPrintController {
  constructor(
    private readonly papers: AttemptPaperService,
    private readonly auditContext: AuditContext,
  ) {}

  /** The paper leaves the building here, so the read is logged as an export of the test. */
  @RequiresFeature(FEATURE_KEYS.TEST_MANAGEMENT, PERMISSION_LEVELS.READ)
  @Audit(AUDIT_FEATURE.TEST, AUDIT_ACTION.EXPORT)
  @Get(':id/paper/print')
  async print(
    @Param('id') testId: string,
    @Query(new ZodQuery(printablePaperQuerySchema)) query: PrintablePaperQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PrintablePaper> {
    if (query.answerKey && !user.isSuperAdmin) {
      throw new AppException(ErrorCodes.FORBIDDEN, 'Only a super admin may print the answer key');
    }
    const paper = await this.papers.printable(testId, query);
    this.auditContext.setEntityId(testId);
    this.auditContext.setChanged({
      paper: { from: null, to: paper.questions.length },
      answerKey: { from: null, to: paper.answerKey !== null },
    });
    return paper;
  }
}
