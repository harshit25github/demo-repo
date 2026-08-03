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
