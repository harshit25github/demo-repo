// --  During initialisation 

const requestClock = createFlightTurnClock({
    now,
    timeZone,
  });

export function createFlightTurnClock({
  now = new Date(),
  timeZone = process.env.FLIGHT_AGENT_TIMEZONE ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    'UTC',
} = {}) {
  const instant = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(instant.getTime())) {
    throw new Error('now must be a valid date or timestamp.');
  }

  let parts;
  try {
    parts = formatterParts(instant, timeZone);
  } catch {
    timeZone = 'UTC';
    parts = formatterParts(instant, timeZone);
  }

  const localDate = [parts.year, parts.month, parts.day]
    .map((value, index) => (index === 0 ? String(value) : String(value).padStart(2, '0')))
    .join('-');
  const localTime = [parts.hour, parts.minute, parts.second]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
  const representedUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const instantAtSecond = Math.floor(instant.getTime() / 1000) * 1000;
  const offsetMinutes = Math.round((representedUtcMs - instantAtSecond) / 60000);

  return Object.freeze({
    localDate,
    localDateTime: `${localDate}T${localTime}${formatOffset(offsetMinutes)}`,
    timeZone,
  });
}
// ------- Dynamic Prompts 
export function dateLimitsFromLocalDate(localDate, windowDays) {
  const today = parseIsoDate(localDate);
  if (!today) {
    throw new Error('localDate must be a valid YYYY-MM-DD date.');
  }

  return {
    today,
    yesterday: addDays(today, -1),
    maxDate: addDays(today, windowDays),
    todayString: toIsoDate(today),
    yesterdayString: toIsoDate(addDays(today, -1)),
    maxDateString: toIsoDate(addDays(today, windowDays)),
  };
}

export function buildFlightDateDynamicPromptContext(clock) {
  if (!clock?.localDate) {
    return '- Flight turn clock is not initialized.';
  }

  const predictionWindow = dateLimitsFromLocalDate(
    clock.localDate,
    PRICE_PREDICTION_WINDOW_DAYS,
  );
  const searchWindow = dateLimitsFromLocalDate(
    clock.localDate,
    FLIGHT_SEARCH_WINDOW_DAYS,
  );

  return [
    `- Immutable turn clock: localDate=${clock.localDate}; localDateTime=${clock.localDateTime}; timeZone=${clock.timeZone}.`,
    `- Current price prediction window: ${predictionWindow.todayString} through ${predictionWindow.maxDateString}, inclusive.`,
    `- Current flight-search booking window: ${searchWindow.todayString} through ${searchWindow.maxDateString}, inclusive.`,
  ].join('\n');
}

// Tool 
import { tool } from '@openai/agents';
import { z } from 'zod';
import { resolveFlightDateIntent } from '../flightDateResolver.js';
import { log } from '../logger.js';

export const RESOLVE_FLIGHT_DATE_TOOL_NAME = 'resolve_flight_date';

export const resolveFlightDateInputSchema = z.object({
  kind: z.enum(['exact', 'weekday', 'week', 'weekend', 'month', 'range', 'flexible']),
  relation: z.enum(['this', 'next']).nullable(),
  offset: z.number().int().min(0).nullable(),
  weekday: z
    .enum([
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ])
    .nullable(),
  month: z.number().int().min(1).max(12).nullable(),
  year: z.number().int().min(2000).max(9999).nullable(),
  exactDate: z.string().nullable(),
  rangeStart: z.string().nullable(),
  rangeEnd: z.string().nullable(),
  tripDurationDays: z.number().int().positive().nullable(),
  tripType: z.enum(['oneway', 'roundtrip']).nullable(),
});

export const ResolveFlightDateTool = tool({
  name: RESOLVE_FLIGHT_DATE_TOOL_NAME,
  description:
    'Statelessly resolve structured calendar semantics into ISO flight dates using the immutable local clock. Do not pass raw user text. Always pass tripType when known. For a date N days ahead, use kind=exact with offset=N.',
  parameters: resolveFlightDateInputSchema,
  strict: true,
  execute(input, runContext) {
    const requestContext = runContext?.context || {};
    const appContext = requestContext.state || {};
    const flight = appContext.flight || {};

    const result = resolveFlightDateIntent(input, {
      clock: requestContext.runtime?.clock || null,
      existingSearch: {
        trip_type: flight.tripType || null,
        outbound_date: flight.outboundDate || null,
        return_date: flight.inboundDate || null,
      },
    });

    log('info', 'resolve_flight_date.called', {
      requestId: appContext.requestId,
      sessionId: appContext.sessionId,
      status: result.status,
      kind: input.kind,
      searchDate: result.searchDate,
      returnDate: result.returnDate,
    });

    return result;
  },
});


