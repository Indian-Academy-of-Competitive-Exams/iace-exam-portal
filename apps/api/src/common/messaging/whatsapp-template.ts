/**
 * What a WhatsApp template message IS, independent of who delivers it. Meta's
 * Cloud API and Interakt both take a registered template name, a language and
 * ordered variables, and differ only in how they spell them — so the shape
 * lives here once and each provider marshals it.
 */
import { type AppConfigService } from '../../config/app-config.service';
import { MESSAGE_KINDS, REQUIRED_KINDS, type MessageKind } from './message-sender';

/** Which env var carries each kind's registered template. Adding a kind is adding a line to both. */
const TEMPLATE_KEYS = {
  [MESSAGE_KINDS.OTP]: 'WHATSAPP_TEMPLATE_OTP',
  [MESSAGE_KINDS.PIN]: 'WHATSAPP_TEMPLATE_PIN',
  [MESSAGE_KINDS.RESULT_READY]: 'WHATSAPP_TEMPLATE_RESULT_READY',
  [MESSAGE_KINDS.TEST_ASSIGNED]: 'WHATSAPP_TEMPLATE_TEST_ASSIGNED',
  [MESSAGE_KINDS.TEST_REMINDER]: 'WHATSAPP_TEMPLATE_TEST_REMINDER',
} as const satisfies Record<MessageKind, string>;

/** Template variables are POSITIONAL, so this order IS the registered template's order. */
const TEMPLATE_VARIABLES = {
  [MESSAGE_KINDS.OTP]: ['code'],
  [MESSAGE_KINDS.PIN]: ['pin'],
  [MESSAGE_KINDS.RESULT_READY]: ['testId'],
  [MESSAGE_KINDS.TEST_ASSIGNED]: ['testId'],
  [MESSAGE_KINDS.TEST_REMINDER]: ['testId'],
} as const satisfies Record<MessageKind, readonly string[]>;

/** Meta's authentication category mandates a button, and it repeats the code the body already carries. */
const AUTHENTICATION_KINDS = new Set<MessageKind>([MESSAGE_KINDS.OTP]);

const MOBILE_DIGITS = 10;

/** The institute is one country, so the dialling code is a fact rather than a setting. */
export const INDIA_DIALLING_CODE = '91';

export interface WhatsAppTemplate {
  name: string;
  language: string;
  values: string[];
  hasOtpButton: boolean;
}

/** Throws for a kind nobody gets in without; undefined for one that is simply switched off. */
export function whatsappTemplateFor(
  config: AppConfigService,
  kind: MessageKind,
  data: Record<string, string | number> = {},
): WhatsAppTemplate | undefined {
  const name = config.get(TEMPLATE_KEYS[kind]);
  if (!name) {
    if (REQUIRED_KINDS.has(kind)) {
      throw new Error(`No WhatsApp template is configured for "${kind}".`);
    }
    return undefined;
  }

  return {
    name,
    language: config.get('WHATSAPP_TEMPLATE_LANGUAGE'),
    values: TEMPLATE_VARIABLES[kind].map((key) => String(data[key] ?? '')),
    hasOtpButton: AUTHENTICATION_KINDS.has(kind),
  };
}

/** The last ten digits, so a stored number reaches the same handset however it was typed. */
export function nationalMobile(to: string): string {
  return to.replace(/\D/g, '').slice(-MOBILE_DIGITS);
}
