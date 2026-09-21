import * as React from 'react';
import { cn } from '../../lib/utils';
import { DatePicker } from './date-picker';
import { Input } from './input';

/** A day and a time as ONE `YYYY-MM-DDTHH:mm` wall-time string. The app owns the zone, never this. */

const SEPARATOR = 'T';
const MIDNIGHT = '00:00';

export interface DateTimePickerProps {
  /** `YYYY-MM-DDTHH:mm`, or '' for nothing chosen. Wall time — never an instant. */
  value: string;
  onChange: (value: string) => void;
  minDate?: string;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  className?: string;
}

const partsOf = (value: string): { date: string; time: string } => {
  const [date = '', time = ''] = value.split(SEPARATOR);
  return { date, time };
};

/** Half a value is no value: a day with no time would be read as midnight nobody chose. */
const joined = (date: string, time: string): string =>
  date && time ? `${date}${SEPARATOR}${time}` : '';

export function DateTimePicker({
  value,
  onChange,
  minDate,
  disabled = false,
  id,
  className,
  ...aria
}: Readonly<DateTimePickerProps>) {
  const { date: given, time } = partsOf(value);

  // A time field reports '' the moment a segment is cleared; the day survives that edit here.
  const [held, setHeld] = React.useState({ from: value, date: given });
  if (held.from !== value) setHeld({ from: value, date: given });
  const date = held.from === value ? held.date : given;

  const emit = (next: string, day: string) => {
    setHeld({ from: next, date: day });
    onChange(next);
  };

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <DatePicker
        {...aria}
        id={id}
        value={date}
        min={minDate}
        disabled={disabled}
        className="flex-1"
        onChange={(next) => emit(joined(next, next && !time ? MIDNIGHT : time), next)}
      />

      {/* eslint-disable-next-line no-restricted-syntax -- the ONE sanctioned time field: a clock spinner has no calendar to differ, and this is what DateTimePicker exists to be. */}
      <Input
        type="time"
        aria-label={aria['aria-label'] ? `${aria['aria-label']} time` : 'Time'}
        disabled={disabled || !date}
        value={time}
        className="w-32"
        onChange={(event) => emit(joined(date, event.target.value), date)}
      />
    </div>
  );
}
