/** The notifications module's public surface (docs/03 §4.1). */
export { NotificationsModule } from './notifications.module';
export { NotificationsService, type NewNotification } from './notifications.service';
export { NotificationOutbox, type NotificationIntent } from './notification-outbox';
export { NotificationPreferencesService } from './notification-preferences.service';
export { PushService } from './push.service';
