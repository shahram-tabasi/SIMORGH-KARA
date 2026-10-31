// Who may read a document or a knowledge item — the rule of Kara's knowledge
// page, applied to everything the assistant searches: an item of a unit is for
// the people of that unit and of the units under it; an item of no unit is for
// the whole company. Pure, so the rule is tested on its own.

/** Is `prefix` the start of `path` (a unit and the units under it)? */
const startsWith = (path: string[], prefix: string[]) => prefix.length <= path.length && prefix.every((x, i) => x === path[i]);

/**
 * May a person in `memberUnits` (paths of names, e.g. ["Engineering","Electrical"])
 * read an item of `itemUnit` (empty: the whole company)?
 */
export function visible(itemUnit: string[], memberUnits: string[][]): boolean {
  if (!itemUnit.length) return true;
  return memberUnits.some((u) => startsWith(u, itemUnit));
}

/**
 * A Nextcloud path inside a company's folder → the unit that may read it, or
 * null when it must not be indexed (deny by default):
 *  - a file at the company folder's root, or under `_all` / `_همه`: the whole company;
 *  - a file under folders named like a Kara unit path: the deepest matching unit;
 *  - a file under a top-level folder that is no unit: not indexed (a private
 *    folder someone made must not become everyone's).
 */
export function unitForPath(path: string, units: string[][]): string[] | null {
  const parts = path.split('/').filter(Boolean);
  const folders = parts.slice(0, -1);
  if (!folders.length) return [];
  if (folders[0] === '_all' || folders[0] === '_همه') return [];
  let best: string[] | null = null;
  for (const u of units) if (u.length <= folders.length && startsWith(folders, u) && (!best || u.length > best.length)) best = u;
  return best;
}
