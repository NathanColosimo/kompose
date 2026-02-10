import { env } from "@kompose/env";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { implement, ORPCError } from "@orpc/server";
import { z } from "zod";
import { requireAuth } from "../..";
import { globalRateLimit, mapsRateLimit } from "../../ratelimit";
import { type LocationSuggestion, mapsContract } from "./contract";

const tracer = trace.getTracer("kompose-api");

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const MIN_QUERY_LENGTH = 2;

/** Zod schema for Google Places Autocomplete API response */
const PlacesAutocompleteResponseSchema = z.object({
  suggestions: z
    .array(
      z.object({
        placePrediction: z
          .object({
            placeId: z.string().optional(),
            place: z.string().optional(),
            text: z.object({ text: z.string().optional() }).optional(),
            structuredFormat: z
              .object({
                mainText: z.object({ text: z.string().optional() }).optional(),
                secondaryText: z
                  .object({ text: z.string().optional() })
                  .optional(),
              })
              .optional(),
          })
          .optional(),
      })
    )
    .optional(),
  error: z.object({ message: z.string().optional() }).optional(),
  message: z.string().optional(),
});

/** Map raw Places API suggestions into LocationSuggestion objects */
function mapSuggestions(
  data: z.infer<typeof PlacesAutocompleteResponseSchema>
): LocationSuggestion[] {
  if (data.error?.message || data.message) {
    throw new ORPCError("GOOGLE_MAPS_ERROR", {
      message: data.error?.message ?? data.message ?? "Places API error",
    });
  }

  return (data.suggestions ?? []).flatMap((suggestion) => {
    const prediction = suggestion.placePrediction;
    if (!prediction) {
      return [];
    }

    const primary = prediction.structuredFormat?.mainText?.text ?? "";
    const secondary = prediction.structuredFormat?.secondaryText?.text;
    const description =
      prediction.text?.text ?? [primary, secondary].filter(Boolean).join(", ");
    if (!description) {
      return [];
    }

    // Use || to treat empty strings as falsy and fall through to next option
    const placeId =
      prediction.placeId || prediction.place?.split("/").pop() || undefined;

    return [
      { description, placeId, primary: primary || description, secondary },
    ];
  });
}

/** Extract error details from a non-OK Google Places response */
async function extractPlacesErrorMessage(res: Response): Promise<string> {
  let errorDetails = "";
  try {
    const errorBody = (await res.json()) as {
      error?: { message?: string };
      message?: string;
    };
    errorDetails = errorBody.error?.message ?? errorBody.message ?? "";
  } catch {
    // Response body not JSON, ignore
  }
  return `Places API error (${res.status})${errorDetails ? `: ${errorDetails}` : ""}`;
}

/** Fetch and parse the Google Places Autocomplete API */
function fetchAutocomplete(query: string) {
  return tracer.startActiveSpan("GooglePlaces.autocomplete", async (span) => {
    span.setAttribute("query", query);
    try {
      const res = await fetch(AUTOCOMPLETE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": env.GOOGLE_MAPS_API_KEY,
          "X-Goog-FieldMask": [
            "suggestions.placePrediction.placeId",
            "suggestions.placePrediction.place",
            "suggestions.placePrediction.text.text",
            "suggestions.placePrediction.structuredFormat.mainText.text",
            "suggestions.placePrediction.structuredFormat.secondaryText.text",
          ].join(","),
        },
        body: JSON.stringify({ input: query }),
      });

      span.setAttribute("http.status_code", res.status);

      if (!res.ok) {
        const message = await extractPlacesErrorMessage(res);
        const error = new ORPCError("GOOGLE_MAPS_ERROR", { message });
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      }

      const json = await res.json();
      const parsed = PlacesAutocompleteResponseSchema.safeParse(json);
      if (!parsed.success) {
        const error = new ORPCError("PARSE_ERROR", {
          message: `Places API response parse failed: ${parsed.error.message}`,
        });
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      }
      return parsed.data;
    } catch (error) {
      if (!(error instanceof ORPCError)) {
        span.recordException(
          error instanceof Error ? error : new Error(String(error))
        );
        span.setStatus({ code: SpanStatusCode.ERROR });
      }
      throw error;
    } finally {
      span.end();
    }
  });
}

export const os = implement(mapsContract)
  .use(requireAuth)
  .use(globalRateLimit)
  .use(mapsRateLimit);

export const mapsRouter = os.router({
  search: os.search.handler(async ({ input }) => {
    const query = input.query.trim();
    if (query.length < MIN_QUERY_LENGTH) {
      return [];
    }

    const data = await fetchAutocomplete(query);
    return mapSuggestions(data);
  }),
});
