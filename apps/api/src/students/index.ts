/** The students module's public surface (docs/03 §4.1). */
export { StudentsModule } from './students.module';
export { StudentsService } from './students.service';
export {
  isPreTestReady,
  isProfileCompleted,
  type PreTestFields,
  type ProfileCompletionFields,
  type ProfileDocumentColumn,
} from './student-flags';
