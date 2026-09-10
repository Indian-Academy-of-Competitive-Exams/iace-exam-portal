import { useState } from 'react';
import type { TestDetail } from '@iace/contracts';
import {
  NONE_PASSED,
  anyPassed,
  offerChangesOf,
  passedOpenings,
  savedOffer,
  type OfferDraft,
} from './test-offer-draft';

/** The Offer step as one draft against the saved test, which Done writes in one go. */

export interface ProgramRefusal {
  programCode: string;
  message: string;
}

export function useOfferDraft(detail: TestDetail | null) {
  const [draft, setDraft] = useState<OfferDraft | null>(null);
  const [refused, setRefused] = useState<ProgramRefusal | null>(null);
  // Taken on edit and on Done, never in render, so Done still catches a time that passed meanwhile.
  const [checkedAt, setCheckedAt] = useState(() => Date.now());

  const saved = detail ? savedOffer(detail) : null;
  const held = draft ?? saved;
  const changes = saved && held ? offerChangesOf(saved, held) : null;
  const passed = saved && held ? passedOpenings(saved, held, new Date(checkedAt)) : NONE_PASSED;

  return {
    saved,
    held,
    changes,
    passed,
    refused,
    refuse: setRefused,
    edit: (next: OfferDraft) => {
      setCheckedAt(Date.now());
      setDraft(next);
    },
    discard: () => {
      setDraft(null);
      setRefused(null);
    },
    /** True when a time Done would write has passed, which the fields now show. */
    recheck: (): boolean => {
      const at = Date.now();
      setCheckedAt(at);
      return (
        saved !== null && held !== null && anyPassed(passedOpenings(saved, held, new Date(at)))
      );
    },
  };
}

export type OfferHold = ReturnType<typeof useOfferDraft>;
