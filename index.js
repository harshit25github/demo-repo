import { Agent, setDefaultOpenAIKey } from '@openai/agents';
import { assertOpenAIConfig, flightAgentConfig } from './config.js';
import { FLIGHT_PROMPT } from './instructions.js';
import { flightTools } from './tools/index.js';

assertOpenAIConfig();
setDefaultOpenAIKey(flightAgentConfig.openaiApiKey);

function buildActiveSearchSummary(context) {
  const lastSearch = context?.lastSearch;
  if (!lastSearch) {
    return 'none';
  }

  return JSON.stringify({
    onds: lastSearch.onds,
    trip_type: lastSearch.trip_type,
    passengers: lastSearch.passengers,
    cabin_class: lastSearch.cabin_class,
  });
}

const MAX_FILTER_OPTIONS_PER_GROUP = 12;

function getAvailableOptions(options = []) {
  const list = Array.isArray(options) ? options : [];
  return list.filter((option) => option);
}

function compactText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatFilterOption(option) {
  const code = compactText(option.Code);
  const label = compactText(option.Text || option.Name || option.AirportCityName);

  if (!code && !label) {
    return null;
  }

  if (!code || !label || code.toLowerCase() === label.toLowerCase()) {
    return code || label;
  }

  return `${code}=${label}`;
}

function formatOptionList(options) {
  const values = getAvailableOptions(options).map(formatFilterOption).filter(Boolean);

  if (values.length === 0) {
    return 'none';
  }

  const visibleValues = values.slice(0, MAX_FILTER_OPTIONS_PER_GROUP);
  const hiddenCount = values.length - visibleValues.length;
  return `${visibleValues.join('; ')}${hiddenCount > 0 ? `; +${hiddenCount} more` : ''}`;
}

function formatAirportOptionList(options) {
  const availableOptions = getAvailableOptions(options);
  const mainOptions = availableOptions.filter((option) => !option.IsNearby);
  const nearbyOptions = availableOptions.filter((option) => option.IsNearby);
  const parts = [];

  if (mainOptions.length > 0) {
    parts.push(`main ${formatOptionList(mainOptions)}`);
  }

  if (nearbyOptions.length > 0) {
    parts.push(`nearby ${formatOptionList(nearbyOptions)}`);
  }

  return parts.length > 0 ? parts.join(' | ') : 'none';
}

function buildActiveFilterOptionsSummary(context) {
  const airlineOptions = context?.airlineFilterOptions || context?.airlineFilters;
  const layoverAirportOptions =
    context?.layoverAirportFilterOptions || context?.layoverAirportFilters;
  const departureAirportOptions =
    context?.DepartAirports ||
    context?.departureAirportFilterOptions ||
    context?.departureAirportFilters;
  const arrivalAirportOptions =
    context?.DepLandAirports ||
    context?.arrivalAirportFilterOptions ||
    context?.arrivalAirportFilters;

  return [
    `airlines: ${formatOptionList(airlineOptions)}`,
    `layoverAirports: ${formatOptionList(layoverAirportOptions)}`,
    `departureAirports: ${formatAirportOptionList(departureAirportOptions)}`,
    `arrivalAirports: ${formatAirportOptionList(arrivalAirportOptions)}`,
  ].join('\n');
}

export function buildFlightAgentInstructions(runContext) {
  const context = runContext?.context || {};
  const hasActiveSearch = Boolean(context.searchKey || context.sid);
  const hasCurrentResults = Boolean(
    context.filteredFlightResults?.length ||
      context.flightResults?.length ||
      context.generatedContracts?.length ||
      context.contracts?.length,
  );
  return `${FLIGHT_PROMPT}

Current search state:
- UID is available in context.
- Active search exists: ${hasActiveSearch ? 'yes' : 'no'}.
- Current flight result records available in shared context: ${hasCurrentResults ? 'yes' : 'no'}.
- Existing search parameters: ${buildActiveSearchSummary(context)}
- Active filter source options: ${buildActiveFilterOptionsSummary(context)}
- For a partial core-search change, reuse every unchanged existing search parameter above.
- Do not ask again for origin, destination, dates, trip type, passengers, or cabin when already available above.
- For cheapest/best/compare/shortest-duration/current-option reasoning, call getGeneratedContractsContext even when cards are not shown in chat history.
- For each new cheapest/best/compare/shortest-duration/current-option user turn, call getGeneratedContractsContext again; do not answer from the previous turn's contract summary.
- If the user asks what airline, layover-airport, departure-airport, arrival-airport, alternate, or nearby options are available, answer from Active filter source options without calling tools.
- If the user asks to use, apply, select, keep, or show one of those options, call apply_filter using the active searchKey.
- If the user asks to apply/select/use/enable all departure airports, include a new apply_filter item with filterType="departureAirport", departureAirportNames=["all departure airports"], and rawUserFilter copied from the user.
- If the user asks to apply/select/use/enable all arrival airports, include a new apply_filter item with filterType="arrivalAirport", arrivalAirportNames=["all arrival airports"], and rawUserFilter copied from the user.
- If the user asks to apply/select/use/enable all airport options, all nearby airports, all alternate airports, or all these airports without a departure/arrival scope, include two apply_filter items: one departureAirport item and one arrivalAirport item using the user's wording in the matching names field.
- If the user asks to use nearby/alternate arrival airports, include a new apply_filter item with filterType="arrivalAirport", arrivalAirportNames=["nearby arrival airports"], and rawUserFilter copied from the user.
- If the user asks to use nearby/alternate departure airports, include a new apply_filter item with filterType="departureAirport", departureAirportNames=["nearby departure airports"], and rawUserFilter copied from the user.
- Exact "change destination to X" always starts a new flight_search with X as destination; do not reinterpret it as an airport filter.
- Exact "change departure to X only" with an active search means filter current results by departureAirport; call apply_filter.
- Exact "change departure to X" is ambiguous unless the user says airport/only/depart from/from/origin/city; ask one clarification and do not call tools.
- Vague "make it faster/cheaper/better" commands are clarifications, not tool calls. Ask exactly one question, e.g. "Do you want me to filter by a max duration, or recommend the fastest current option?"
`;
}

export const FlightAgent = new Agent({
  name: 'FlightAgent',
  instructions: buildFlightAgentInstructions,
  model: flightAgentConfig.model,
  modelSettings: flightAgentConfig.modelSettings,
  tools: flightTools,
});
