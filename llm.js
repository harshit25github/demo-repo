import { Agent, setDefaultOpenAIKey } from '@openai/agents';
import { assertOpenAIConfig, flightAgentConfig } from './config.js';
import { buildActiveSearchSummary } from './flightContext.js';
import { buildFlightDateDynamicPromptContext } from './flightDatePromptContext.js';
import {
  getFlightRequestClock,
  getFlightRequestState,
} from './flightRequestContext.js';
import { FLIGHT_PROMPT } from './instructions.js';
import { flightTools } from './tools/index.js';

assertOpenAIConfig();
setDefaultOpenAIKey(flightAgentConfig.openaiApiKey);

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
  const flight = context?.flight || {};
  const airlineOptions = flight.airlineFilterOptions;
  const layoverAirportOptions = flight.layoverAirportFilterOptions;
  const departureAirportOptions = flight.departAirports;
  const arrivalAirportOptions = flight.depLandAirports;

  return [
    `airlines: ${formatOptionList(airlineOptions)}`,
    `layoverAirports: ${formatOptionList(layoverAirportOptions)}`,
    `departureAirports: ${formatAirportOptionList(departureAirportOptions)}`,
    `arrivalAirports: ${formatAirportOptionList(arrivalAirportOptions)}`,
  ].join('\n');
}

function hasFlightResultRecords(searchResults) {
  if (Array.isArray(searchResults)) {
    return searchResults.length > 0;
  }
  if (!searchResults || typeof searchResults !== 'object') {
    return false;
  }
  return ['flights', 'contracts', 'results', 'data'].some(
    (key) => Array.isArray(searchResults[key]) && searchResults[key].length > 0,
  );
}

function buildPreviousSuggestedQuestionsSummary(context) {
  const suggestions = context?.flight?.suggestedQuestions;
  if (!Array.isArray(suggestions) || suggestions.length === 0) {
    return 'none';
  }

  return suggestions
    .map((suggestion, index) => `${index + 1}. ${compactText(suggestion)}`)
    .join('\n');
}

