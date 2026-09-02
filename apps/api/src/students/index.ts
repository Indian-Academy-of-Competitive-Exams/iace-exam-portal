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

/** DPDP: consent, the copy a student may take away, and erasure as anonymisation. */
export { StudentPrivacyService } from './student-privacy.service';
