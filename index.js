import { tool } from '@openai/agents';
import { z } from 'zod';
import { log } from '../logger.js';

const filterTypeValues = [
  'baggage',
  'departureTime',
  'arrivalTime',
  'stops',
  'totalDuration',
  'layoverDuration',
  'price',
];
const baggageFilterCodes = ['0', '1', '2'];
const timeSlotFilterCodes = ['EARLYMORNING', 'MORNING', 'AFTERNOON', 'EVENING'];
const stopFilterCodes = ['0', '2', '3'];
const apiFilterCodeValues = ['0', '1', '2', '3', ...timeSlotFilterCodes];
const durationFilterTypes = ['totalDuration', 'layoverDuration'];
const apiFilterTypeByToolType = {
  stops: 'stop',
  departureTime: 'departtimeslotfilter',
  arrivalTime: 'departlandtimeslotfilter',
  baggage: 'baggage',
  price: 'price',
  totalDuration: 'departdurationfilter',
  layoverDuration: 'departlayoverfilter',
};
const orderedFilterTypes = [
  'stops',
  'departureTime',
  'arrivalTime',
  'baggage',
  'price',
  'totalDuration',
  'layoverDuration',
];
const durationMaxByType = {
  totalDuration: 2880,
  layoverDuration: 1500,
};

const applyFilterSchema = z.object({
  filters: z
    .array(
      z.object({
        filterType: z
          .enum(filterTypeValues)
          .describe(
            'Filter category: baggage, departureTime, arrivalTime, stops, totalDuration, layoverDuration, or price.',
          ),
        filterCode: z
          .enum(apiFilterCodeValues)
          .nullable()
          .describe(
            'Exact API code for baggage, time, or stops. Use null for duration filters.',
          ),
        minDurationMinutes: z
          .number()
          .int()
          .min(0)
          .max(2880)
          .nullable()
          .describe('Minimum duration in minutes. Use only for duration filters.'),
        maxDurationMinutes: z
          .number()
          .int()
          .min(0)
          .max(2880)
          .nullable()
          .describe('Maximum duration in minutes. Use only for duration filters.'),
        minPrice: z
          .number()
          .min(0)
          .nullable()
          .describe('Minimum price. Use only for price filters.'),
        maxPrice: z
          .number()
          .min(0)
          .nullable()
          .describe('Maximum price. Use only for price filters.'),
        rawUserFilter: z
          .string()
          .nullable()
          .describe('Original user filter text used to map natural language to API codes.'),
      }),
    )
    .min(1)
    .describe('Apply-filter API filters. Each item must use exact API filter codes.'),
});

function getFlightContext(runContext) {
  const appContext = runContext?.context || {};
  appContext.UID ||= 'demo-user';
  appContext.toolCallLog ||= [];
  return appContext;
}

function toSearchText(value) {
  return (value || '').trim().toLowerCase();
}

function durationToMinutes(value, unit) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return null;
  }
  return /m|min|minute/.test(unit || '') ? Math.round(amount) : Math.round(amount * 60);
}

function inferDurationRange(rawUserFilter) {
  const text = toSearchText(rawUserFilter);
  if (!text) {
    return {};
  }

  const durationPattern = '(\\d+(?:\\.\\d+)?)\\s*(hours?|hrs?|h|minutes?|mins?|m)?';
  const rangeMatch = text.match(
    new RegExp(`(?:between|from)\\s+${durationPattern}\\s+(?:and|to|-)\\s+${durationPattern}`),
  );
  if (rangeMatch) {
    return {
      minDurationMinutes: durationToMinutes(rangeMatch[1], rangeMatch[2] || rangeMatch[4]),
      maxDurationMinutes: durationToMinutes(rangeMatch[3], rangeMatch[4] || rangeMatch[2]),
    };
  }

  const maxMatch = text.match(
    new RegExp(
      `(?:under|less than|below|up to|within|max(?:imum)?|at most|no more than)\\s+${durationPattern}`,
    ),
  );
  if (maxMatch) {
    return {
      maxDurationMinutes: durationToMinutes(maxMatch[1], maxMatch[2]),
    };
  }

  const minMatch = text.match(
    new RegExp(
      `(?:over|more than|above|at least|min(?:imum)?)\\s+${durationPattern}`,
    ),
  );
  if (minMatch) {
    return {
      minDurationMinutes: durationToMinutes(minMatch[1], minMatch[2]),
    };
  }

  const plainMatch = text.match(new RegExp(durationPattern));
  if (plainMatch) {
    return {
      maxDurationMinutes: durationToMinutes(plainMatch[1], plainMatch[2]),
    };
  }

  return {};
}

