/** Routes are plain hashes: #/ is the home view, #/entry/<id> is one entry. */
export const HOME_ROUTE = '#/';
export const entryRoute = (id) => `#/entry/${encodeURIComponent(id)}`;

export function routeEntryId(hash) {
  const match = /^#\/entry\/(.+)$/.exec(hash);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}
