
function getPricePredictionDateLimits(now = new Date()) {
  const today = startOfUtcDay(now);
  return {
    today,
    yesterday: addDays(today, -1),
    maxDate: addDays(today, PRICE_PREDICTION_WINDOW_DAYS),
    todayString: toIsoDate(today),
    yesterdayString: toIsoDate(addDays(today, -1)),
    maxDateString: toIsoDate(addDays(today, PRICE_PREDICTION_WINDOW_DAYS)),
  };
}
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const MONTH_PATTERN = MONTH_NAMES.join('|');
const FLEXIBLE_DATE_PATTERN =
  /\b(flexible|any date|sometime|cheapest dates?|best dates?|low[- ]?fare dates?|nearby cheaper dates?|best time to fly|when should i fly|date range)\b/i;
const FILTER_OR_CURRENT_RESULT_PATTERN =
  /\b(non[- ]?stop|stops?|baggage|carry[- ]?on|checked bag|(?:morning|afternoon|evening|night) (?:departure|arrival|flights?)|arrival time|layover|under \$?\d+|compare (?:current|these|options?)|which (?:flight|option)|best option|cheapest flight|shortest duration)\b/i;
const ROUTE_SEARCH_PATTERN =
  /\b(find|search|book|need)\b[^.?!]*\bflights?\b|\bwant\b[^.?!]*\b(?:fly|travel)\b|\b(?:change|update)\s+(?:the\s+)?route\b|\bflights?\s+from\b|\b[A-Z]{3}\s+(?:to|->)\s+[A-Z]{3}\b|\bfrom\s+[^.?!]+\s+to\s+[^.?!]+/i;

function startOfUtcDay(value) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function toIsoDate(value) {
  return value.toISOString().slice(0, 10);
}

function addDays(value, count) {
  return new Date(value.getTime() + count * DAY_MS);
}

function parseIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed;
}

function addMonths(value, count) {
  const targetMonth = value.getUTCMonth() + count;
  const firstOfTarget = new Date(Date.UTC(value.getUTCFullYear(), targetMonth, 1));
  const lastDay = new Date(
    Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(
      firstOfTarget.getUTCFullYear(),
      firstOfTarget.getUTCMonth(),
      Math.min(value.getUTCDate(), lastDay),
    ),
  );
}

function monthRange(year, monthIndex) {
  return {
    startDate: toIsoDate(new Date(Date.UTC(year, monthIndex, 1))),
    endDate: toIsoDate(new Date(Date.UTC(year, monthIndex + 1, 0))),
  };
}

function relativeMonthRange(today, offset) {
  const target = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1),
  );
  return monthRange(target.getUTCFullYear(), target.getUTCMonth());
}

function parseNaturalDateCandidates(message, today) {
  const candidates = [];
  const seen = new Set();
  const patterns = [
    new RegExp(
      `\\b(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d{2}))?\\b`,
      'gi',
    ),
    new RegExp(
      `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_PATTERN})(?:,?\\s+(20\\d{2}))?\\b`,
      'gi',
    ),
  ];

  for (const [patternIndex, pattern] of patterns.entries()) {
    for (const match of message.matchAll(pattern)) {
      const monthName = patternIndex === 0 ? match[1] : match[2];
      const day = Number(patternIndex === 0 ? match[2] : match[1]);
      const explicitYear = Number(match[3]) || null;
      const monthIndex = MONTH_NAMES.indexOf(monthName.toLowerCase());
      let year = explicitYear || today.getUTCFullYear();
      let parsed = new Date(Date.UTC(year, monthIndex, day));

      if (
        parsed.getUTCMonth() !== monthIndex ||
        parsed.getUTCDate() !== day
      ) {
        continue;
      }
      if (!explicitYear && parsed < today) {
        year += 1;
        parsed = new Date(Date.UTC(year, monthIndex, day));
      }

      const date = toIsoDate(parsed);
      if (!seen.has(date)) {
        seen.add(date);
        candidates.push(date);
      }
    }
  }

  return candidates;
}

function explicitDateCandidates(message, today) {
  const isoDates = [...message.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)]
    .map((match) => match[0])
    .filter((date) => parseIsoDate(date));
  return [...new Set([...isoDates, ...parseNaturalDateCandidates(message, today)])];
}