function inferPriceRange(rawUserFilter) {
  const text = toSearchText(rawUserFilter).replace(/,/g, '');
  if (!text) {
    return {};
  }

  const pricePattern =
    '(?:usd|us\\$|\\$|dollars?|bucks?)?\\s*(\\d+(?:\\.\\d+)?)\\s*(?:usd|dollars?|bucks?)?';
  const rangeMatch = text.match(
    new RegExp(`(?:between|from)\\s+${pricePattern}\\s+(?:and|to|-)\\s+${pricePattern}`),
  );
  if (rangeMatch) {
    return {
      minPrice: Number(rangeMatch[1]),
      maxPrice: Number(rangeMatch[2]),
    };
  }

  const hyphenMatch = text.match(new RegExp(`${pricePattern}\\s*-\\s*${pricePattern}`));
  if (hyphenMatch) {
    return {
      minPrice: Number(hyphenMatch[1]),
      maxPrice: Number(hyphenMatch[2]),
    };
  }

  const maxMatch = text.match(
    new RegExp(
      `(?:under|less than|below|up to|within|max(?:imum)?|at most|no more than|cheaper than)\\s+${pricePattern}`,
    ),
  );
  if (maxMatch) {
    return {
      minPrice: 0,
      maxPrice: Number(maxMatch[1]),
    };
  }

  const minMatch = text.match(
    new RegExp(`(?:over|more than|above|at least|min(?:imum)?)\\s+${pricePattern}`),
  );
  if (minMatch) {
    return {
      minPrice: Number(minMatch[1]),
      maxPrice: null,
    };
  }

  return {};
}

function inferFilterCode(filterType, rawUserFilter) {
  const text = toSearchText(rawUserFilter);
  if (!text) {
    return null;
  }

  if (filterType === 'baggage') {
    if (/checked|check[-\s]?in|checkin/.test(text)) {
      return '0';
    }
    if (/carry[-\s]?on|cabin bag|hand baggage/.test(text)) {
      return '1';
    }
    if (/personal item|laptop|handbag|hand bag/.test(text)) {
      return '2';
    }
  }

  if (filterType === 'departureTime' || filterType === 'arrivalTime') {
    if (/early\s*morning/.test(text)) {
      return 'EARLYMORNING';
    }
    if (/afternoon/.test(text)) {
      return 'AFTERNOON';
    }
    if (/evening|night/.test(text)) {
      return 'EVENING';
    }
    if (/morning/.test(text)) {
      return 'MORNING';
    }
  }

  if (filterType === 'stops') {
    if (/non[-\s]?stop|nonstop|direct/.test(text)) {
      return '0';
    }
    if (/one[-\s]?stop|\b1\s*stop\b/.test(text)) {
      return '2';
    }
    if (/1\+|one plus|more stops|multiple stops|multi[-\s]?stop|two[-\s]?stop|2\+/.test(text)) {
      return '3';
    }
  }

  return null;
}

function isAllowedCodeForType(filterType, filterCode) {
  if (filterCode === null) {
    return durationFilterTypes.includes(filterType);
  }
  if (filterType === 'baggage') {
    return baggageFilterCodes.includes(filterCode);
  }
  if (filterType === 'departureTime' || filterType === 'arrivalTime') {
    return timeSlotFilterCodes.includes(filterCode);
  }
  if (filterType === 'stops') {
    return stopFilterCodes.includes(filterCode);
  }
  return false;
}

