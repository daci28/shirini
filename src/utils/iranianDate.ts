import { toLatinDigits, toPersianDigits } from './search';

export const IRAN_TIME_ZONE = 'Asia/Tehran';

const getPersianDateParts = (date: Date): { year: number; month: number; day: number } => {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-persian', {
    timeZone: IRAN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value || 0);
  return { year: part('year'), month: part('month'), day: part('day') };
};

const canonicalDate = ({ year, month, day }: { year: number; month: number; day: number }): string => {
  return `${year.toString().padStart(4, '0')}/${month.toString().padStart(2, '0')}/${day.toString().padStart(2, '0')}`;
};

/** Current day in the Iranian timezone, expressed in the Solar Hijri calendar. */
export const getIranianPersianDate = (date = new Date()): string => canonicalDate(getPersianDateParts(date));

/** Persian calendar leap-year calculation for validating Esfand 30. */
const isPersianLeapYear = (year: number): boolean => {
  const baseYear = year - (year >= 0 ? 474 : 473);
  const cycleYear = 474 + (((baseYear % 2820) + 2820) % 2820);
  return (((cycleYear + 38) * 682) % 2816) < 682;
};

export type DeliveryDateValidation =
  | { value: string; error?: never }
  | { value?: never; error: string };

/**
 * Accepts a Solar Hijri date typed with Persian, Arabic, or Latin digits and
 * stores it in a canonical YYYY/MM/DD form. A delivery date may not be in the
 * past relative to Tehran's calendar day.
 */
export const normalizeIranianDeliveryDate = (
  value: unknown,
  today = getIranianPersianDate(),
): DeliveryDateValidation => {
  const normalized = toLatinDigits(value).trim().replace(/[.\-]/g, '/').replace(/\s+/g, '');
  const match = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) {
    return { error: 'تاریخ را به شکل ۱۴۰۵/۰۶/۱۵ وارد کنید.' };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const maxDay = month <= 6 ? 31 : month <= 11 ? 30 : isPersianLeapYear(year) ? 30 : 29;

  if (year < 1300 || year > 1600 || month < 1 || month > 12 || day < 1 || day > maxDay) {
    return { error: 'تاریخ شمسی واردشده معتبر نیست.' };
  }

  const date = canonicalDate({ year, month, day });
  if (date < today) {
    return { error: `تاریخ تحویل نمی‌تواند پیش از امروز (${toPersianDigits(today)}) باشد.` };
  }

  return { value: date };
};

const parseDeliveryTime = (value: string): number | null => {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
};

const formatDeliveryTimePart = (minutes: number): string => {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
};

export type DeliveryTimeValidation =
  | { value: string; error?: never }
  | { value?: never; error: string };

/**
 * Normalizes one requested time or a requested time range. Examples accepted:
 * 17:30, ۱۷:۳۰, 17 الی 20, and 17:30 تا 20:00.
 */
export const normalizeIranianDeliveryTime = (value: unknown): DeliveryTimeValidation => {
  const normalized = toLatinDigits(value)
    .trim()
    .replace(/\s*(?:الی|تا|\-|–|—)\s*/g, ' تا ')
    .replace(/\s+/g, ' ');

  if (!normalized) return { error: 'ساعت یا بازه تحویل را وارد کنید.' };

  const parts = normalized.split(' تا ');
  if (parts.length > 2 || parts.some((part) => !part)) {
    return { error: 'زمان را مانند ۱۷:۳۰ یا ۱۷:۳۰ تا ۲۰:۰۰ وارد کنید.' };
  }

  const minutes = parts.map(parseDeliveryTime);
  if (minutes.some((item) => item === null)) {
    return { error: 'زمان را مانند ۱۷:۳۰ یا ۱۷:۳۰ تا ۲۰:۰۰ وارد کنید.' };
  }

  const validMinutes = minutes as number[];
  if (validMinutes.length === 2 && validMinutes[1] <= validMinutes[0]) {
    return { error: 'پایان بازه تحویل باید بعد از زمان شروع باشد.' };
  }

  return { value: validMinutes.map(formatDeliveryTimePart).join(' تا ') };
};

/** Formats a stored requested delivery day in Persian digits for the panel. */
export const formatIranianDeliveryDate = (value?: string): string => {
  const rawValue = String(value || '').trim();
  if (!rawValue) return 'هنوز توسط مشتری اعلام نشده';

  const latinValue = toLatinDigits(rawValue);
  if (/^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(latinValue) && Number(latinValue.slice(0, 4)) >= 1300) {
    return toPersianDigits(latinValue.replace(/-/g, '/'));
  }

  // Older orders stored a Gregorian ISO date. Display those records consistently
  // in the Iranian timezone and Solar Hijri calendar without rewriting history.
  const parsed = new Date(rawValue.includes('T') ? rawValue : `${rawValue}T12:00:00Z`);
  if (!Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      timeZone: IRAN_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(parsed);
  }

  return toPersianDigits(rawValue);
};

export const formatIranianDeliveryTime = (value?: string): string => {
  const rawValue = String(value || '').trim();
  return rawValue ? toPersianDigits(rawValue) : 'هنوز توسط مشتری اعلام نشده';
};

/** Formats ISO timestamps such as order registration time for Iran's timezone. */
export const formatIranianDateTime = (value?: string): string => {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return '---';

  return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    timeZone: IRAN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(parsed);
};
