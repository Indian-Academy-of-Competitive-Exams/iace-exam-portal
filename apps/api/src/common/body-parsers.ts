import { json, urlencoded } from 'express';
import { type INestApplication } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';

/**
 * Path prefix the question importer will be mounted under. Requests here — and
 * only here — may carry a large body.
 *
 * TODO(importer): the import endpoints land under this prefix. Keep them here
 * rather than widening the limit elsewhere; the prefix IS the boundary between
 * "small JSON" and "a file's worth of rows".
 */
export const IMPORT_ROUTE_PREFIX = '/imports';

/**
 * Registers body parsing explicitly, with two limits rather than one.
 *
 * Everything the API normally exchanges is small: a login is a few hundred
 * bytes, a single question a few tens of KB (images are S3 URLs, never inline
 * base64). Raising the global limit to suit the importer would hand every
 * unauthenticated endpoint a cheap way to make the server allocate megabytes
 * per request — so the importer gets its own, larger limit, scoped to its path.
 *
 * ORDER MATTERS. body-parser marks a request as parsed and later parsers skip
 * it, so the import parser must be registered BEFORE the global one or the
 * global limit would reject the import body first. This is also why the app is
 * created with `bodyParser: false` — otherwise Nest installs its own parser at
 * startup, ahead of both of these, and neither limit would apply.
 */
export function registerBodyParsers(app: INestApplication): void {
  const config = app.get(AppConfigService);
  const importLimit = config.get('BODY_LIMIT_IMPORT');
  const defaultLimit = config.get('BODY_LIMIT_DEFAULT');

  app.use(IMPORT_ROUTE_PREFIX, json({ limit: importLimit }));

  app.use(json({ limit: defaultLimit }));
  app.use(urlencoded({ extended: true, limit: defaultLimit }));
}