function resolveNamedMonthRange(message, today) {
  const match = message.match(
    new RegExp(`\\b(${MONTH_PATTERN})(?:\\s+(20\\d{2}))?\\b`, 'i'),
  );
  if (!match) {
    return null;
  }

  const monthIndex = MONTH_NAMES.indexOf(match[1].toLowerCase());
  let year = Number(match[2]) || today.getUTCFullYear();
  if (!match[2] && monthIndex < today.getUTCMonth()) {
    year += 1;
  }
  return monthRange(year, monthIndex);
}

function resolveRequestedRange(message, today, exactDates) {
  if (exactDates.length >= 2) {
    const sorted = [...exactDates].sort();
    return {
      range: { startDate: sorted[0], endDate: sorted.at(-1) },
      reason: 'date_range',
    };
  }

  const nextDays = message.match(/\b(?:in\s+)?(?:the\s+)?next\s+(\d+)\s+days?\b/i);
  if (nextDays) {
    return {
      range: {
        startDate: toIsoDate(today),
        endDate: toIsoDate(addDays(today, Math.max(1, Number(nextDays[1])))),
      },
      reason: 'relative_day_range',
    };
  }

  const nextWeeks = message.match(/\b(?:in\s+)?(?:the\s+)?next\s+(\d+)\s+weeks?\b/i);
  if (nextWeeks) {
    return {
      range: {
        startDate: toIsoDate(today),
        endDate: toIsoDate(addDays(today, Math.max(1, Number(nextWeeks[1])) * 7)),
      },
      reason: 'relative_week_range',
    };
  }

  if (/\bnext week\b/i.test(message)) {
    const daysUntilNextMonday = ((8 - today.getUTCDay()) % 7) || 7;
    const startDate = addDays(today, daysUntilNextMonday);
    return {
      range: {
        startDate: toIsoDate(startDate),
        endDate: toIsoDate(addDays(startDate, 6)),
      },
      reason: 'relative_week',
    };
  }

  const nextMonths = message.match(/\b(?:in\s+)?(?:the\s+)?next\s+(\d+)\s+months?\b/i);
  if (nextMonths) {
    const monthCount = Math.max(1, Number(nextMonths[1]));
    return {
      range: {
        startDate: toIsoDate(today),
        endDate: toIsoDate(addMonths(today, monthCount)),
      },
      reason: 'relative_month_range',
    };
  }

  if (/\bnext month\b/i.test(message)) {
    return { range: relativeMonthRange(today, 1), reason: 'relative_month' };
  }
  if (/\bsecond month\b/i.test(message)) {
    return { range: relativeMonthRange(today, 2), reason: 'relative_month' };
  }
  if (/\bthird month\b/i.test(message)) {
    return { range: relativeMonthRange(today, 3), reason: 'relative_month' };
  }
  if (/\bthis month\b/i.test(message)) {
    return {
      range: monthRange(today.getUTCFullYear(), today.getUTCMonth()),
      reason: 'relative_month',
    };
  }

  const namedMonthRange = resolveNamedMonthRange(message, today);
  if (namedMonthRange) {
    return { range: namedMonthRange, reason: 'named_month' };
  }

  return { range: null, reason: FLEXIBLE_DATE_PATTERN.test(message) ? 'flexible' : null };
}

function intersectRanges(left, right) {
  if (!left || !right) {
    return null;
  }
  const startDate = left.startDate > right.startDate ? left.startDate : right.startDate;
  const endDate = left.endDate < right.endDate ? left.endDate : right.endDate;
  return startDate <= endDate ? { startDate, endDate } : null;
}

function firstMidweekDate(range) {
  if (!range) {
    return null;
  }
  const startDate = parseIsoDate(range.startDate);
  const endDate = parseIsoDate(range.endDate);
  if (!startDate || !endDate || startDate > endDate) {
    return null;
  }

  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(startDate.getTime() + offset * DAY_MS);
    if (candidate > endDate) {
      return null;
    }
    if (candidate.getUTCDay() === 2 || candidate.getUTCDay() === 3) {
      return toIsoDate(candidate);
    }
  }
  return null;
}

