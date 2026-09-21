/** The tally an (i) drops open, on the test header and on every section tab. */
import { useEffect, useRef, useState } from 'react';
import { type AnswerState, type PaletteCounts } from '@iace/contracts';
import { STATE_LABEL, StateSwatch, TALLY_ORDER } from './states';

export function InfoTally({
  counts,
  label,
}: Readonly<{ counts: Readonly<Record<AnswerState, number>>; label: string }>) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  return (
    <span ref={wrap} className="inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        className="rw-icon instruction_icon"
        onClick={() => setOpen((was) => !was)}
      />

      {open ? (
        <table className="subjectcntnt">
          <tbody>
            {TALLY_ORDER.map((state) => (
              <tr key={state}>
                <td className="pr-4">{`${STATE_LABEL[state]}:`}</td>
                <td className="text-right">
                  <StateSwatch state={state} count={counts[state]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </span>
  );
}

export type { PaletteCounts };
