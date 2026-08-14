/**
 * The admins module's public surface (docs/03 §4.1).
 *
 * `AdminsService` is the whole surface. Auth uses exactly one method on it,
 * `permissionsFor`, to build the map a token carries — which is a read of
 * another module's tables going through its facade rather than around it.
 */
export { AdminsModule } from './admins.module';
export { AdminsService } from './admins.service';
