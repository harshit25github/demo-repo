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
];
const baggageFilterCodes = ['0', '1', '2'];
const timeSlotFilterCodes = ['EARLYMORNING', 'MORNING', 'AFTERNOON', 'EVENING'];
const stopFilterCodes = ['0', '2', '3'];
const apiFilterCodeValues = ['0', '1', '2', '3', ...timeSlotFilterCodes];
const durationFilterTypes = ['totalDuration', 'layoverDuration'];

const flightSearchSchema = z.object({
  onds: z
    .array(
      z.object({
        origin: z
          .string()
          .describe('Origin city, airport, or IATA code, for example Delhi or DEL.'),
        destination: z
          .string()
          .describe('Destination city, airport, or IATA code, for example Mumbai or BOM.'),
        outbound_date: z
          .string()
          .describe('Departure date in YYYY-MM-DD format when possible.'),
        return_date: z
          .string()
          .nullable()
          .describe('Return date for round trips, otherwise null.'),
      }),
    )
    .min(1)
    .describe('Origin-destination route segments for one-way, roundtrip, or multicity search.'),
  trip_type: z
    .enum(['oneway', 'roundtrip', 'multicity'])
    .describe('Trip type. Use oneway by default unless return date or multicity is requested.'),
  passengers: z
    .object({
      adults: z.number().int().min(1).describe('Adult passenger count. Default to 1.'),
      children: z.number().int().min(0).describe('Child passenger count. Default to 0.'),
      infants: z.number().int().min(0).describe('Infant passenger count. Default to 0.'),
    })
    .describe('Passenger counts.'),
  cabin_class: z
    .enum(['economy', 'premium_economy', 'business', 'first'])
    .describe('Coach or cabin class. Default to economy.'),
});

const applyFilterSchema = z.object({
  filters: z
    .array(
      z.object({
        filterType: z
          .enum(filterTypeValues)
          .describe(
            'Filter category: baggage, departureTime, arrivalTime, stops, totalDuration, or layoverDuration.',
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
        rawUserFilter: z
          .string()
          .nullable()
          .describe('Original user filter text used to map natural language to API codes.'),
      }),
    )
    .min(1)
    .describe('Apply-filter API filters. Each item must use exact API filter codes.'),
});

function createSearchKey(UID) {
  return `search_${UID}_${Date.now()}`;
}

function buildDummyFlights({ onds, trip_type, passengers, cabin_class }) {
  const firstOnd = onds[0];
  const lastOnd = onds[onds.length - 1];
  const passengerCount = passengers.adults + passengers.children + passengers.infants;

  return {
    source: 'dummy',
    message: 'Sample flight results only. No live API was called.',
    searchParams: {
      onds,
      trip_type,
      passengers,
      cabin_class,
    },
    summary: {
      route: `${firstOnd.origin} to ${lastOnd.destination}`,
      passengerCount,
      optionCount: 2,
    },
    flights: [
      {
        id: 'dummy-flight-1',
        airline: 'Sample Air',
        flight_number: 'SA 101',
        origin: firstOnd.origin,
        destination: firstOnd.destination,
        departure_time: '09:00',
        arrival_time: '11:10',
        departure_time_window: 'MORNING',
        arrival_time_window: 'MORNING',
        duration: '2h 10m',
        total_duration_hours: 2.17,
        total_duration_minutes: 130,
        layover_duration_hours: 0,
        layover_duration_minutes: 0,
        stops: 0,
        baggage: ['2', '1'],
        cabin_class,
        price: {
          amount: 199,
          currency: 'USD',
        },
      },
      {
        id: 'dummy-flight-2',
        airline: 'Demo Airlines',
        flight_number: 'DA 204',
        origin: firstOnd.origin,
        destination: firstOnd.destination,
        departure_time: '14:30',
        arrival_time: '17:05',
        departure_time_window: 'AFTERNOON',
        arrival_time_window: 'EVENING',
        duration: '2h 35m',
        total_duration_hours: 2.58,
        total_duration_minutes: 155,
        layover_duration_hours: 0.75,
        layover_duration_minutes: 45,
        stops: 1,
        baggage: ['2', '1', '0'],
        cabin_class,
        price: {
          amount: 179,
          currency: 'USD',
        },
      },
      {
        id: 'dummy-flight-3',
        airline: 'Example Express',
        flight_number: 'EE 309',
        origin: firstOnd.origin,
        destination: firstOnd.destination,
        departure_time: '05:45',
        arrival_time: '13:40',
        departure_time_window: 'EARLYMORNING',
        arrival_time_window: 'AFTERNOON',
        duration: '7h 55m',
        total_duration_hours: 7.92,
        total_duration_minutes: 475,
        layover_duration_hours: 2.25,
        layover_duration_minutes: 135,
        stops: 2,
        baggage: ['2'],
        cabin_class,
        price: {
          amount: 149,
          currency: 'USD',
        },
      },
    ],
  };
}

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
  // Normalize model input into the exact codes/minutes the real API expects.
  // This keeps the API integration layer from re-mapping natural language later.
  return filters.map((filter) => {
    if (durationFilterTypes.includes(filter.filterType)) {
      // Duration filters do not use filterCode; API payload uses minutes.
      const inferredDuration = inferDurationRange(filter.rawUserFilter);
      return {
        filterType: filter.filterType,
        filterCode: null,
        minDurationMinutes:
          filter.minDurationMinutes ?? inferredDuration.minDurationMinutes ?? null,
        maxDurationMinutes:
          filter.maxDurationMinutes ?? inferredDuration.maxDurationMinutes ?? null,
        rawUserFilter: filter.rawUserFilter,
      };
    }

    // For baggage/time/stops, prefer a valid explicit API code. If the model
    // omits or sends an invalid code, infer it from rawUserFilter as fallback.
    const inferredCode = inferFilterCode(filter.filterType, filter.rawUserFilter);
    const filterCode = isAllowedCodeForType(filter.filterType, filter.filterCode)
      ? filter.filterCode
      : inferredCode;

    return {
      filterType: filter.filterType,
      filterCode,
      minDurationMinutes: null,
      maxDurationMinutes: null,
      rawUserFilter: filter.rawUserFilter,
    };
  });
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
  return true;
}

