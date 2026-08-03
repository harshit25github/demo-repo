import { createFlightTurnClock, parseIsoDate } from './flightDateTime.js';
import { ensureFlightRuntimeContext } from './flightContext.js';
import { buildPricePredictionDateIntent } from './pricePredictionDateIntent.js';

const PRICE_PREDICTION_FALLBACK_STATUSES = new Set([
  'NO_PREDICTIONS',
  'ERROR',
  'DATE_RANGE_EXCEEDED',
]);

function getFlightState(context) {
  return ensureFlightRuntimeContext(context).flight;
}

function createDateIntentFromExistingSearch(existingSearch, clock) {
  const outboundDate = parseIsoDate(existingSearch?.outbound_date);
  if (!outboundDate) {
    return null;
  }

  const returnDate = parseIsoDate(existingSearch?.return_date);
  return {
    status: 'RESOLVED',
    kind: 'exact',
    range: {
      startDate: existingSearch.outbound_date,
      endDate: existingSearch.outbound_date,
    },
    searchDate: existingSearch.outbound_date,
    returnDate: returnDate ? existingSearch.return_date : null,
    priceFallbackDate: existingSearch.outbound_date,
    timeZone: clock.timeZone,
    resolvedFromDate: clock.localDate,
    assumptionLabel: `Existing exact travel date ${existingSearch.outbound_date}.`,
    state: 'used',
    stale: false,
  };
}

function markPastDateIntentStale(dateIntent, localDate) {
  if (!dateIntent?.searchDate || dateIntent.searchDate >= localDate) {
    return dateIntent;
  }

  return {
    ...dateIntent,
    status: 'INVALID_INTENT',
    searchDate: null,
    returnDate: null,
    assumptionLabel: 'The previously resolved travel date is now in the past.',
    state: 'stale',
    stale: true,
  };
}

export function prepareFlightDateContextForTurn(
  context,
  { now = new Date(), timeZone, requestId, existingSearch = {} } = {},
) {
  const appContext = ensureFlightRuntimeContext(context);
  const flightState = appContext.flight;
  const clock = createFlightTurnClock({ now, timeZone });

  flightState.clock = clock;
  flightState.dateRouting = {
    requestId: requestId || appContext.requestId || null,
    pricePredictionStatus: null,
    priceFallbackDate: null,
    fallbackSearchAttempted: false,
  };
  flightState.pricePredictionDateIntent = null;

  if (!flightState.dateIntent) {
    const hydratedDateIntent = createDateIntentFromExistingSearch(existingSearch, clock);
    if (hydratedDateIntent) {
      flightState.dateIntent = hydratedDateIntent;
    }
  }
  if (flightState.dateIntent) {
    flightState.dateIntent = markPastDateIntentStale(
      flightState.dateIntent,
      clock.localDate,
    );
  }

  return flightState;
}

export function storeResolvedFlightDateIntent(context, dateIntent) {
  const flightState = getFlightState(context);
  flightState.dateIntent = dateIntent;
  flightState.pricePredictionDateIntent = null;
  return dateIntent;
}

export function preparePricePredictionDateContext(context) {
  const flightState = getFlightState(context);
  const pricePredictionDateIntent = buildPricePredictionDateIntent(
    flightState.dateIntent,
    { clock: flightState.clock },
  );

  flightState.pricePredictionDateIntent = pricePredictionDateIntent;
  return pricePredictionDateIntent;
}

export function markFlightDateIntentUsed(context, searchInput = {}) {
  const appContext = ensureFlightRuntimeContext(context);
  const flightState = appContext.flight;
  const outboundDate = searchInput.onds?.[0]?.outbound_date || null;
  const returnDate = searchInput.onds?.[0]?.return_date || null;
  if (!outboundDate) {
    return null;
  }

  const existing = flightState.dateIntent;
  if (existing?.searchDate === outboundDate) {
    flightState.dateIntent = {
      ...existing,
      status: 'RESOLVED',
      returnDate: returnDate || existing.returnDate || null,
      state: 'used',
      stale: false,
      usedAtRequestId: appContext.requestId || null,
    };
  } else {
    flightState.dateIntent = {
      status: 'RESOLVED',
      kind: 'exact',
      range: { startDate: outboundDate, endDate: outboundDate },
      searchDate: outboundDate,
      returnDate,
      priceFallbackDate: outboundDate,
      timeZone: flightState.clock?.timeZone || 'UTC',
      resolvedFromDate: flightState.clock?.localDate || null,
      assumptionLabel: `Exact travel date ${outboundDate}.`,
      state: 'used',
      stale: false,
      usedAtRequestId: appContext.requestId || null,
    };
  }

  return flightState.dateIntent;
}

export function recordPricePredictionForTurn(context, result) {
  const appContext = ensureFlightRuntimeContext(context);
  const flightState = appContext.flight;
  const routing = flightState.dateRouting;

  flightState.lastPricePrediction = result;
  if (!routing || routing.requestId !== (appContext.requestId || null)) {
    return;
  }

  routing.pricePredictionStatus = result?.status || 'ERROR';
  routing.priceFallbackDate =
    flightState.dateIntent?.priceFallbackDate ||
    flightState.pricePredictionDateIntent?.fallbackDate ||
    null;
}

export function claimPricePredictionFallbackSearch(context) {
  const appContext = ensureFlightRuntimeContext(context);
  const routing = appContext.flight.dateRouting;

  if (
    !routing ||
    routing.requestId !== (appContext.requestId || null) ||
    !PRICE_PREDICTION_FALLBACK_STATUSES.has(routing.pricePredictionStatus) ||
    !routing.priceFallbackDate
  ) {
    return { allowed: true, isFallback: false };
  }

  if (routing.fallbackSearchAttempted) {
    return { allowed: false, isFallback: true };
  }

  routing.fallbackSearchAttempted = true;
  return { allowed: true, isFallback: true };
}

export function getFlightDateRouting(context) {
  return context?.flight?.dateRouting || null;
}

// Backward-compatible name and return value for callers migrating from the
// old resolver-owned lifecycle.
export function prepareFlightDateTurn(context, options) {
  return prepareFlightDateContextForTurn(context, options).clock;
}
