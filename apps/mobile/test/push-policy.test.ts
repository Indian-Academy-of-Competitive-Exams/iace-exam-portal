import test from 'node:test';
import assert from 'node:assert/strict';
import { createLinkGuard } from '../src/lib/link-guard';
import { pushPolicy } from '../src/lib/push-policy';

/** The failure this prevents: a push banner over a running paper, a tap that takes the phone off it, or a bell read per sitting. */
test('pushPolicy stands a push down for exactly as long as the link guard holds a sitting', () => {
  const guard = createLinkGuard();
  const cases = [
    { sitting: true, banner: false, opens: false, refreshes: false },
    { sitting: false, banner: true, opens: true, refreshes: true },
  ];
  for (const { sitting, banner, opens, refreshes } of cases) {
    guard.setSitting(sitting);
    const policy = pushPolicy(guard.isSitting());
    assert.equal(policy.presentation.shouldShowBanner, banner, `banner, sitting=${sitting}`);
    assert.equal(policy.presentation.shouldShowList, true, 'it still reaches the shade');
    assert.equal(policy.tapOpensBell, opens, `tap, sitting=${sitting}`);
    assert.equal(policy.refreshesBell, refreshes, `bell, sitting=${sitting}`);
  }
});
