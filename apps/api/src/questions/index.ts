/**
 * The question bank's public surface (docs/03 §4.1). `question-core`,
 * `question-import` and the workbook builder stay private: they are the rules
 * this module exists to own, and a sibling reaching them would be a second
 * definition of what a valid question is.
 */
export { QuestionsModule } from './questions.module';
export { QuestionsService } from './questions.service';
export { TaxonomyService } from './taxonomy.service';