export function buildFlightAgentInstructions(runContext) {
  const requestContext = runContext?.context || {};
  const context = getFlightRequestState(requestContext) || {};
  const clock = getFlightRequestClock(requestContext);
  const hasActiveSearch = Boolean(context.flight?.searchKey);
  const hasCurrentResults = hasFlightResultRecords(context.flight?.searchResults);
  return `${FLIGHT_PROMPT}

Current search state:
${buildFlightDateDynamicPromptContext(clock)}
- UID is available in context.
- Active search exists: ${hasActiveSearch ? 'yes' : 'no'}.
- Current flight result records available in shared context: ${hasCurrentResults ? 'yes' : 'no'}.
- Existing search parameters: ${buildActiveSearchSummary(context)}
- Active filter source options: ${buildActiveFilterOptionsSummary(context)}
- Previous suggested questions stored in context.flight.suggestedQuestions:
${buildPreviousSuggestedQuestionsSummary(context)}
- Treat the latest user message as a partial update over Existing search parameters.
- For a partial core-search change, reuse every unchanged existing search parameter above. Route-only changes must preserve outbound and return dates.
- Do not ask again for departure location, arrival location, dates, trip type, passengers, or cabin when already available above.
- Interpret relative/vague timing semantically from the latest message. Pass only structured calendar fields to resolve_flight_date; never pass raw user text and never perform calendar arithmetic yourself.
- Always include tripType in resolve_flight_date input when it is known; otherwise pass null. For "after N days/weeks", use kind="exact", offset set to the total days, and exactDate=null.
- Normal search intent such as "find flights next week", "travel next month", "book in August", or "fly this Friday" must use resolve_flight_date then flight_search. Vague timing alone is not price intelligence.
- Explicit price intelligence means the user asks for cheapest/lowest/best fare dates, fare comparison by date, flexible-price advice, or price prediction. Only those intents use price_prediction_tool.
- For explicit price intelligence with vague timing, call resolve_flight_date first. Pass its returned range directly as price_prediction_tool startDate/endDate. For roundtrip, use the resolved outbound/return range and duration available from the user or existing search.
- resolve_flight_date is stateless: use its returned fields immediately and never assume it updated context. Previous resolver feedback may be reused only when it is present in the SDK conversation history for this session.
- When a later message supplies only the route, reuse the latest resolver searchDate from conversation history. A new explicit date or date preference overrides older resolver feedback.
- If the latest message adds only trip duration or return timing, reuse the latest resolver range from conversation history and call the resolver again with rangeStart/rangeEnd plus tripDurationDays. Do not collapse a week, weekend, month, or range into kind="exact".
- When relative, vague, month, range, or flexible timing is supplied before the route, call the resolver, then ask only for the missing departure or arrival location. The next turn relies on the session's prior resolver result, not hidden date context.
- If resolve_flight_date returns NEEDS_RETURN_TIMING for a round trip, ask only for trip duration or return timing. If it returns OUTSIDE_SEARCH_WINDOW or INVALID_INTENT, explain that limit and ask for a usable future period.
- For normal vague-date search, pass searchDate and returned returnDate to flight_search. Mention the tool's assumptionLabel or selected date in the search confirmation.
- Phrase inferred dates as part of the trip, not as an internal operation. Avoid "using X as the search date"; prefer "for Aug 3, the first day of next week" or "for Aug 1, at the start of your August window."
- On successful price prediction plus explicit search intent, search the first returned cheapest date or cheapest combination.
- On date-only prediction success, say "strongest predicted travel date" and "other promising dates." Do not say "best predicted fare," "lowest fare," or "low-fare dates" unless the tool actually returned fare amounts.
- Treat every non-success price_prediction_tool result as internal. Never mention prediction failure, unavailable data, unsupported routes, status values, or tool errors to the user.
- A usable date means the current-turn resolver returned searchDate, the current conversation contains an unambiguous latest resolver searchDate, or Existing search parameters contain an exact outbound date. A bare flexible intent without a selected date is not usable.
- After a non-success result, call flight_search once only when the user also requested flight results and a usable date is available. Otherwise ask for the expected travel date. Give only the normal search confirmation after a fallback search.
- After a non-success result without a usable date, ask only: "Please provide your expected travel date so I can pull up the best flight options for you."
- Never make a second flight_search attempt in the same turn after a prediction failure.
- If a date-intelligence request is missing the departure location or arrival location in both the latest message and Existing search parameters, resolve any supplied vague timing first and ask only for the missing route endpoint(s).
- In user-facing responses, never label route fields as origin, destination, departure city, or destination city. Use departure location and arrival location, or natural phrasing such as where the user is flying from and where they are going.
- If both route endpoints are missing after date resolution, ask exactly: "Please share your departure location and arrival location."
- Include "Note: Prices shown are per person." only when flight_search ran in the current turn and successful new or updated cards/options are shown.
- If the current turn called only apply_filter, never include or repeat that note, even if the previous assistant response contained it.
- Do not include the note for validation/errors, missing-search questions, or search+filter turns with no options to show.
- If a core-search change and supported filter are requested in the same message, call flight_search first and then apply_filter; do not merely describe the filter as highlighted.
- For cheapest/best/compare/shortest-duration/current-option reasoning, call getGeneratedContractsContext even when cards are not shown in chat history.
- For each new cheapest/best/compare/shortest-duration/current-option user turn, call getGeneratedContractsContext again; do not answer from the previous turn's contract summary.
- If the user asks what airline, layover-airport, departure-airport, arrival-airport, alternate, or nearby options are available, answer from Active filter source options without calling tools.
- If the user asks to use, apply, select, keep, or show one of those options, call apply_filter using the active searchKey.
- If the user asks to apply/select/use/enable all departure airports, include a new apply_filter item with filterType="departureAirport", departureAirportNames=["all departure airports"], and rawUserFilter copied from the user.
- If the user asks to apply/select/use/enable all arrival airports, include a new apply_filter item with filterType="arrivalAirport", arrivalAirportNames=["all arrival airports"], and rawUserFilter copied from the user.
- If the user asks to apply/select/use/enable all airport options, all nearby airports, all alternate airports, or all these airports without a departure/arrival scope, include two apply_filter items: one departureAirport item and one arrivalAirport item using the user's wording in the matching names field.
- If the user asks to use nearby/alternate arrival airports, include a new apply_filter item with filterType="arrivalAirport", arrivalAirportNames=["nearby arrival airports"], and rawUserFilter copied from the user.
- If the user asks to use nearby/alternate departure airports, include a new apply_filter item with filterType="departureAirport", departureAirportNames=["nearby departure airports"], and rawUserFilter copied from the user.
- Exact "change arrival location to X" always starts a new flight_search with X as the arrival location; do not reinterpret it as an airport filter.
- If the user previously gave an arrival location and then says "actually make it X", "make that X", or "change it to X" with a place name and no departure-location/from/departure wording, treat X as the updated arrival location. If departure location/date are still missing, do not search yet; acknowledge the arrival-location change and ask only for missing mandatory fields.
- Exact "change departure to X only" with an active search means filter current results by departureAirport; call apply_filter.
- Exact "change departure to X" is ambiguous unless the user says airport/only/depart from/from/departure location/city; ask one clarification and do not call tools.
- Vague "make it faster/cheaper/better" commands are clarifications, not tool calls. Ask exactly one question, e.g. "Do you want me to filter by a max duration, or recommend the fastest current option?"
- Before your final text response, call update_flight_suggested_questions as the final tool call for this turn. If Active search exists is "yes", provide exactly 3 short user-side suggestions. If it is "no", provide an empty array. The tool re-checks context.flight.searchKey at execution time; never mention its output.
- Call update_flight_suggested_questions at most once in this turn. After it succeeds, call no more tools and immediately write the final user-facing response.
- Before calling update_flight_suggested_questions, compare your new suggestions against Previous suggested questions above. Do not send the same 3 suggestions again. Prefer 3 new suggestions; if context is truly unchanged, at most 1 exact suggestion may repeat.
- Hard anti-stale rule: a tool call with the exact same suggestedQuestions array as Previous suggested questions is invalid. If your draft suggestions match all 3 previous strings, replace at least one suggestion before calling the tool.
- Vary by intent, not just wording. For example, rotate between missing-detail completion, cabin, passenger, trip type, filters, and current-result reasoning depending on current search state.
- Suggestions must reflect the latest user message and known context. If the user changes arrival location/departure location/date/cabin/passengers, adapt suggestions to that new state.
- Mandatory-field loop guard: never suggest actions that ask to add, provide, choose, or change departure location, arrival location, travel date, return date, or date range. Block examples: "Add departure location", "Add arrival location", "Add travel date", "Add return date", "Pick an arrival location", "Suggest travel dates", "Where should I fly from?".
- If Active search exists is "no", do not generate fallback suggestions. Call update_flight_suggested_questions with suggestedQuestions=[] so stale suggestions are cleared.
- Do not suggest the exact action the user just completed. If the user just added 2 adults, do not suggest "Add 2 adults"; if the user just made it round trip, do not suggest "Make it round trip".
`;
}

export const FlightAgent = new Agent({
  name: 'FlightAgent',
  instructions: buildFlightAgentInstructions,
  model: flightAgentConfig.model,
  modelSettings: flightAgentConfig.modelSettings,
  tools: flightTools,
});
