import { json, urlencoded } from 'express';
import { type INestApplication } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';

/**
 * Path prefix the question importer will be mounted under. Requests here — and only here — may
 * carry a large body.
 */
export const IMPORT_ROUTE_PREFIX = '/imports';

/** Registers body parsing explicitly, with two limits rather than one. */
export function registerBodyParsers(app: INestApplication): void {
  const config = app.get(AppConfigService);
  const importLimit = config.get('BODY_LIMIT_IMPORT');
  const defaultLimit = config.get('BODY_LIMIT_DEFAULT');

  app.use(IMPORT_ROUTE_PREFIX, json({ limit: importLimit }));

  app.use(json({ limit: defaultLimit }));
  app.use(urlencoded({ extended: true, limit: defaultLimit }));
}
