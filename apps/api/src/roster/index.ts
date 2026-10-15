/** How the roster is read, lent to every module that narrows or names students; owns no table and no provider. */
export { studentWhere, studentOrderBy, formerHoldersOf } from './student-query';
export { HOLDS_OWN_ACCESS } from './own-access';
export { type ProfileDocumentColumn } from './student-flags';
export { STUDENT_CARD_SELECT, studentCardsOf, type StudentCard } from './student-cards';
