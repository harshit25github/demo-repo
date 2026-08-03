import {
  addDays,
  dateLimitsFromLocalDate,
  getPricePredictionDateLimits,
  parseIsoDate,
  PRICE_PREDICTION_WINDOW_DAYS,
  toIsoDate,
} from './flightDateTime.js';

function intersectRanges(left, right) {
  if (!left || !right) {
    return null;
  }

  const startDate = left.startDate > right.startDate ? left.startDate : right.startDate;
  const endDate = left.endDate < right.endDate ? left.endDate : right.endDate;
  return startDate <= endDate ? { startDate, endDate } : null;
}

function firstMidweekDate(range) {
  const startDate = parseIsoDate(range?.startDate);
  const endDate = parseIsoDate(range?.endDate);
  if (!startDate || !endDate || startDate > endDate) {
    return null;
  }

  for (let candidate = startDate; candidate <= endDate; candidate = addDays(candidate, 1)) {
    if (candidate.getUTCDay() === 2 || candidate.getUTCDay() === 3) {
      return toIsoDate(candidate);
    }
  }

  return range.startDate;
}

function predictionLimits({ clock, now = new Date() } = {}) {
  if (parseIsoDate(clock?.localDate)) {
    return dateLimitsFromLocalDate(clock.localDate, PRICE_PREDICTION_WINDOW_DAYS);
  }
  return getPricePredictionDateLimits(now);
}

export function buildPricePredictionDateIntent(
  resolvedDateIntent,
  { clock = null, now = new Date() } = {},
) {
  const limits = predictionLimits({ clock, now });
  const predictionWindow = {
    startDate: limits.todayString,
    endDate: limits.maxDateString,
  };

  if (!resolvedDateIntent || resolvedDateIntent.state === 'stale') {
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

  const requestedRange = resolvedDateIntent.range ||
    (resolvedDateIntent.searchDate
      ? {
          startDate: resolvedDateIntent.searchDate,
          endDate: resolvedDateIntent.searchDate,
        }
      : null);
  const effectiveRange = requestedRange
    ? intersectRanges(requestedRange, predictionWindow)
    : predictionWindow;
  const rangeOutsidePredictionWindow = Boolean(requestedRange && !effectiveRange);
  const rangePartiallyOutsidePredictionWindow = Boolean(
    requestedRange &&
      effectiveRange &&
      (requestedRange.startDate < predictionWindow.startDate ||
        requestedRange.endDate > predictionWindow.endDate),
  );
  const rangeOutsideReason = rangeOutsidePredictionWindow
    ? requestedRange.endDate < predictionWindow.startDate
      ? 'past'
      : 'beyond_window'
    : null;
  const fallbackRange =
    effectiveRange ||
    (rangeOutsideReason === 'past' ? predictionWindow : requestedRange) ||
    predictionWindow;
  const fallbackEligible = resolvedDateIntent.status !== 'OUTSIDE_SEARCH_WINDOW';

  return {
    kind: resolvedDateIntent.kind || 'flexible',
    shouldUsePredictionFirst: true,
    reason: 'explicit_price_intelligence',
    exactDate:
      resolvedDateIntent.kind === 'exact' ? resolvedDateIntent.searchDate || null : null,
    predictionWindow,
    requestedRange,
    effectiveRange,
    rangeOutsidePredictionWindow,
    rangePartiallyOutsidePredictionWindow,
    rangeOutsideReason,
    fallbackDate: fallbackEligible
      ? resolvedDateIntent.priceFallbackDate || firstMidweekDate(fallbackRange)
      : null,
  };
}

// Compatibility export: callers now pass a resolved structured date intent, never raw user text.
export function analyzePricePredictionDateIntent(resolvedDateIntent, options = {}) {
  if (typeof resolvedDateIntent === 'string') {
    return buildPricePredictionDateIntent(null, options);
  }
  return buildPricePredictionDateIntent(resolvedDateIntent, options);
}

export function buildPricePredictionDateIntentSummary(intent) {
  if (!intent || intent.kind === 'none') {
    return 'none';
  }

  return [
    `kind=${intent.kind}`,
    `fixedToolWindow=${intent.predictionWindow.startDate}..${intent.predictionWindow.endDate}`,
    `requestedPreference=${intent.requestedRange ? `${intent.requestedRange.startDate}..${intent.requestedRange.endDate}` : 'full prediction window'}`,
    `effectivePreference=${intent.effectiveRange ? `${intent.effectiveRange.startDate}..${intent.effectiveRange.endDate}` : 'none'}`,
    `outsideWindow=${intent.rangeOutsidePredictionWindow ? 'yes' : 'no'}`,
    `partiallyOutsideWindow=${intent.rangePartiallyOutsidePredictionWindow ? 'yes' : 'no'}`,
    `priceFallbackDate=${intent.fallbackDate || 'none'}`,
  ].join('; ');
}
