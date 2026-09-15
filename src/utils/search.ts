/** Normalizes Persian, Arabic and Latin values before matching dashboard searches. */
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export const normalizeSearchValue = (value: unknown): string => {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ةۀ]/g, 'ه')
    .replace(/[@]/g, '')
    .replace(/[‌‏]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/** Lets codes, phone numbers and usernames match with or without punctuation. */
export const compactSearchValue = (value: unknown): string => {
  return normalizeSearchValue(value).replace(/[\s\-_/\\().,،:+#]+/g, '');
};

/**
 * Tests one query against every meaningful field of a dashboard record. Empty
 * queries intentionally match everything so callers can compose it with tabs.
 */
export const matchesSearchValues = (query: unknown, values: unknown[]): boolean => {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) return true;

  const compactQuery = compactSearchValue(normalizedQuery);
  return values.some((value) => {
    const normalizedValue = normalizeSearchValue(value);
    return normalizedValue.includes(normalizedQuery) || (
      Boolean(compactQuery) && compactSearchValue(normalizedValue).includes(compactQuery)
    );
  });
};

export const toLatinDigits = (value: unknown): string => {
  return String(value ?? '')
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)));
};

export const toPersianDigits = (value: unknown): string => {
  return String(value ?? '').replace(/\d/g, (digit) => PERSIAN_DIGITS[Number(digit)]);
};