function normalizeApplyFilter(filters) {
  // Normalize model/tool input into API codes and minute ranges once.
  return filters.map((filter) => {
    if (durationFilterTypes.includes(filter.filterType)) {
      // Duration filters do not use filterCode; payload values are minutes.
      const inferredDuration = inferDurationRange(filter.rawUserFilter);
      return {
        filterType: filter.filterType,
        filterCode: null,
        minDurationMinutes:
          filter.minDurationMinutes ?? inferredDuration.minDurationMinutes ?? null,
        maxDurationMinutes:
          filter.maxDurationMinutes ?? inferredDuration.maxDurationMinutes ?? null,
        minPrice: null,
        maxPrice: null,
        rawUserFilter: filter.rawUserFilter,
      };
    }

    if (filter.filterType === 'price') {
      // Price filters are range filters; final API payload uses [minPrice, maxPrice].
      const inferredPrice = inferPriceRange(filter.rawUserFilter);
      return {
        filterType: filter.filterType,
        filterCode: null,
        minDurationMinutes: null,
        maxDurationMinutes: null,
        minPrice: filter.minPrice ?? inferredPrice.minPrice ?? null,
        maxPrice: filter.maxPrice ?? inferredPrice.maxPrice ?? null,
        rawUserFilter: filter.rawUserFilter,
      };
    }

    // Prefer valid explicit codes; infer from raw text if the model omits them.
    const inferredCode = inferFilterCode(filter.filterType, filter.rawUserFilter);
    const filterCode = isAllowedCodeForType(filter.filterType, filter.filterCode)
      ? filter.filterCode
      : inferredCode;

    return {
      filterType: filter.filterType,
      filterCode,
      minDurationMinutes: null,
      maxDurationMinutes: null,
      minPrice: null,
      maxPrice: null,
      rawUserFilter: filter.rawUserFilter,
    };
  });
}

function hasUsableFilterValue(filter) {
  if (durationFilterTypes.includes(filter.filterType)) {
    return filter.minDurationMinutes !== null || filter.maxDurationMinutes !== null;
  }
  if (filter.filterType === 'price') {
    return filter.minPrice !== null || filter.maxPrice !== null;
  }
  return filter.filterCode !== null;
}

function hasRemoveIntent(filter) {
  const text = toSearchText(filter.rawUserFilter);
  return /\b(remove|without|exclude|clear|drop|delete|no\s+longer)\b/.test(text);
}

function hasClearAllIntent(filters) {
  return filters.some((filter) => {
    const text = toSearchText(filter.rawUserFilter);
    return /\b(clear|remove|drop|delete)\s+(all\s+)?filters?\b/.test(text);
  });
}

function hasReplaceIntent(filter) {
  const text = toSearchText(filter.rawUserFilter);
  return /\b(only|instead|replace|change|switch|show only|make it)\b/.test(text);
}

function hasAddIntent(filter) {
  const text = toSearchText(filter.rawUserFilter);
  return /\b(add|also|include|with|plus|keep)\b/.test(text);
}

function filterStateKey(filter) {
  if (durationFilterTypes.includes(filter.filterType)) {
    return filter.filterType;
  }
  if (filter.filterType === 'price') {
    return filter.filterType;
  }
  return `${filter.filterType}:${filter.filterCode}`;
}

function removeMatchingFilter(filters, filterToRemove) {
  // Remove exact checkbox values when known; otherwise clear the whole type.
  if (
    !filterToRemove.filterCode ||
    durationFilterTypes.includes(filterToRemove.filterType) ||
    filterToRemove.filterType === 'price'
  ) {
    return filters.filter((filter) => filter.filterType !== filterToRemove.filterType);
  }

  return filters.filter(
    (filter) =>
      filter.filterType !== filterToRemove.filterType ||
      filter.filterCode !== filterToRemove.filterCode,
  );
}

function dedupeFilterState(filters) {
  const seen = new Set();
  const deduped = [];

  for (const filter of filters) {
    const key = filterStateKey(filter);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(filter);
    }
  }

  return deduped;
}

