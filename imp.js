import { tool } from '@openai/agents';
import { z } from 'zod';
import { log } from '../logger.js';
import { ClickHousePricePredictionRepository } from './pricePredictionRepository.js';

// Replace this placeholder with your configured ClickHouse client.
export const clickHouseClient = {
  async query() {
    return [];
  },
};

const defaultPricePredictionRepository = new ClickHousePricePredictionRepository({
  client: clickHouseClient,
});

export const PRICE_PREDICTION_TOOL_NAME = 'price_prediction_tool';
export const PRICE_PREDICTION_WINDOW_DAYS = 89;
const DAY_MS = 24 * 60 * 60 * 1000;

export const pricePredictionInputSchema = z.object({
  originCity: z.string().describe('Required three-letter origin IATA code.'),
  destinationCity: z.string().describe('Required three-letter destination IATA code.'),
  startDate: z.string().describe('Required outbound range start in YYYY-MM-DD format.'),
  endDate: z.string().describe('Required outbound range end in YYYY-MM-DD format.'),
  tripType: z
    .enum(['oneway', 'roundtrip'])
    .nullish()
    .describe('Trip type. Pass null or omit for one-way.'),
  returnStartDate: z
    .string()
    .nullish()
    .describe('Required round-trip return range start, otherwise null.'),
  returnEndDate: z
    .string()
    .nullish()
    .describe('Required round-trip return range end, otherwise null.'),
  tripDuration: z
    .number()
    .int()
    .positive()
    .nullish()
    .describe('Optional preferred round-trip duration in days.'),
  tripDurationFlexibility: z
    .number()
    .int()
    .min(0)
    .nullish()
    .describe('Optional plus/minus trip-duration flexibility in days.'),
});

function startOfUtcDay(value) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addDays(value, days) {
  return new Date(value.getTime() + days * DAY_MS);
}

