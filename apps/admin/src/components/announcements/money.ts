import { type AnnouncementChannel } from '@iace/contracts';

const PAISE_PER_RUPEE = 100;

/** What a channel is called on screen, so the list, the dialog and the panel cannot disagree. */
export const CHANNEL_LABEL: Readonly<Record<AnnouncementChannel, string>> = {
  WHATSAPP: 'WhatsApp',
  SMS: 'SMS',
};

/** Paise in, rupees out — the invoice is in rupees and nobody reads 4250 paise. */
export function rupees(paise: number): string {
  return (paise / PAISE_PER_RUPEE).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  });
}
