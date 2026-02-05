# Maps & Location Search

## Overview
Location search uses the **Places API (New)** via a server-side oRPC route. The API key never ships to the client.

Primary entry points:
- Router: `packages/api/src/routers/maps/router.ts`
- Contract: `packages/api/src/routers/maps/contract.ts`
- Hook: `packages/state/src/hooks/use-location-search.ts`
- Maps URL helper: `packages/state/src/locations.ts`

## Server route
`maps.search` calls:
- `POST https://places.googleapis.com/v1/places:autocomplete`

Headers:
- `X-Goog-Api-Key: ${GOOGLE_MAPS_API_KEY}`
- `X-Goog-FieldMask: suggestions.placePrediction.placeId, suggestions.placePrediction.place, suggestions.placePrediction.text.text, suggestions.placePrediction.structuredFormat.mainText.text, suggestions.placePrediction.structuredFormat.secondaryText.text`

Parsing:
- Reads `suggestions[].placePrediction`
- `description` from `text.text` (fallback to `mainText + secondaryText`)
- `placeId` from `placeId` or `place` resource name suffix

## Debounce + query behavior
`useLocationSearch(query)`:
- Debounces input by 500ms
- Does not query for strings shorter than 2 characters
- Uses React Query with `keepPreviousData` to avoid flicker

## UI usage
- Web popover: `apps/web/src/components/calendar/events/event-edit-popover.tsx`
- Native calendar modal: `apps/native/app/(tabs)/calendar.tsx`

Both UIs show suggestions as the user types and allow selection to fill the location field.

## Maps shortcut
`getMapsSearchUrl(location)` creates a Google Maps search URL and is used for the “open in maps” icon next to the location field.

## Environment
Set the server-side key:
- `GOOGLE_MAPS_API_KEY`

