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

/** How a student list narrows. Also how an announcement's cohort is chosen — one vocabulary. */
export { studentWhere } from './student-query';

/** DPDP: consent, the copy a student may take away, and erasure as anonymisation. */
export { StudentPrivacyService } from './student-privacy.service';
