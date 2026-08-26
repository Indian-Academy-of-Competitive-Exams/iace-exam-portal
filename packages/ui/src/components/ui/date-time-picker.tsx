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
  maxDate?: string;
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
  maxDate,
  disabled = false,
  id,
  className,
  ...aria
}: Readonly<DateTimePickerProps>) {
  const { date, time } = partsOf(value);

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <DatePicker
        {...aria}
        id={id}
        value={date}
        min={minDate}
        max={maxDate}
        disabled={disabled}
        className="flex-1"
        onChange={(next) => onChange(joined(next, next && !time ? MIDNIGHT : time))}
      />

      {/* eslint-disable-next-line no-restricted-syntax -- the ONE sanctioned time field: a clock spinner has no calendar to differ, and this is what DateTimePicker exists to be. */}
      <Input
        type="time"
        aria-label={aria['aria-label'] ? `${aria['aria-label']} time` : 'Time'}
        disabled={disabled || !date}
        value={time}
        className="w-32"
        onChange={(event) => onChange(joined(date, event.target.value))}
      />
    </div>
  );
}
