import {
  addDays,
  createFlightTurnClock,
  differenceInDays,
  FLIGHT_SEARCH_WINDOW_DAYS,
  getFlightSearchDateLimits,
  parseIsoDate,
  PRICE_PREDICTION_WINDOW_DAYS,
  toIsoDate,
} from './flightDateTime.js';

const WEEKDAY_INDEX = Object.freeze({
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
});

function validPositiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function firstDayOfMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex, 1));
}

function lastDayOfMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0));
}

function normalizedWeekday(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const candidate = value.trim().toLowerCase();
  if (!candidate) {
    return null;
  }
  const exact = WEEKDAY_INDEX[candidate];
  if (exact !== undefined) {
    return exact;
  }

  const match = Object.entries(WEEKDAY_INDEX).find(([name]) => name.startsWith(candidate));
  return match ? match[1] : null;
}

function nextOccurrence(today, weekdayIndex, includeToday) {
  let offset = (weekdayIndex - today.getUTCDay() + 7) % 7;
  if (offset === 0 && !includeToday) {
    offset = 7;
  }
  return addDays(today, offset);
}

function mondayForWeek(today) {
  const offset = today.getUTCDay() === 0 ? -6 : 1 - today.getUTCDay();
  return addDays(today, offset);
}

function firstMidweekDate(startDate, endDate) {
  for (let candidate = startDate; candidate <= endDate; candidate = addDays(candidate, 1)) {
    if (candidate.getUTCDay() === 2 || candidate.getUTCDay() === 3) {
      return toIsoDate(candidate);
    }
  }
  return toIsoDate(startDate);
}

function deriveExistingTripDuration(existingSearch = {}) {
  const outboundDate = parseIsoDate(existingSearch.outbound_date);
  const returnDate = parseIsoDate(existingSearch.return_date);
  if (!outboundDate || !returnDate || returnDate < outboundDate) {
    return null;
  }

  return differenceInDays(returnDate, outboundDate);
}

function invalidResult({ clock, kind, message, state = 'invalid', stale = false }) {
  return {
    status: 'INVALID_INTENT',
    kind: kind || null,
    range: null,
    searchDate: null,
    returnDate: null,
    priceFallbackDate: null,
    timeZone: clock.timeZone,
    resolvedFromDate: clock.localDate,
    assumptionLabel: message,
    state,
    stale,
  };
}

function rawRangeForIntent(input, today) {
  const kind = input.kind;

  if (kind === 'exact') {
    const exactDate = parseIsoDate(input.exactDate);
    return exactDate
      ? { startDate: exactDate, endDate: exactDate, label: input.exactDate }
      : null;
  }

  if (kind === 'weekday') {
    const weekdayIndex = normalizedWeekday(input.weekday);
    if (weekdayIndex === null) {
      return null;
    }
    const relation = input.relation || 'this';
    const selected =
      relation === 'next'
        ? addDays(
            addDays(mondayForWeek(today), 7),
            (weekdayIndex - WEEKDAY_INDEX.monday + 7) % 7,
          )
        : nextOccurrence(today, weekdayIndex, true);
    return {
      startDate: selected,
      endDate: selected,
      label: `${relation} ${String(input.weekday).toLowerCase()}`,
    };
  }

  if (kind === 'week') {
    const weekOffset = Number.isInteger(input.offset)
      ? Math.max(0, input.offset)
      : input.relation === 'next'
        ? 1
        : 0;
    const startDate = addDays(mondayForWeek(today), weekOffset * 7);
    return {
      startDate,
      endDate: addDays(startDate, 6),
      label:
        weekOffset === 0
          ? 'this week'
          : weekOffset === 1
            ? 'next week'
            : `${weekOffset} weeks ahead`,
    };
  }

  if (kind === 'weekend') {
    const weekendOffset = Number.isInteger(input.offset)
      ? Math.max(0, input.offset)
      : input.relation === 'next'
        ? 1
        : 0;
    const nearestSaturday = nextOccurrence(today, WEEKDAY_INDEX.saturday, true);
    const startDate = addDays(nearestSaturday, weekendOffset * 7);
    return {
      startDate,
      endDate: addDays(startDate, 1),
      label: weekendOffset === 0 ? 'this weekend' : 'next weekend',
    };
  }

  if (kind === 'month') {
    const relativeOffset = Number.isInteger(input.offset)
      ? input.offset
      : input.relation === 'next'
        ? 1
        : input.relation === 'this'
          ? 0
          : null;
    let year;
    let monthIndex;

    if (relativeOffset !== null) {
      const target = firstDayOfMonth(
        today.getUTCFullYear(),
        today.getUTCMonth() + Math.max(0, relativeOffset),
      );
      year = target.getUTCFullYear();
      monthIndex = target.getUTCMonth();
    } else if (Number.isInteger(input.month) && input.month >= 1 && input.month <= 12) {
      monthIndex = input.month - 1;
      year = Number.isInteger(input.year) ? input.year : today.getUTCFullYear();
      const monthEnded = lastDayOfMonth(year, monthIndex) < today;
      if (!Number.isInteger(input.year) && monthEnded) {
        year += 1;
      }
    } else {
      return null;
    }

    return {
      startDate: firstDayOfMonth(year, monthIndex),
      endDate: lastDayOfMonth(year, monthIndex),
      label: `${year}-${String(monthIndex + 1).padStart(2, '0')}`,
    };
  }

  if (kind === 'range') {
    const startDate = parseIsoDate(input.rangeStart);
    const endDate = parseIsoDate(input.rangeEnd);
    if (!startDate || !endDate || startDate > endDate) {
      return null;
    }
    return { startDate, endDate, label: 'requested date range' };
  }

  if (kind === 'flexible') {
    return {
      startDate: today,
      endDate: addDays(today, PRICE_PREDICTION_WINDOW_DAYS),
      label: 'flexible dates',
    };
  }

  return null;
}

