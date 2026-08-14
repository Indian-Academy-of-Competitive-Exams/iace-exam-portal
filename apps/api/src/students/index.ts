/**
 * The students module's public surface (docs/03 §4.1).
 *
 * The flag helpers are here on purpose: `preTestReady` and `profileCompleted`
 * are STORED columns, so anything that writes a profile has to recompute them
 * with the same rule, and this module is where that rule is published. The
 * query builders in `student-query` are not — they are how the list endpoint is
 * implemented, and nobody outside needs them.
 */
export { StudentsModule } from './students.module';
export { StudentsService } from './students.service';
export {
  isPreTestReady,
  isProfileCompleted,
  type PreTestFields,
  type ProfileCompletionFields,
  type ProfileDocumentColumn,
} from './student-flags';
