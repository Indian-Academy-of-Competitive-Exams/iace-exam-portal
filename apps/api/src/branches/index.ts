/** The branches module's public surface (docs/03 §4.1). */
export { BranchesModule } from './branches.module';
export { BranchesService } from './branches.service';
// Public because the importer applies the same pairing rule without a service or a database.
export { studentBranchBlocker } from './branch-rules';
