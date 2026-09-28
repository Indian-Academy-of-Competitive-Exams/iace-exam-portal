import { AppException, FORM_LEVEL_FIELD } from '@iace/contracts';

/** A refusal the form shows above its fields, since it is about the whole thing and not one of them. */
export const formRefusal = (
  code: ConstructorParameters<typeof AppException>[0],
  message: string,
): AppException =>
  new AppException(code, message, { fieldErrors: { [FORM_LEVEL_FIELD]: [message] } });
