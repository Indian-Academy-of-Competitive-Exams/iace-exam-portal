/**
 * The branches module's public surface (docs/03 §4.1).
 *
 * `branch-rules` stays private: they are the rules `BranchesService` applies,
 * and a caller that applies them itself is a second implementation of the same
 * policy waiting to drift.
 */
export { BranchesModule } from './branches.module';
export { BranchesService } from './branches.service';
