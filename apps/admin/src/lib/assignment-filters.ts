/** A section belongs to ONE test, so the two filters cascade rather than sitting side by side. */
export function chooseTest(
  next: string,
  current: string,
  baseConfigSectionId: string,
): { testId: string; baseConfigSectionId: string } {
  // A section id from the old test matches nothing on the new one, and blanks the list.
  return { testId: next, baseConfigSectionId: next === current ? baseConfigSectionId : '' };
}