export function resolveFlightDateIntent(
  input = {},
  { clock = createFlightTurnClock(), existingSearch = {} } = {},
) {
  const today = parseIsoDate(clock.localDate);
  if (!today) {
    return invalidResult({
      clock,
      kind: input.kind,
      message: 'The current local date is invalid.',
    });
  }

  const rawRange = rawRangeForIntent(input, today);
  if (!rawRange) {
    return invalidResult({
      clock,
      kind: input.kind,
      message: 'The structured date intent did not contain enough valid calendar detail.',
    });
  }

  if (rawRange.endDate < today) {
    return invalidResult({
      clock,
      kind: input.kind,
      message: 'That date intent is now in the past. Please provide a future travel period.',
      state: 'stale',
      stale: true,
    });
  }

  const searchLimits = getFlightSearchDateLimits(clock.localDate);
  if (rawRange.startDate > searchLimits.maxDate) {
    return {
      status: 'OUTSIDE_SEARCH_WINDOW',
      kind: input.kind,
      range: {
        startDate: toIsoDate(rawRange.startDate),
        endDate: toIsoDate(rawRange.endDate),
      },
      searchDate: null,
      returnDate: null,
      priceFallbackDate: null,
      timeZone: clock.timeZone,
      resolvedFromDate: clock.localDate,
      assumptionLabel: `The requested period is outside the ${FLIGHT_SEARCH_WINDOW_DAYS}-day flight search window ending ${searchLimits.maxDateString}.`,
      state: 'pending',
      stale: false,
    };
  }

  const startDate = rawRange.startDate < today ? today : rawRange.startDate;
  const endDate = rawRange.endDate > searchLimits.maxDate ? searchLimits.maxDate : rawRange.endDate;
  const tripDurationDays =
    validPositiveInteger(input.tripDurationDays) || deriveExistingTripDuration(existingSearch);
  const searchDate = startDate;
  const returnDate = tripDurationDays ? addDays(searchDate, tripDurationDays) : null;

  if (returnDate && returnDate > searchLimits.maxDate) {
    return {
      status: 'OUTSIDE_SEARCH_WINDOW',
      kind: input.kind,
      range: { startDate: toIsoDate(startDate), endDate: toIsoDate(endDate) },
      searchDate: toIsoDate(searchDate),
      returnDate: null,
      priceFallbackDate: firstMidweekDate(startDate, endDate),
      timeZone: clock.timeZone,
      resolvedFromDate: clock.localDate,
      assumptionLabel: `The inferred return date is outside the flight search window ending ${searchLimits.maxDateString}.`,
      state: 'pending',
      stale: false,
    };
  }

  const requiresReturnTiming =
    existingSearch.trip_type === 'roundtrip' && !tripDurationDays;
  const range = { startDate: toIsoDate(startDate), endDate: toIsoDate(endDate) };
  const rangeWasClipped = rawRange.startDate < startDate || rawRange.endDate > endDate;
  const assumptionLabel = `${rawRange.label}: ${range.startDate} to ${range.endDate}; use ${range.startDate} for flight search.${rangeWasClipped ? ' The usable range was clipped to the flight search window.' : ''}`;

  return {
    status: requiresReturnTiming ? 'NEEDS_RETURN_TIMING' : 'RESOLVED',
    kind: input.kind,
    range,
    searchDate: toIsoDate(searchDate),
    returnDate: returnDate ? toIsoDate(returnDate) : null,
    priceFallbackDate: firstMidweekDate(startDate, endDate),
    timeZone: clock.timeZone,
    resolvedFromDate: clock.localDate,
    assumptionLabel,
    state: 'pending',
    stale: false,
  };
}

// Compatibility exports keep existing imports working while context ownership
// lives in dedicated modules.
export {
  claimPricePredictionFallbackSearch,
  markFlightDateIntentUsed,
  prepareFlightDateTurn,
  recordPricePredictionForTurn,
} from './flightDateContext.js';
export { buildFlightDateIntentSummary } from './flightDatePromptContext.js';