// Tool Dependency - 
import {
  addDays,
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

function deriveExistingTripDuration(existingSearch = {}) {
  const outboundDate = parseIsoDate(existingSearch.outbound_date);
  const returnDate = parseIsoDate(existingSearch.return_date);
  if (!outboundDate || !returnDate || returnDate < outboundDate) {
    return null;
  }

  return differenceInDays(returnDate, outboundDate);
}

function invalidResult({ message }) {
  return {
    status: 'INVALID_INTENT',
    range: null,
    searchDate: null,
    returnDate: null,
    assumptionLabel: message,
  };
}

function rawRangeForIntent(input, today) {
  const kind = input.kind;
  const explicitRangeStart = parseIsoDate(input.rangeStart);
  const explicitRangeEnd = parseIsoDate(input.rangeEnd);

  if (explicitRangeStart && explicitRangeEnd && explicitRangeStart <= explicitRangeEnd) {
    return {
      startDate: explicitRangeStart,
      endDate: explicitRangeEnd,
      label: kind === 'range' ? 'requested date range' : `preserved ${kind} range`,
    };
  }

  if (kind === 'exact') {
    const exactDate = parseIsoDate(input.exactDate);
    if (exactDate) {
      return { startDate: exactDate, endDate: exactDate, label: input.exactDate };
    }
    if (Number.isInteger(input.offset) && input.offset >= 0) {
      const relativeDate = addDays(today, input.offset);
      return {
        startDate: relativeDate,
        endDate: relativeDate,
        label: `${input.offset} days from ${toIsoDate(today)}`,
      };
    }
    return null;
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
  { clock, existingSearch = {} } = {},
) {
  const today = parseIsoDate(clock?.localDate);
  if (!today) {
    return invalidResult({
      message: 'The current local date is invalid.',
    });
  }

  const rawRange = rawRangeForIntent(input, today);
  if (!rawRange) {
    return invalidResult({
      message: 'The structured date intent did not contain enough valid calendar detail.',
    });
  }

  if (rawRange.endDate < today) {
    return invalidResult({
      message: 'That date intent is now in the past. Please provide a future travel period.',
    });
  }

  const searchLimits = getFlightSearchDateLimits(clock.localDate);
  if (rawRange.startDate > searchLimits.maxDate) {
    return {
      status: 'OUTSIDE_SEARCH_WINDOW',
      range: {
        startDate: toIsoDate(rawRange.startDate),
        endDate: toIsoDate(rawRange.endDate),
      },
      searchDate: null,
      returnDate: null,
      assumptionLabel: `The requested period is outside the ${FLIGHT_SEARCH_WINDOW_DAYS}-day flight search window ending ${searchLimits.maxDateString}.`,
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
      range: { startDate: toIsoDate(startDate), endDate: toIsoDate(endDate) },
      searchDate: toIsoDate(searchDate),
      returnDate: null,
      assumptionLabel: `The inferred return date is outside the flight search window ending ${searchLimits.maxDateString}.`,
    };
  }

  const requiresReturnTiming =
    (input.tripType || existingSearch.trip_type) === 'roundtrip' && !tripDurationDays;
  const range = { startDate: toIsoDate(startDate), endDate: toIsoDate(endDate) };
  const rangeWasClipped = rawRange.startDate < startDate || rawRange.endDate > endDate;
  const assumptionLabel = `${rawRange.label}: ${range.startDate} to ${range.endDate}; use ${range.startDate} for flight search.${rangeWasClipped ? ' The usable range was clipped to the flight search window.' : ''}`;

  return {
    status: requiresReturnTiming ? 'NEEDS_RETURN_TIMING' : 'RESOLVED',
    range,
    searchDate: toIsoDate(searchDate),
    returnDate: returnDate ? toIsoDate(returnDate) : null,
    assumptionLabel,
  };
}
// --- FlightDateTime 

export const DAY_MS = 24 * 60 * 60 * 1000;
export const PRICE_PREDICTION_WINDOW_DAYS = 89;
export const FLIGHT_SEARCH_WINDOW_DAYS = 359;

export function startOfUtcDay(value) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function addDays(value, days) {
  return new Date(value.getTime() + days * DAY_MS);
}

export function toIsoDate(value) {
  return value.toISOString().slice(0, 10);
}

export function parseIsoDate(value) {
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

export function differenceInDays(laterDate, earlierDate) {
  return Math.round((laterDate.getTime() - earlierDate.getTime()) / DAY_MS);
}

export function dateLimitsFromLocalDate(localDate, windowDays) {
  const today = parseIsoDate(localDate);
  if (!today) {
    throw new Error('localDate must be a valid YYYY-MM-DD date.');
  }

  return {
    today,
    yesterday: addDays(today, -1),
    maxDate: addDays(today, windowDays),
    todayString: toIsoDate(today),
    yesterdayString: toIsoDate(addDays(today, -1)),
    maxDateString: toIsoDate(addDays(today, windowDays)),
  };
}

export function getPricePredictionDateLimits(now = new Date()) {
  const today = startOfUtcDay(now);
  return dateLimitsFromLocalDate(toIsoDate(today), PRICE_PREDICTION_WINDOW_DAYS);
}

export function getFlightSearchDateLimits(localDate) {
  return dateLimitsFromLocalDate(localDate, FLIGHT_SEARCH_WINDOW_DAYS);
}

function formatterParts(now, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function formatOffset(minutes) {
  const sign = minutes >= 0 ? '+' : '-';
  const absolute = Math.abs(minutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
  const remainder = String(absolute % 60).padStart(2, '0');
  return `${sign}${hours}:${remainder}`;
}

export function createFlightTurnClock({
  now = new Date(),
  timeZone = process.env.FLIGHT_AGENT_TIMEZONE ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    'UTC',
} = {}) {
  const instant = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(instant.getTime())) {
    throw new Error('now must be a valid date or timestamp.');
  }

  let parts;
  try {
    parts = formatterParts(instant, timeZone);
  } catch {
    timeZone = 'UTC';
    parts = formatterParts(instant, timeZone);
  }

  const localDate = [parts.year, parts.month, parts.day]
    .map((value, index) => (index === 0 ? String(value) : String(value).padStart(2, '0')))
    .join('-');
  const localTime = [parts.hour, parts.minute, parts.second]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
  const representedUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const instantAtSecond = Math.floor(instant.getTime() / 1000) * 1000;
  const offsetMinutes = Math.round((representedUtcMs - instantAtSecond) / 60000);

  return Object.freeze({
    localDate,
    localDateTime: `${localDate}T${localTime}${formatOffset(offsetMinutes)}`,
    timeZone,
  });
}

  