export function analyzePricePredictionDateIntent(
  userMessage,
  { now = new Date(), existingTravelDate = null } = {},
) {
  const message = typeof userMessage === 'string' ? userMessage.trim() : '';
  const today = startOfUtcDay(now);
  const limits = getPricePredictionDateLimits(today);
  const predictionWindow = {
    startDate: limits.todayString,
    endDate: limits.maxDateString,
  };
  const exactDates = explicitDateCandidates(message, today);
  const relativeExactDate = /\b(today|tomorrow|tonight|next\s+(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b/i.test(
    message,
  );
  if (exactDates.length === 1 || relativeExactDate) {
    return {
      kind: 'exact',
      shouldUsePredictionFirst: false,
      reason: 'exact_date',
      exactDate: exactDates[0] || null,
      predictionWindow,
      requestedRange: null,
      effectiveRange: null,
      rangeOutsidePredictionWindow: false,
      rangePartiallyOutsidePredictionWindow: false,
      rangeOutsideReason: null,
      fallbackDate: null,
    };
  }

  const resolved = resolveRequestedRange(message, today, exactDates);
  const hasRouteSearchIntent =
    ROUTE_SEARCH_PATTERN.test(message) && !FILTER_OR_CURRENT_RESULT_PATTERN.test(message);
  if (!resolved.reason && existingTravelDate && parseIsoDate(existingTravelDate)) {
    return {
      kind: 'exact',
      shouldUsePredictionFirst: false,
      reason: 'existing_context_date',
      exactDate: existingTravelDate,
      predictionWindow,
      requestedRange: null,
      effectiveRange: null,
      rangeOutsidePredictionWindow: false,
      rangePartiallyOutsidePredictionWindow: false,
      rangeOutsideReason: null,
      fallbackDate: null,
    };
  }

  if (!resolved.reason && !hasRouteSearchIntent) {
    return {
      kind: 'none',
      shouldUsePredictionFirst: false,
      reason: null,
      exactDate: null,
      predictionWindow,
      requestedRange: null,
      effectiveRange: null,
      rangeOutsidePredictionWindow: false,
      rangePartiallyOutsidePredictionWindow: false,
      rangeOutsideReason: null,
      fallbackDate: null,
    };
  }

  if (!resolved.reason && hasRouteSearchIntent) {
    resolved.reason = 'missing_exact_date';
  }

  const effectiveRange = resolved.range
    ? intersectRanges(resolved.range, predictionWindow)
    : predictionWindow;
  const rangeOutsidePredictionWindow = Boolean(resolved.range && !effectiveRange);
  const rangePartiallyOutsidePredictionWindow = Boolean(
    resolved.range &&
      effectiveRange &&
      (resolved.range.startDate < predictionWindow.startDate ||
        resolved.range.endDate > predictionWindow.endDate),
  );
  const rangeOutsideReason = rangeOutsidePredictionWindow
    ? resolved.range.endDate < predictionWindow.startDate
      ? 'past'
      : 'beyond_window'
    : null;
  const fallbackRange =
    effectiveRange ||
    (rangeOutsideReason === 'past' ? predictionWindow : resolved.range) ||
    predictionWindow;

  return {
    kind: 'flexible',
    shouldUsePredictionFirst: true,
    reason: resolved.reason,
    exactDate: null,
    predictionWindow,
    requestedRange: resolved.range,
    effectiveRange,
    rangeOutsidePredictionWindow,
    rangePartiallyOutsidePredictionWindow,
    rangeOutsideReason,
    fallbackDate: firstMidweekDate(fallbackRange),
  };
}

export function buildPricePredictionDateIntentSummary(intent) {
  if (!intent || intent.kind === 'none') {
    return 'none';
  }

  return [
    `kind=${intent.kind}`,
    `predictionFirst=${intent.shouldUsePredictionFirst ? 'yes' : 'no'}`,
    `reason=${intent.reason || 'none'}`,
    `fixedToolWindow=${intent.predictionWindow.startDate}..${intent.predictionWindow.endDate}`,
    `requestedPreference=${intent.requestedRange ? `${intent.requestedRange.startDate}..${intent.requestedRange.endDate}` : 'full prediction window'}`,
    `effectivePreference=${intent.effectiveRange ? `${intent.effectiveRange.startDate}..${intent.effectiveRange.endDate}` : 'none'}`,
    `outsideWindow=${intent.rangeOutsidePredictionWindow ? 'yes' : 'no'}`,
    `partiallyOutsideWindow=${intent.rangePartiallyOutsidePredictionWindow ? 'yes' : 'no'}`,
    `generalFallbackDate=${intent.fallbackDate || 'none'}`,
  ].join('; ');
}