function mergeApplyFilterState(existingFilters, incomingFilters) {
  if (hasClearAllIntent(incomingFilters)) {
    return [];
  }

  // Update rule: duration and price ranges always replace their old range. "only/instead"
  // also replaces only that filter type. If the same checkbox type already
  // exists, a new value replaces it unless the user/model says add/also/with.
  const replaceTypes = new Set(
    incomingFilters
      .filter(
        (filter) =>
          !hasRemoveIntent(filter) &&
          hasUsableFilterValue(filter) &&
          (durationFilterTypes.includes(filter.filterType) ||
            filter.filterType === 'price' ||
            hasReplaceIntent(filter) ||
            ((existingFilters || []).some(
              (existingFilter) => existingFilter.filterType === filter.filterType,
            ) &&
              !hasAddIntent(filter))),
      )
      .map((filter) => filter.filterType),
  );

  let updatedFilters = (existingFilters || []).filter(
    (filter) => !replaceTypes.has(filter.filterType),
  );

  for (const filter of incomingFilters) {
    if (hasRemoveIntent(filter)) {
      updatedFilters = removeMatchingFilter(updatedFilters, filter);
      continue;
    }

    if (hasUsableFilterValue(filter)) {
      updatedFilters.push(filter);
    }
  }

  return dedupeFilterState(updatedFilters);
}

function buildFinalFilterPayload(filters) {
  const groupedValues = new Map();

  for (const filter of filters) {
    const apiFilterType = apiFilterTypeByToolType[filter.filterType];
    if (!apiFilterType) {
      continue;
    }

    if (durationFilterTypes.includes(filter.filterType)) {
      groupedValues.set(apiFilterType, [
        filter.minDurationMinutes ?? 0,
        filter.maxDurationMinutes ?? durationMaxByType[filter.filterType],
      ]);
      continue;
    }

    if (filter.filterType === 'price') {
      groupedValues.set(apiFilterType, [filter.minPrice ?? 0, filter.maxPrice ?? null]);
      continue;
    }

    if (!filter.filterCode) {
      continue;
    }

    const values = groupedValues.get(apiFilterType) || [];
    if (!values.includes(filter.filterCode)) {
      values.push(filter.filterCode);
    }
    groupedValues.set(apiFilterType, values);
  }

  return orderedFilterTypes
    .map((filterType) => {
      const apiFilterType = apiFilterTypeByToolType[filterType];
      const values = groupedValues.get(apiFilterType);

      if (!values) {
        return null;
      }

      if (filterType === 'stops') {
        return {
          filterType: apiFilterType,
          Values: [values.join(',')],
        };
      }

      return {
        filterType: apiFilterType,
        Values: values,
      };
    })
    .filter(Boolean);
}

function matchesStopCode(flight, filterCode) {
  if (filterCode === '0') {
    return flight.stops === 0;
  }
  if (filterCode === '2') {
    return flight.stops === 1;
  }
  if (filterCode === '3') {
    return flight.stops >= 1;
  }
  return true;
}

function matchesDurationMinutes(value, { minDurationMinutes, maxDurationMinutes }) {
  if (minDurationMinutes !== null && value < minDurationMinutes) {
    return false;
  }
  if (maxDurationMinutes !== null && value > maxDurationMinutes) {
    return false;
  }
  return true;
}

function matchesPrice(value, { minPrice, maxPrice }) {
  if (typeof value !== 'number') {
    return false;
  }
  if (minPrice !== null && value < minPrice) {
    return false;
  }
  if (maxPrice !== null && value > maxPrice) {
    return false;
  }
  return true;
}

function matchesApiFilter(flight, filter) {
  if (filter.filterType === 'baggage') {
    return !filter.filterCode || flight.baggage.includes(filter.filterCode);
  }
  if (filter.filterType === 'departureTime') {
    return !filter.filterCode || flight.departure_time_window === filter.filterCode;
  }
  if (filter.filterType === 'arrivalTime') {
    return !filter.filterCode || flight.arrival_time_window === filter.filterCode;
  }
  if (filter.filterType === 'stops') {
    return matchesStopCode(flight, filter.filterCode);
  }
  if (filter.filterType === 'totalDuration') {
    return matchesDurationMinutes(flight.total_duration_minutes, filter);
  }
  if (filter.filterType === 'layoverDuration') {
    return matchesDurationMinutes(flight.layover_duration_minutes, filter);
  }
  if (filter.filterType === 'price') {
    return matchesPrice(flight.price?.amount, filter);
  }
  return true;
}

