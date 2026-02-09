import { env } from "@kompose/env";
import { implement, ORPCError } from "@orpc/server";
import { requireAuth } from "../..";
import { globalRateLimit, mapsRateLimit } from "../../ratelimit";
import { mapsContract } from "./contract";

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const MIN_QUERY_LENGTH = 2;

interface PlacesAutocompleteResponse {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      place?: string;
      text?: { text?: string };
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
    };
  }>;
  error?: { message?: string };
  message?: string;
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

    const response = await fetch(AUTOCOMPLETE_URL, {
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
      body: JSON.stringify({
        input: query,
      }),
    });
    if (!response.ok) {
      // Try to extract error details from response body for better debugging
      let errorDetails = "";
      try {
        const errorBody = (await response.json()) as {
          error?: { message?: string };
          message?: string;
        };
        errorDetails = errorBody.error?.message ?? errorBody.message ?? "";
      } catch {
        // Response body not JSON, ignore
      }
      const message = `Places API error (${response.status})${errorDetails ? `: ${errorDetails}` : ""}`;
      throw new ORPCError("GOOGLE_MAPS_ERROR", { message });
    }

    const data = (await response.json()) as PlacesAutocompleteResponse;
    if (data.error?.message || data.message) {
      throw new ORPCError("GOOGLE_MAPS_ERROR", {
        message: data.error?.message ?? data.message ?? "Places API error",
      });
    }

    const suggestions = data.suggestions ?? [];

    return suggestions.flatMap((suggestion) => {
      const prediction = suggestion.placePrediction;
      if (!prediction) {
        return [];
      }

      const primary = prediction.structuredFormat?.mainText?.text ?? "";
      const secondary = prediction.structuredFormat?.secondaryText?.text;
      const description =
        prediction.text?.text ??
        [primary, secondary].filter(Boolean).join(", ");
      if (!description) {
        return [];
      }

      // Use || to treat empty strings as falsy and fall through to next option
      const placeId =
        prediction.placeId || prediction.place?.split("/").pop() || undefined;

      return [
        {
          description,
          placeId,
          primary: primary || description,
          secondary,
        },
      ];
    });
  }),
});