function applyFilters(flights, filters) {
  // Dummy-only local filtering. Real integration should use the API response.
  return flights.filter((flight) => filters.every((filter) => matchesApiFilter(flight, filter)));
}

export const FlightSearchTool = tool({
  name: 'flight_search',
  description:
    'Search for flights when origin, destination, travel date, trip type, passengers, and cabin class are known. Returns dummy sample flight data only.',
  parameters: flightSearchSchema,
  strict: true,
  execute(input, context) {
    const appContext = getFlightContext(context);
    const searchKey = createSearchKey(appContext.UID);
    const result = buildDummyFlights(input);

    result.UID = appContext.UID;
    result.searchKey = searchKey;

    appContext.searchKey = searchKey;
    appContext.lastSearch = input;
    appContext.flightResults = result.flights;
    appContext.filteredFlightResults = result.flights;
    appContext.toolCallLog.push({ tool: 'flight_search', searchKey, input });

    log('info', 'flight_search.called', {
      requestId: appContext.requestId,
      sessionId: appContext.sessionId,
      UID: appContext.UID,
      searchKey,
      input,
    });

    return result;
  },
});

export const ApplyFilterTool = tool({
  name: 'apply_filter',
  description:
    'Apply filters to an existing flight search. Use exact API filter codes in filters[]. Requires searchKey in context from a previous flight_search call.',
  parameters: applyFilterSchema,
  strict: true,
  execute(input, context) {
    const appContext = getFlightContext(context);
    // UID comes from SDK run context and is required by the real Apply Filter API.
    // TODO: Read UID from context
    const UID = appContext.UID;

    // searchKey is created by FlightSearchTool and identifies the active search.
    // Apply filters only after this exists; otherwise the API has no result set.
    // TODO: Read searchKey from context
    const searchKey = appContext.searchKey;

    // Existing filters live in appContext.lastAppliedFilters from the prior
    // apply_filter call. They are replaced below by the updated filter state.

    // New filters are the latest filters requested by the user/model this turn.
    const newFilters = normalizeApplyFilter(input.filters);

    // Current contract: input.filters is the full desired filter state.
    // - Add filter: include it in input.filters.
    // - Keep filter: include it again in input.filters.
    // - Remove filter: omit it from input.filters.
    // So updatedFilters replaces the prior context state instead of merging blindly.
    const updatedFilters = newFilters;

    if (!searchKey) {
      // Without searchKey, do not call Apply Filter. Ask the agent to collect
      // origin, destination, and travel date so FlightSearchTool can run first.
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

    // Final payload shape that should go to the real Apply Filter API.
    // TODO: Build real Apply Filter API payload here using UID, searchKey, and updated filters.
    const applyFilterApiPayload = {
      UID,
      searchKey,
      filters: updatedFilters,
    };

    // TODO: Call real Apply Filter API here.
    //
    // Example real API integration:
    //
    // const payload = buildApplyFilterPayload({
    //   uid: UID,
    //   searchKey,
    //   filters: updatedFilters,
    // });
    //
    // const apiResponse = await applyFilterApi(payload);
    //
    // return mapApplyFilterResponse(apiResponse);

    // TODO: Remove this dummy response when real Apply Filter API is integrated.
    // Dummy code starts here: read current sample flights and filter locally.
    const baseFlights = appContext.flightResults || [];
    const filteredFlights = applyFilters(baseFlights, updatedFilters);

    // Store updated state in context for follow-up turns and test assertions.
    appContext.filteredFlightResults = filteredFlights;
    appContext.lastAppliedFilters = updatedFilters;
    appContext.lastApplyFilterPayload = applyFilterApiPayload;
    appContext.toolCallLog.push({
      tool: 'apply_filter',
      searchKey,
      filters: updatedFilters,
      apiPayload: applyFilterApiPayload,
    });

    log('info', 'apply_filter.called', {
      requestId: appContext.requestId,
      sessionId: appContext.sessionId,
      UID,
      searchKey,
      filters: updatedFilters,
      resultCount: filteredFlights.length,
    });

    // TODO: Map real API response into tool output format here.
    // Replace the dummy return below with the normalized API response. Keep
    // UID/searchKey in the output so the agent and caller can verify state.

    return {
      ok: true,
      source: 'dummy',
      message: 'Sample filtered flight results only. No live API was called.',
      UID,
      searchKey,
      filters: updatedFilters,
      apiPayload: applyFilterApiPayload,
      summary: {
        originalCount: baseFlights.length,
        filteredCount: filteredFlights.length,
      },
      flights: filteredFlights,
    };
  },
});

export const flightTools = [FlightSearchTool, ApplyFilterTool];
