import {
  createFlightTurnClock,
  dateLimitsFromLocalDate,
  FLIGHT_SEARCH_WINDOW_DAYS,
  PRICE_PREDICTION_WINDOW_DAYS,
} from './flightDateTime.js';

export function buildFlightDateIntentSummary(dateIntent) {
  if (!dateIntent) {
    return 'none';
  }

  return [
    `status=${dateIntent.status || 'unknown'}`,
    `kind=${dateIntent.kind || 'unknown'}`,
    `state=${dateIntent.state || 'unknown'}`,
    `range=${dateIntent.range ? `${dateIntent.range.startDate}..${dateIntent.range.endDate}` : 'none'}`,
    `searchDate=${dateIntent.searchDate || 'none'}`,
    `returnDate=${dateIntent.returnDate || 'none'}`,
    `priceFallbackDate=${dateIntent.priceFallbackDate || 'none'}`,
    `assumption=${dateIntent.assumptionLabel || 'none'}`,
  ].join('; ');
}

export function buildFlightDatePromptContext(context = {}) {
  const clock = context.flight?.clock || createFlightTurnClock();
  const predictionWindow = dateLimitsFromLocalDate(
    clock.localDate,
    PRICE_PREDICTION_WINDOW_DAYS,
  );
  const searchWindow = dateLimitsFromLocalDate(
    clock.localDate,
    FLIGHT_SEARCH_WINDOW_DAYS,
  );

  return {
    clock,
    predictionWindow: {
      startDate: predictionWindow.todayString,
      endDate: predictionWindow.maxDateString,
    },
    searchWindow: {
      startDate: searchWindow.todayString,
      endDate: searchWindow.maxDateString,
    },
    dateIntentSummary: buildFlightDateIntentSummary(context.flight?.dateIntent),
  };
}

export function buildFlightDateDynamicPromptContext(context = {}) {
  const dateContext = buildFlightDatePromptContext(context);
  return [
    `- Immutable turn clock: localDate=${dateContext.clock.localDate}; localDateTime=${dateContext.clock.localDateTime}; timeZone=${dateContext.clock.timeZone}.`,
    `- Current price prediction window: ${dateContext.predictionWindow.startDate} through ${dateContext.predictionWindow.endDate}, inclusive.`,
    `- Current flight-search booking window: ${dateContext.searchWindow.startDate} through ${dateContext.searchWindow.endDate}, inclusive.`,
    `- Durable resolved date intent: ${dateContext.dateIntentSummary}`,
  ].join('\n');
}

