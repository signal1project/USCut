import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui';

interface CronScheduleProps {
  onSubmit: (cronExpression: string) => void;
}

const CronSchedule: React.FC<CronScheduleProps> = ({ onSubmit }) => {
  const [selectedType, setSelectedType] = useState('day');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  const handleTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedType(e.target.value);
    setValue('');
    setError('');
  };

  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value);
    setError('');
  };

  const validate = (): boolean => {
    const valueInt = parseInt(value, 10);
    switch (selectedType) {
      case 'day':
        if (isNaN(valueInt) || valueInt < 0 || valueInt > 23) {
          setError('Hour must be an integer 0–23');
          return false;
        }
        break;
      case 'week':
        if (isNaN(valueInt) || valueInt < 0 || valueInt > 6) {
          setError('Day must be an integer 0 (Sun) – 6 (Sat)');
          return false;
        }
        break;
      case 'month':
        if (isNaN(valueInt) || valueInt < 1 || valueInt > 31) {
          setError('Date must be an integer 1–31');
          return false;
        }
        break;
      default:
        return false;
    }
    setError('');
    return true;
  };

  const handleSubmit = () => {
    if (validate()) {
      const cronExpression = `${selectedType}-${value}`;
      onSubmit(cronExpression);
      toast.success('Schedule expression generated');
    }
  };

  const placeholder =
    selectedType === 'day'
      ? 'Hour (0–23)'
      : selectedType === 'week'
        ? 'Day of week (0=Sun)'
        : 'Day of month (1–31)';

  const min = selectedType === 'month' ? 1 : 0;
  const max = selectedType === 'day' ? 23 : selectedType === 'week' ? 6 : 31;

  return (
    <div
      style={{ width: 300, display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <div>
        <label className="text-xs font-medium text-ink-base mb-1 block">
          Repeat
        </label>
        <select
          value={selectedType}
          onChange={handleTypeChange}
          className="w-full rounded-md border border-border bg-surface-2 text-ink-base text-sm px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="day">Daily</option>
          <option value="week">Weekly</option>
          <option value="month">Monthly</option>
        </select>
      </div>

      <div>
        <label className="text-xs font-medium text-ink-base mb-1 block">
          Value
        </label>
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={handleValueChange}
          placeholder={placeholder}
          className="w-full rounded-md border border-border bg-surface-2 text-ink-base text-sm px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent"
        />
        {error && <p className="text-xs text-error mt-1">{error}</p>}
      </div>

      <Button
        size="sm"
        onClick={handleSubmit}
        disabled={!value || !!error}
        className="w-full"
      >
        Generate Schedule
      </Button>
    </div>
  );
};

/** Parses a cron-expression string back to human-readable text. */
const ParseCronSchedule: React.FC<{ cronExpression: string }> = ({
  cronExpression,
}) => {
  const [parsedText, setParsedText] = useState('');

  useEffect(() => {
    const [type, val] = cronExpression.split('-');
    let parsed = '';
    switch (type) {
      case 'day':
        parsed = `Every day at ${val}:00`;
        break;
      case 'week':
        parsed = `Every week on day ${val}`;
        break;
      case 'month':
        parsed = `Every month on the ${val}`;
        break;
      default:
        parsed = 'Unknown schedule';
    }
    setParsedText(parsed);
  }, [cronExpression]);

  return <p className="text-sm text-ink-base">{parsedText}</p>;
};

export { CronSchedule, ParseCronSchedule };
