import { shrunkForUpload } from '@iace/app-kit/browser';
import { type QuestionImage } from '@iace/contracts';
import { api } from './api';

/** Every image an admin picks goes through here: the bank, the authoring editor and a section thread. */
export const uploadQuestionImage = async (file: File): Promise<QuestionImage> =>
  api.admin.questions.uploadImage(await shrunkForUpload(file));
