// Common opening-hour formats only. Unclear schedules stay unknown, never assumed open.
export function brisbaneDate(now = new Date()) {
  return new Date(now.getTime() + 10 * 60 * 60 * 1000);
}
export function openingStatus(hours, now = new Date()) {
  let text = String(hours || '')
    .trim()
    .toLowerCase();
  if (
    /^(?:open\s*)?(?:24\s*\/\s*7|24\s*hours?(?:\s*(?:a day|daily|,?\s*7 days(?: a week)?))?)\.?$/.test(
      text,
    )
  )
    return 'open';
  if (/^(closed|off)$/.test(text)) return 'closed';
  if (
    !text ||
    /holiday|sunrise|sunset|dawn|dusk|season|appointment|unknown|not (provided|recorded)/.test(
      text,
    )
  )
    return 'unknown';
  const aliases = {
    monday: 'mo',
    mon: 'mo',
    tuesday: 'tu',
    tues: 'tu',
    tue: 'tu',
    wednesday: 'we',
    wed: 'we',
    thursday: 'th',
    thurs: 'th',
    thu: 'th',
    friday: 'fr',
    fri: 'fr',
    saturday: 'sa',
    sat: 'sa',
    sunday: 'su',
    sun: 'su',
  };
  text = text
    .replace(/\b[a-z]+\b/g, (word) => aliases[word] || word)
    .replace(/[–—]/g, '-')
    .replace(/\s+to\s+/g, '-')
    .replace(/\b(?:open|daily|every day)\b/g, '')
    .trim();
  const days = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa'];
  const local = brisbaneDate(now),
    day = local.getUTCDay(),
    minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  const rules = [];
  function clock(value) {
    const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(value.trim());
    if (!match) return null;
    let hour = Number(match[1]),
      minutes = Number(match[2] || 0);
    if (
      minutes > 59 ||
      hour > 24 ||
      (hour === 24 && minutes) ||
      (match[3] && (hour < 1 || hour > 12))
    )
      return null;
    if (match[3]) hour = (hour % 12) + (match[3] === 'pm' ? 12 : 0);
    return hour * 60 + minutes;
  }
  for (const part of text.split(';')) {
    const match = /^([a-z,\s-]*?)\s*(\d.*|off|closed)$/.exec(part.trim());
    if (!match) return 'unknown';
    const selected = new Set();
    if (!match[1].trim()) days.forEach((_, i) => selected.add(i));
    else
      for (const group of match[1].trim().split(/\s*,\s*/)) {
        const range = group.split(/\s*-\s*/);
        if (range.length > 2 || range.some((d) => !days.includes(d)))
          return 'unknown';
        let i = days.indexOf(range[0]),
          end = days.indexOf(range.at(-1));
        for (let count = 0; count < 7; count++, i = (i + 1) % 7) {
          selected.add(i);
          if (i === end) break;
        }
      }
    const intervals = [];
    if (!/^(off|closed)$/.test(match[2]))
      for (const span of match[2].split(',')) {
        const range = span.split('-');
        if (range.length !== 2) return 'unknown';
        const start = clock(range[0]),
          finish = clock(range[1]);
        if (start === null || finish === null || start === 1440) return 'unknown';
        intervals.push([start, finish <= start ? finish + 1440 : finish]);
      }
    rules.push({ days: selected, intervals });
  }
  const today = rules.filter((rule) => rule.days.has(day)).at(-1);
  const yesterday = rules.filter((rule) => rule.days.has((day + 6) % 7)).at(-1);
  const openToday = today?.intervals.some(
    ([start, end]) => minute >= start && minute < end,
  );
  const overnight = yesterday?.intervals.some(
    ([, end]) => end > 1440 && minute < end - 1440,
  );
  return openToday || overnight ? 'open' : 'closed';
}

// Recognised facility phrases run locally against the selected radius; other text stays a place search.
export function parseFacilitySearch(query) {
  let text = query
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim();
  const type = /\b(toilets?|restrooms?|bathrooms?|wc)\b/.test(text)
    ? 'toilet'
    : /\b(fountains?|water|bubblers?)\b/.test(text)
      ? 'water'
      : /\b(stores?|shops?|convenience)\b/.test(text)
        ? 'store'
        : null;
  if (!type) return null;
  const filters = { type, open: /\bopen\b/.test(text) };
  const terms = {
    female: /\b(female|women|womens)\b/,
    male: /\b(male|men|mens)\b/,
    unisex: /\bunisex\b/,
    allgender: /\b(gender-neutral|gender neutral|all-gender)\b/,
    shower: /\bshowers?\b/,
    dog: /\bdogs?\b/,
    bottle: /\bbottles?\b/,
    accessible: /\b(accessible|wheelchair)\b/,
    babychange: /\b(baby|changing)\b/,
  };
  for (const [key, pattern] of Object.entries(terms)) {
    filters[key] = pattern.test(text);
    text = text.replace(new RegExp(pattern.source, 'g'), ' ');
  }
  text = text
    .replace(
      /\b(toilets?|restrooms?|bathrooms?|wc|fountains?|water|drinking|bubblers?|stores?|shops?|convenience|open|now|near|me|nearest|closest|with|for|a|the|and|filling|bowl)\b/g,
      ' ',
    )
    .trim();
  // A named place such as "Toilet Hill" or "Corner Store" should still use normal search.
  return text ? null : filters;
}
export function matchesFacilitySearch(facility, filters, now = new Date()) {
  if (facility.type !== filters.type) return false;
  if (filters.open && openingStatus(facility.hours, now) !== 'open') return false;
  for (const key of ['male', 'female', 'allgender', 'shower'])
    if (filters[key] && facility.toiletDetails?.[key] !== true) return false;
  for (const key of ['unisex', 'accessible', 'babychange', 'bottle', 'dog'])
    if (
      filters[key] &&
      !facility.amenities?.includes(key) &&
      facility.toiletDetails?.[key] !== true
    )
      return false;
  return true;
}
