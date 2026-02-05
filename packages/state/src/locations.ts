export function getMapsSearchUrl(location: string): string {
  const trimmed = location.trim();
  const query = encodeURIComponent(trimmed);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}
