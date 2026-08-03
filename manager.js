import { tool } from '@openai/agents';
import { z } from 'zod';
import {
  getFlightSearchState,
  initializeFlightToolContext,
} from '../flightContext.js';
import { storeResolvedFlightDateIntent } from '../flightDateContext.js';
import { resolveFlightDateIntent } from '../flightDateResolver.js';
import { log } from '../logger.js';

export const RESOLVE_FLIGHT_DATE_TOOL_NAME = 'resolve_flight_date';

export const resolveFlightDateInputSchema = z.object({
  kind: z.enum(['exact', 'weekday', 'week', 'weekend', 'month', 'range', 'flexible']),
  relation: z.enum(['this', 'next']).nullable(),
  offset: z.number().int().min(0).nullable(),
  weekday: z
    .enum([
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ])
    .nullable(),
  month: z.number().int().min(1).max(12).nullable(),
  year: z.number().int().min(2000).max(9999).nullable(),
  exactDate: z.string().nullable(),
  rangeStart: z.string().nullable(),
  rangeEnd: z.string().nullable(),
  tripDurationDays: z.number().int().positive().nullable(),
});

export const ResolveFlightDateTool = tool({
  name: RESOLVE_FLIGHT_DATE_TOOL_NAME,
  description:
    'Resolve structured calendar semantics into ISO flight dates using the immutable local clock. Do not pass raw user text. Use before search or price prediction when timing is relative, vague, month-based, or a range.',
  parameters: resolveFlightDateInputSchema,
  strict: true,
  execute(input, runContext) {
    const appContext = initializeFlightToolContext(runContext);

    const result = resolveFlightDateIntent(input, {
      clock: appContext.flight.clock,
      existingSearch: getFlightSearchState(appContext),
    });
    storeResolvedFlightDateIntent(appContext, result);
    appContext.toolCallLog.push({
      tool: RESOLVE_FLIGHT_DATE_TOOL_NAME,
      input,
      status: result.status,
      searchDate: result.searchDate,
      returnDate: result.returnDate,
    });

    log('info', 'resolve_flight_date.called', {
      requestId: appContext.requestId,
      sessionId: appContext.sessionId,
      status: result.status,
      kind: result.kind,
      searchDate: result.searchDate,
      returnDate: result.returnDate,
    });

    return result;
  },
});
