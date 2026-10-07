// A section names its session by POSITION in the form, so the list of sessions cannot change without the sections following.

interface InSession {
  moduleOrder: string;
}

/** '' is "the first session": the server files an unnamed section there. */
const sessionOf = (section: InSession): number =>
  section.moduleOrder === '' ? 0 : Number(section.moduleOrder);

export function sectionsInSession<T extends InSession>(sections: readonly T[], index: number): T[] {
  return sections.filter((section) => sessionOf(section) === index);
}

export function sectionsAfterSessionRemoved<T extends InSession>(
  sections: readonly T[],
  removed: number,
): T[] {
  return sections.map((section) => {
    const session = sessionOf(section);
    if (section.moduleOrder === '' || session < removed) return section;
    return { ...section, moduleOrder: session === removed ? '' : String(session - 1) };
  });
}
