const FLIGHT_SEARCH_DATE_FIELDS = new Set([
  'outbound_date',
  'outboundDate',
  'departureDate',
  'departDate',
  'return_date',
  'returnDate',
  'inbound_date',
  'inboundDate',
]);

function nonEmptyDateString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

export function firstFlightSearchDate(...values) {
  for (const value of values) {
    const normalized = nonEmptyDateString(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

export function readFlightSearchDates(source = {}, firstOnd = {}, tripType = null) {
  const returnDate = firstFlightSearchDate(
    source.return_date,
    source.returnDate,
    source.inbound_date,
    source.inboundDate,
    firstOnd.return_date,
  );

  return {
    outbound_date:
      firstFlightSearchDate(
        source.outbound_date,
        source.outboundDate,
        source.departureDate,
        source.departDate,
      ) || firstOnd.outbound_date || null,
    return_date: tripType === 'oneway' ? null : returnDate,
  };
}

export function mergeFlightSearchDates(base = {}, update = {}) {
  return {
    outbound_date: update.outbound_date || base.outbound_date || null,
    return_date:
      update.trip_type === 'oneway'
        ? null
        : update.return_date || base.return_date || null,
  };
}

export function shouldPreserveExistingFlightDate(field, value, incomingTripType) {
  if (!FLIGHT_SEARCH_DATE_FIELDS.has(field) || nonEmptyDateString(value)) {
    return false;
  }

  const isReturnField = /return|inbound/i.test(field);
  return !(isReturnField && incomingTripType === 'oneway');
}