function toIsoDate(value) {
  return value.toISOString().slice(0, 10);
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

function differenceInDays(laterDate, earlierDate) {
  return Math.round((laterDate.getTime() - earlierDate.getTime()) / DAY_MS);
}

function normalizeIata(value) {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

export function getPricePredictionDateLimits(now = new Date()) {
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

function searchedDateRangeFromInput(input = {}) {
  return {
    startDate: input.startDate || null,
    endDate: input.endDate || null,
    returnStartDate: input.returnStartDate || null,
    returnEndDate: input.returnEndDate || null,
  };
}

function failureResult({
  status,
  message,
  input = {},
  source = 'validation',
  missingFields = [],
  limits = getPricePredictionDateLimits(),
}) {
  return {
    ok: false,
    status,
    source,
    route: {
      originCity: normalizeIata(input.originCity),
      destinationCity: normalizeIata(input.destinationCity),
    },
    tripType: input.tripType === 'roundtrip' ? 'roundtrip' : 'oneway',
    searchedDateRange: searchedDateRangeFromInput(input),
    predictionWindow: {
      today: limits.todayString,
      maxDate: limits.maxDateString,
      daysAhead: PRICE_PREDICTION_WINDOW_DAYS,
    },
    predictions: [],
    cheapestDates: [],
    cheapestCombinations: [],
    priceRangeSummary: null,
    recommendation: message,
    formattedResponse: message,
    message,
    ...(missingFields.length > 0 ? { missingFields } : {}),
  };
}

export function validatePricePredictionInput(input = {}, { now = new Date() } = {}) {
  const limits = getPricePredictionDateLimits(now);
  const missingFields = ['originCity', 'destinationCity', 'startDate', 'endDate'].filter(
    (field) => typeof input[field] !== 'string' || !input[field].trim(),
  );
  const tripType = input.tripType || 'oneway';

  if (tripType === 'roundtrip') {
    for (const field of ['returnStartDate', 'returnEndDate']) {
      if (typeof input[field] !== 'string' || !input[field].trim()) {
        missingFields.push(field);
      }
    }
  }

  if (missingFields.length > 0) {
    return {
      ok: false,
      result: failureResult({
        status: 'INVALID_INPUT',
        message: `Missing required price prediction fields: ${missingFields.join(', ')}.`,
        input,
        missingFields,
        limits,
      }),
    };
  }

  const originCity = normalizeIata(input.originCity);
  const destinationCity = normalizeIata(input.destinationCity);
  if (!originCity || !destinationCity) {
    return {
      ok: false,
      result: failureResult({
        status: 'INVALID_INPUT',
        message: 'Origin and destination must be valid three-letter IATA codes.',
        input,
        limits,
      }),
    };
  }

  if (!['oneway', 'roundtrip'].includes(tripType)) {
    return {
      ok: false,
      result: failureResult({
        status: 'INVALID_INPUT',
        message: 'tripType must be oneway or roundtrip.',
        input,
        limits,
      }),
    };
  }

  const startDate = parseIsoDate(input.startDate);
  const endDate = parseIsoDate(input.endDate);
  const returnStartDate =
    tripType === 'roundtrip' ? parseIsoDate(input.returnStartDate) : null;
  const returnEndDate =
    tripType === 'roundtrip' ? parseIsoDate(input.returnEndDate) : null;

  if (
    !startDate ||
    !endDate ||
    (tripType === 'roundtrip' && (!returnStartDate || !returnEndDate))
  ) {
    return {
      ok: false,
      result: failureResult({
        status: 'INVALID_DATE_RANGE',
        message: 'Prediction dates must be valid calendar dates in YYYY-MM-DD format.',
        input,
        limits,
      }),
    };
  }

  if (startDate < limits.today) {
    return {
      ok: false,
      result: failureResult({
        status: 'INVALID_DATE_RANGE',
        message: 'The outbound start date cannot be in the past.',
        input,
        limits,
      }),
    };
  }

  if (startDate > endDate) {
    return {
      ok: false,
      result: failureResult({
        status: 'INVALID_DATE_RANGE',
        message: 'The outbound start date must be on or before the outbound end date.',
        input,
        limits,
      }),
    };
  }

  const requestedDates = [startDate, endDate, returnStartDate, returnEndDate].filter(Boolean);
  if (requestedDates.some((date) => date > limits.maxDate)) {
    return {
      ok: false,
      result: failureResult({
        status: 'DATE_RANGE_EXCEEDED',
        message: `Price prediction is available only through ${limits.maxDateString}.`,
        input,
        limits,
      }),
    };
  }

  if (tripType === 'roundtrip') {
    if (returnStartDate > returnEndDate) {
      return {
        ok: false,
        result: failureResult({
          status: 'INVALID_DATE_RANGE',
          message: 'The return start date must be on or before the return end date.',
          input,
          limits,
        }),
      };
    }
    if (returnStartDate < startDate) {
      return {
        ok: false,
        result: failureResult({
          status: 'INVALID_DATE_RANGE',
          message: 'The return date range cannot begin before the outbound date range.',
          input,
          limits,
        }),
      };
    }
  }

  const tripDuration = input.tripDuration ?? null;
  const tripDurationFlexibility = input.tripDurationFlexibility ?? null;
  if (tripDuration !== null && (!Number.isInteger(tripDuration) || tripDuration < 1)) {
    return {
      ok: false,
      result: failureResult({
        status: 'INVALID_INPUT',
        message: 'tripDuration must be a positive whole number of days.',
        input,
        limits,
      }),
    };
  }
  if (
    tripDurationFlexibility !== null &&
    (!Number.isInteger(tripDurationFlexibility) || tripDurationFlexibility < 0)
  ) {
    return {
      ok: false,
      result: failureResult({
        status: 'INVALID_INPUT',
        message: 'tripDurationFlexibility must be zero or a positive whole number.',
        input,
        limits,
      }),
    };
  }
  if (tripDurationFlexibility !== null && tripDuration === null) {
    return {
      ok: false,
      result: failureResult({
        status: 'INVALID_INPUT',
        message: 'tripDuration is required when tripDurationFlexibility is provided.',
        input,
        limits,
      }),
    };
  }

  return {
    ok: true,
    value: {
      originCity,
      destinationCity,
      startDate: toIsoDate(startDate),
      endDate: toIsoDate(endDate),
      tripType,
      returnStartDate: returnStartDate ? toIsoDate(returnStartDate) : null,
      returnEndDate: returnEndDate ? toIsoDate(returnEndDate) : null,
      tripDuration,
      tripDurationFlexibility: tripDurationFlexibility ?? 0,
      parsedDates: { startDate, endDate, returnStartDate, returnEndDate },
      limits,
    },
  };
}

function parseJsonField(value, fieldName) {
  if (value && typeof value === 'object') {
    return value;
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} was missing from the prediction row.`);
  }
  return JSON.parse(value);
}

function finiteNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') {
      continue;
    }
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function parseThresholds(rawThresholds) {
  const thresholds = parseJsonField(rawThresholds, 'Thresholds');
  const lowerLimit = finiteNumber(
    thresholds.LowerLimit,
    thresholds.lowerLimit,
    thresholds.lower_limit,
    thresholds.lower,
  );
  const upperLimit = finiteNumber(
    thresholds.UpperLimit,
    thresholds.upperLimit,
    thresholds.upper_limit,
    thresholds.upper,
  );

  if (lowerLimit === null || upperLimit === null || lowerLimit > upperLimit) {
    throw new Error('Thresholds did not contain valid lower and upper limits.');
  }

  return { lowerLimit, upperLimit };
}

function extractPredictedPrice(value) {
  if (value && typeof value === 'object') {
    return finiteNumber(
      value.PredictedPrice,
      value.predictedPrice,
      value.Price,
      value.price,
      value.Amount,
      value.amount,
    );
  }
  return finiteNumber(value);
}

export function classifyPredictedPrice(price, thresholds) {
  if (price <= thresholds.lowerLimit) {
    return { priceBucket: 'LOW', priceLevel: 'low', dealLabel: 'great deal' };
  }
  if (price <= thresholds.upperLimit) {
    return { priceBucket: 'MEDIUM', priceLevel: 'medium', dealLabel: 'fair price' };
  }
  return { priceBucket: 'HIGH', priceLevel: 'high', dealLabel: 'premium' };
}

function isDateWithin(date, startDate, endDate) {
  return date >= startDate && date <= endDate;
}

function parseOneWayPredictions(tripPredictions, validated, thresholds, currency) {
  const predictions = [];
  for (const [departureDateText, rawPrice] of Object.entries(tripPredictions || {})) {
    const departureDate = parseIsoDate(departureDateText);
    const predictedPrice = extractPredictedPrice(rawPrice);
    if (
      !departureDate ||
      predictedPrice === null ||
      !isDateWithin(
        departureDate,
        validated.parsedDates.startDate,
        validated.parsedDates.endDate,
      )
    ) {
      continue;
    }

    predictions.push({
      departureDate: departureDateText,
      predictedPrice,
      currency,
      ...classifyPredictedPrice(predictedPrice, thresholds),
    });
  }

  return predictions.sort((left, right) =>
    left.departureDate.localeCompare(right.departureDate),
  );
}

function parseRoundTripPredictions(tripPredictions, validated, thresholds, currency) {
  const predictions = [];
  const minDuration = validated.tripDuration
    ? Math.max(1, validated.tripDuration - validated.tripDurationFlexibility)
    : null;
  const maxDuration = validated.tripDuration
    ? validated.tripDuration + validated.tripDurationFlexibility
    : null;

  for (const [outboundDateText, returnEntries] of Object.entries(tripPredictions || {})) {
    const outboundDate = parseIsoDate(outboundDateText);
    if (
      !outboundDate ||
      !isDateWithin(
        outboundDate,
        validated.parsedDates.startDate,
        validated.parsedDates.endDate,
      ) ||
      !returnEntries ||
      typeof returnEntries !== 'object'
    ) {
      continue;
    }

    for (const [returnDateText, rawPrice] of Object.entries(returnEntries)) {
      const returnDate = parseIsoDate(returnDateText);
      const predictedPrice = extractPredictedPrice(rawPrice);
      if (
        !returnDate ||
        returnDate < outboundDate ||
        predictedPrice === null ||
        !isDateWithin(
          returnDate,
          validated.parsedDates.returnStartDate,
          validated.parsedDates.returnEndDate,
        )
      ) {
        continue;
      }

      const tripDuration = differenceInDays(returnDate, outboundDate);
      if (
        minDuration !== null &&
        (tripDuration < minDuration || tripDuration > maxDuration)
      ) {
        continue;
      }

      predictions.push({
        outboundDate: outboundDateText,
        returnDate: returnDateText,
        tripDuration,
        predictedPrice,
        currency,
        ...classifyPredictedPrice(predictedPrice, thresholds),
      });
    }
  }

  return predictions.sort(
    (left, right) =>
      left.outboundDate.localeCompare(right.outboundDate) ||
      left.returnDate.localeCompare(right.returnDate),
  );
}

function buildPriceRangeSummary(predictions, thresholds, currency) {
  const prices = predictions.map((prediction) => prediction.predictedPrice);
  const total = prices.reduce((sum, price) => sum + price, 0);
  return {
    currency,
    minimumPrice: Math.min(...prices),
    maximumPrice: Math.max(...prices),
    averagePrice: Number((total / prices.length).toFixed(2)),
    lowerThreshold: thresholds.lowerLimit,
    upperThreshold: thresholds.upperLimit,
    lowCount: predictions.filter((prediction) => prediction.priceBucket === 'LOW').length,
    mediumCount: predictions.filter((prediction) => prediction.priceBucket === 'MEDIUM').length,
    highCount: predictions.filter((prediction) => prediction.priceBucket === 'HIGH').length,
  };
}

function formatPrice(amount, currency) {
  if (!currency) {
    return String(amount);
  }
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

function buildRecommendation(tripType, cheapestOption) {
  const price = formatPrice(cheapestOption.predictedPrice, cheapestOption.currency);
  if (tripType === 'roundtrip') {
    return `The lowest predicted round-trip fare is ${price} for ${cheapestOption.outboundDate} to ${cheapestOption.returnDate}, classified as ${cheapestOption.dealLabel}.`;
  }
  return `The lowest predicted one-way fare is ${price} on ${cheapestOption.departureDate}, classified as ${cheapestOption.dealLabel}.`;
}

function buildFormattedResponse(tripType, cheapestOptions) {
  const lines = cheapestOptions.map((option, index) => {
    const price = formatPrice(option.predictedPrice, option.currency);
    const dates =
      tripType === 'roundtrip'
        ? `${option.outboundDate} to ${option.returnDate}`
        : option.departureDate;
    return `${index === 0 ? '**Best:**' : '-'} ${dates} - ${price} (${option.dealLabel})`;
  });
  return `${lines.join('\n')}\nSearch flights for one of these dates?`;
}

function rankCheapestOptions(predictions) {
  return [...predictions]
    .sort(
      (left, right) =>
        left.predictedPrice - right.predictedPrice ||
        (left.departureDate || left.outboundDate).localeCompare(
          right.departureDate || right.outboundDate,
        ),
    )
    .slice(0, 3);
}

function successfulResult({ validated, row, predictions, thresholds, source }) {
  const cheapestOptions = rankCheapestOptions(predictions);
  const recommendation = buildRecommendation(validated.tripType, cheapestOptions[0]);

  return {
    ok: true,
    status: 'SUCCESS',
    source,
    dataAsOf: row.SearchDate || validated.limits.yesterdayString,
    route: {
      originCity: validated.originCity,
      destinationCity: validated.destinationCity,
    },
    tripType: validated.tripType,
    searchedDateRange: {
      startDate: validated.startDate,
      endDate: validated.endDate,
      returnStartDate: validated.returnStartDate,
      returnEndDate: validated.returnEndDate,
    },
    tripDuration: validated.tripDuration,
    tripDurationFlexibility:
      validated.tripDuration === null ? null : validated.tripDurationFlexibility,
    predictionCount: predictions.length,
    predictions,
    cheapestDates: validated.tripType === 'oneway' ? cheapestOptions : [],
    cheapestCombinations: validated.tripType === 'roundtrip' ? cheapestOptions : [],
    priceRangeSummary: buildPriceRangeSummary(predictions, thresholds, row.Currency || null),
    recommendation,
    formattedResponse: buildFormattedResponse(validated.tripType, cheapestOptions),
    message: 'Price predictions returned successfully.',
  };
}

function generalFallbackForIntent(dateIntent) {
  if (!dateIntent?.fallbackDate) {
    return null;
  }
  return {
    date: dateIntent.fallbackDate,
    basis: 'midweek general guidance',
    isPredicted: false,
    message: `${dateIntent.fallbackDate} is a midweek starting point based on general guidance, not a predicted fare.`,
  };
}

function resultWithIntentFallback(result, dateIntent, { status, message } = {}) {
  const generalFallback = generalFallbackForIntent(dateIntent);
  const fallbackMessage = generalFallback
    ? `${message || result.message} ${generalFallback.message}`
    : message || result.message;

  return {
    ...result,
    ok: false,
    status: status || result.status,
    dateIntent,
    predictions: [],
    predictionCount: 0,
    cheapestDates: [],
    cheapestCombinations: [],
    priceRangeSummary: null,
    recommendation: fallbackMessage,
    formattedResponse: fallbackMessage,
    message: fallbackMessage,
    generalFallback,
  };
}

export function normalizePricePredictionInputForDateIntent(input = {}, dateIntent) {
  if (!dateIntent?.shouldUsePredictionFirst || !dateIntent.predictionWindow) {
    return { ...input };
  }

  const normalized = {
    ...input,
    startDate: dateIntent.predictionWindow.startDate,
    endDate: dateIntent.predictionWindow.endDate,
  };
  if (input.tripType === 'roundtrip') {
    normalized.returnStartDate = dateIntent.predictionWindow.startDate;
    normalized.returnEndDate = dateIntent.predictionWindow.endDate;
  }
  return normalized;
}

export function applyPricePredictionDateIntent(result, dateIntent) {
  if (!dateIntent?.shouldUsePredictionFirst) {
    return result;
  }

  if (result.status === 'INVALID_INPUT' || result.status === 'INVALID_DATE_RANGE') {
    return { ...result, dateIntent };
  }

  if (dateIntent.rangeOutsidePredictionWindow) {
    const isPastRange = dateIntent.rangeOutsideReason === 'past';
    return resultWithIntentFallback(result, dateIntent, {
      status: isPastRange ? 'INVALID_DATE_RANGE' : 'DATE_RANGE_EXCEEDED',
      message: isPastRange
        ? `The requested date range is before the prediction window starting ${dateIntent.predictionWindow.startDate}. I can still run a normal flight search for a future date.`
        : `The requested dates are outside the prediction window ending ${dateIntent.predictionWindow.endDate}. I can still run a normal flight search for a preferred date.`,
    });
  }

  if (result.status !== 'SUCCESS') {
    if (result.status === 'NO_PREDICTIONS' || result.status === 'ERROR') {
      return resultWithIntentFallback(result, dateIntent);
    }
    return { ...result, dateIntent };
  }

  if (!dateIntent.requestedRange) {
    return { ...result, dateIntent, generalFallback: null };
  }

  const effectiveRange = dateIntent.effectiveRange;
  const matchingPredictions = result.predictions.filter((prediction) => {
    const departureDate = prediction.departureDate || prediction.outboundDate;
    return (
      effectiveRange &&
      departureDate >= effectiveRange.startDate &&
      departureDate <= effectiveRange.endDate
    );
  });

  if (matchingPredictions.length === 0) {
    return resultWithIntentFallback(result, dateIntent, {
      status: 'NO_PREDICTIONS',
      message: 'No prediction data matched the requested month or date range. I can still run a normal flight search.',
    });
  }

  const cheapestOptions = rankCheapestOptions(matchingPredictions);
  const preferenceNotice = dateIntent.rangePartiallyOutsidePredictionWindow
    ? `Predictions are available only through ${dateIntent.predictionWindow.endDate}; dates after that limit were excluded.`
    : null;
  const thresholds = {
    lowerLimit: result.priceRangeSummary.lowerThreshold,
    upperLimit: result.priceRangeSummary.upperThreshold,
  };

  const recommendation = buildRecommendation(result.tripType, cheapestOptions[0]);
  const formattedResponse = buildFormattedResponse(result.tripType, cheapestOptions);

  return {
    ...result,
    dateIntent,
    allPredictionCount: result.predictionCount,
    predictionCount: matchingPredictions.length,
    predictions: matchingPredictions,
    cheapestDates: result.tripType === 'oneway' ? cheapestOptions : [],
    cheapestCombinations: result.tripType === 'roundtrip' ? cheapestOptions : [],
    priceRangeSummary: buildPriceRangeSummary(
      matchingPredictions,
      thresholds,
      result.priceRangeSummary.currency,
    ),
    recommendation: preferenceNotice
      ? `${recommendation} ${preferenceNotice}`
      : recommendation,
    formattedResponse: preferenceNotice
      ? formattedResponse.replace(
          '\nSearch flights for one of these dates?',
          `\n${preferenceNotice}\nSearch flights for one of these dates?`,
        )
      : formattedResponse,
    preferenceNotice,
    generalFallback: null,
  };
}

export async function getPricePrediction(
  input = {},
  { repository, now = new Date(), dateIntent = null } = {},
) {
  const effectiveInput = normalizePricePredictionInputForDateIntent(input, dateIntent);
  const validation = validatePricePredictionInput(effectiveInput, { now });
  if (!validation.ok) {
    return applyPricePredictionDateIntent(validation.result, dateIntent);
  }

  const validated = validation.value;
  const activeRepository = repository || defaultPricePredictionRepository;

  try {
    const row = await activeRepository.findCityPrediction({
      searchDate: validated.limits.yesterdayString,
      originCity: validated.originCity,
      destinationCity: validated.destinationCity,
      isRoundTrip: validated.tripType === 'roundtrip',
    });

    if (!row) {
      return applyPricePredictionDateIntent(failureResult({
        status: 'NO_PREDICTIONS',
        message: 'Price prediction is unavailable for this route and date range. I can still search your preferred dates.',
        input: validated,
        source: activeRepository.source || 'repository',
        limits: validated.limits,
      }), dateIntent);
    }

    const thresholds = parseThresholds(row.Thresholds);
    const tripPredictions = parseJsonField(row.TripPredictions, 'TripPredictions');
    const currency = row.Currency || null;
    const predictions =
      validated.tripType === 'roundtrip'
        ? parseRoundTripPredictions(tripPredictions, validated, thresholds, currency)
        : parseOneWayPredictions(tripPredictions, validated, thresholds, currency);

    if (predictions.length === 0) {
      return applyPricePredictionDateIntent(failureResult({
        status: 'NO_PREDICTIONS',
        message: 'No price predictions were available inside the requested date range. I can still search your preferred dates.',
        input: validated,
        source: activeRepository.source || 'repository',
        limits: validated.limits,
      }), dateIntent);
    }

    return applyPricePredictionDateIntent(successfulResult({
      validated,
      row,
      predictions,
      thresholds,
      source: activeRepository.source || 'repository',
    }), dateIntent);
  } catch (error) {
    log('error', 'price_prediction_tool.repository_error', {
      errorName: error?.name,
    });
    return applyPricePredictionDateIntent(failureResult({
      status: 'ERROR',
      message: 'Price prediction could not be loaded right now. I can still search your preferred dates.',
      input: validated,
      source: activeRepository.source || 'repository',
      limits: validated.limits,
    }), dateIntent);
  }
}

function schemaErrorOutput() {
  return JSON.stringify(
    failureResult({
      status: 'INVALID_INPUT',
      message: 'The price prediction request is missing required fields or contains invalid values.',
    }),
  );
}

export const PricePredictionTool = tool({
  name: PRICE_PREDICTION_TOOL_NAME,
  description:
    'Return one-way or round-trip price predictions for month-only, relative-month, date-range, flexible-date, cheapest-date, best-date, low-fare-date, and best-time-to-fly requests. Flexible calls use the complete today-through-today-plus-89-days window before preference filtering.',
  parameters: pricePredictionInputSchema,
  strict: true,
  errorFunction: schemaErrorOutput,
  async execute(input, runContext) {
    const appContext = runContext?.context || {};
    const dateIntent = appContext.flight?.pricePredictionDateIntent || null;
    const effectiveInput = normalizePricePredictionInputForDateIntent(input, dateIntent);
    const result = await getPricePrediction(effectiveInput, { dateIntent });

    appContext.flight =
      appContext.flight && typeof appContext.flight === 'object' ? appContext.flight : {};
    appContext.flight.lastPricePrediction = result;
    appContext.toolCallLog ||= [];
    appContext.toolCallLog.push({
      tool: PRICE_PREDICTION_TOOL_NAME,
      input: effectiveInput,
      status: result.status,
      ok: result.ok,
      route: result.route,
      predictionCount: result.predictionCount || 0,
      dateIntent: result.dateIntent || null,
    });

    log('info', 'price_prediction_tool.called', {
      requestId: appContext.requestId,
      sessionId: appContext.sessionId,
      status: result.status,
      route: result.route,
      predictionCount: result.predictionCount || 0,
    });

    return result;
  },
});
