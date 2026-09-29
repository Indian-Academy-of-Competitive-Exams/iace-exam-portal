/** The assignments module's public surface (docs/03 §4.1). */
export { AssignmentsModule } from './assignments.module';
export { AssignmentsService } from './assignments.service';
export { doneOpen } from './assignment-gates';
/** What a reader has not checked — the offer gate and the paper's writes in `tests` turn on it. */
export { reopenReadingIfUnchecked, uncheckReworded, uncheckedOn } from './unread-questions';
