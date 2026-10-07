/** Built from the parts, never parsed: `new Date('1998-02-03')` is UTC midnight, a day early west of it. */
export function dayOf(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}

/** The inverse of `dayOf`: the day the picker showed is the phone's own, so it is read back on the phone's clock. */
export function valueOfDay(picked: Date): string {
  const two = (part: number) => String(part).padStart(2, '0');
  return `${picked.getFullYear()}-${two(picked.getMonth() + 1)}-${two(picked.getDate())}`;
}
