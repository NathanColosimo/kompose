import { oc } from "@orpc/contract";
import { z } from "zod";

export const LocationSuggestionSchema = z.object({
  description: z.string(),
  placeId: z.string().optional(),
  primary: z.string(),
  secondary: z.string().optional(),
});

export type LocationSuggestion = z.infer<typeof LocationSuggestionSchema>;

export const SearchPlacesInputSchema = z.object({
  query: z.string().min(1),
});

export type SearchPlacesInput = z.infer<typeof SearchPlacesInputSchema>;

/**
 * Search Google Places for location suggestions.
 */
export const searchPlaces = oc
  .input(SearchPlacesInputSchema)
  .output(z.array(LocationSuggestionSchema));

export const mapsContract = {
  search: searchPlaces,
};
