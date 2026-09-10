import { useState } from 'react';
import type { TestDetail } from '@iace/contracts';
import { offerChangesOf, savedOffer, type OfferDraft } from './test-offer-draft';

/** The Offer step as one draft against the saved test, which Done writes in one go. */

export interface ProgramRefusal {
  programCode: string;
  message: string;
}

export function useOfferDraft(detail: TestDetail | null) {
  const [draft, setDraft] = useState<OfferDraft | null>(null);
  const [refused, setRefused] = useState<ProgramRefusal | null>(null);

  const saved = detail ? savedOffer(detail) : null;
  const held = draft ?? saved;
  const changes = saved && held ? offerChangesOf(saved, held) : null;

  return {
    saved,
    held,
    changes,
    refused,
    refuse: setRefused,
    edit: setDraft,
    discard: () => {
      setDraft(null);
      setRefused(null);
    },
  };
}

export type OfferHold = ReturnType<typeof useOfferDraft>;