function applyFilters(flights, filters) {
  // Dummy-only local filtering. Real integration should use the API response.
  const filtersByType = filters.reduce((groups, filter) => {
    groups[filter.filterType] ||= [];
    groups[filter.filterType].push(filter);
    return groups;
  }, {});

  return flights.filter((flight) =>
    Object.values(filtersByType).every((filterGroup) =>
      filterGroup.some((filter) => matchesApiFilter(flight, filter)),
    ),
  );
}

export const ApplyFilterTool = tool({
  name: 'apply_filter',
  description:
    'Apply filters to an existing flight search. Use exact API filter codes in filters[]. Requires searchKey in context from a previous flight_search call.',
  parameters: applyFilterSchema,
  strict: true,
  execute(input, context) {
    const appContext = getFlightContext(context);

    // UID comes from SDK run context and will be sent to the real API.
    // TODO: Read UID from context
    const UID = appContext.UID;

    // searchKey is written by FlightSearchTool and identifies active results.
    // Without it, apply-filter has no search result set to filter.
    // TODO: Read searchKey from context
    const searchKey = appContext.searchKey;

    // Existing filters are the active state from earlier apply_filter turns.
    const existingFilters = appContext.lastAppliedFilters || [];

    // New filters are only what the latest user turn requested.
    const newFilters = normalizeApplyFilter(input.filters);

    // Merge state: add new checkbox values, remove explicit values, and
    // replace only the requested filter type for "only/instead/change".
    const updatedFilters = mergeApplyFilterState(existingFilters, newFilters);

    if (!searchKey) {
      log('info', 'apply_filter.missing_search', {
        requestId: appContext.requestId,
        sessionId: appContext.sessionId,
        UID,
        filters: updatedFilters,
      });

      return {
        ok: false,
        code: 'MISSING_SEARCH',
        message:
          'No active flight search found. Ask for origin, destination, and travel date before applying filters.',
      };
    }

    // Final API-ready array in the exact Apply Filter API format.
    // TODO: Build real Apply Filter API payload here using UID, searchKey, and updated filters.
    const finalFilterPayload = buildFinalFilterPayload(updatedFilters);
    console.log('FINAL_APPLY_FILTER_PAYLOAD', finalFilterPayload);

    const applyFilterApiPayload = {
      UID,
      searchKey,
      filters: finalFilterPayload,
    };

    // TODO: Pass `finalFilterPayload` to the real Apply Filter API.
    // TODO: Call real Apply Filter API here.
    //
    // Example real API integration:
    //
    // const payload = buildApplyFilterPayload({
    //   uid: UID,
    //   searchKey,
    //   filters: finalFilterPayload,
    // });
    //
    // const apiResponse = await applyFilterApi(payload);
    //
    // return mapApplyFilterResponse(apiResponse);

    // TODO: Remove dummy response once real API integration is done.
    const baseFlights = appContext.flightResults || [];
    const filteredFlights = applyFilters(baseFlights, updatedFilters);

    // Persist latest filter state in context for follow-up turns and tests.
    appContext.filteredFlightResults = filteredFlights;
    appContext.lastAppliedFilters = updatedFilters;
    appContext.lastFinalFilterPayload = finalFilterPayload;
    appContext.lastApplyFilterPayload = applyFilterApiPayload;
    appContext.toolCallLog.push({
      tool: 'apply_filter',
      searchKey,
      filters: updatedFilters,
      finalFilterPayload,
      apiPayload: applyFilterApiPayload,
    });

    log('info', 'apply_filter.called', {
      requestId: appContext.requestId,
      sessionId: appContext.sessionId,
      UID,
      searchKey,
      filters: updatedFilters,
      finalFilterPayload,
      resultCount: filteredFlights.length,
    });

    // TODO: Map real API response into tool output format here.
    return {
      ok: true,
      source: 'dummy',
      message: 'Sample filtered flight results only. No live API was called.',
      UID,
      searchKey,
      filters: updatedFilters,
      finalFilterPayload,
      apiPayload: applyFilterApiPayload,
      summary: {
        originalCount: baseFlights.length,
        filteredCount: filteredFlights.length,
      },
      flights: filteredFlights,
    };
  },
});
