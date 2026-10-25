// What a company or a person should be in an app's Keycloak realm, worked out
// from Kara alone (docs/INTEGRATION.md). Pure: the provisioner compares this
// with what the realm holds and makes the difference.

export type AppKey = 'designSuite' | 'hrChatbot' | 'erp';

export interface CompanyFacts {
  id: string;
  slug: string;
  name: string;
  status: string;
  apps: Partial<Record<AppKey, boolean>>;
  /** Every unit of the company as a path of names: ["Engineering", "Electrical"]. */
  units: string[][];
}

export interface MemberFacts {
  accountId: string;
  email: string;
  fullName: string;
  accountActive: boolean;
  memberActive: boolean;
  /** The member's units as paths of names. */
  units: string[][];
  /** Kara's app roles: { designSuite: ['offer'], hrChatbot: ['user'] }. */
  apps: Partial<Record<AppKey, string[]>>;
}

export interface AppMapping {
  key: AppKey;
  /** Kara role → the realm's role. */
  roles: Record<string, string>;
}

/** A Keycloak group name: no slashes (they are the path separator). */
export const groupName = (s: string) => s.replace(/\//g, '-').trim() || '-';

/** The root of a company's groups in an app realm. */
export const companyRoot = (slug: string) => `/companies/${groupName(slug)}`;

export const unitPath = (slug: string, unit: string[]) => `${companyRoot(slug)}/${unit.map(groupName).join('/')}`;

/** Does the company have the app, and may its people use it now? */
export const companyUses = (c: CompanyFacts, app: AppKey) => c.status === 'active' && !!c.apps[app];

export interface MemberPlan {
  /** Should the person have an enabled account in the app's realm? */
  present: boolean;
  /** Realm roles they should hold (of the ones Kara manages there). */
  roles: string[];
  /** Group paths they should be in (under the company's root). */
  groups: string[];
}

/**
 * The person in one app realm: present with the app's roles mapped, the
 * company's own role (when the realm has one by the company's slug, as `ekc`
 * in realm simorgh) and their units — or absent: no role in the app, the
 * company without the app or suspended, or the person disabled.
 */
export function planMember(c: CompanyFacts, m: MemberFacts, map: AppMapping, companyRoleExists: boolean): MemberPlan {
  const granted = (m.apps[map.key] ?? []).map((r) => map.roles[r]).filter((r): r is string => !!r);
  const present = companyUses(c, map.key) && m.accountActive && m.memberActive && granted.length > 0;
  if (!present) return { present: false, roles: [], groups: [] };
  const roles = [...new Set([...granted, ...(companyRoleExists ? [c.slug] : [])])].sort();
  const groups = [...new Set(m.units.map((u) => unitPath(c.slug, u)))].sort();
  return { present, roles, groups };
}

/** The roles Kara manages in a realm: the app's mapped roles and the company's role. Others are left alone. */
export const managedRoles = (map: AppMapping, slug: string, companyRoleExists: boolean) =>
  new Set([...Object.values(map.roles), ...(companyRoleExists ? [slug] : [])]);

export interface Diff<T> { add: T[]; remove: T[] }

/** What to add and remove so `have` becomes `want`, looking only at `managed` (null: everything). */
export function diff(want: string[], have: string[], managed: (x: string) => boolean): Diff<string> {
  const w = new Set(want);
  const h = new Set(have.filter(managed));
  return { add: [...w].filter((x) => !h.has(x)), remove: [...h].filter((x) => !w.has(x)) };
}

/** The group paths a company should have in a realm: its root and every unit with its parents. */
export function companyGroupPaths(c: CompanyFacts): string[] {
  const out = new Set<string>([companyRoot(c.slug)]);
  for (const u of c.units) for (let i = 1; i <= u.length; i++) out.add(unitPath(c.slug, u.slice(0, i)));
  return [...out].sort();
}

// ── Odoo (departments and employees) ────────────────────────────────────────

/** A unit of the company as Odoo needs it. */
export interface UnitFacts {
  id: string;
  name: string;
  parentId: string | null;
  /** The account of the unit's manager, if any. */
  managerAccountId: string | null;
  path: string[];
}

/** Does the company keep its units and people in Odoo now? */
export const companyUsesOdoo = (c: CompanyFacts) => c.status === 'active' && !!c.apps.erp;

/** Parents before children, so each department's parent exists when it is made. */
export function parentsFirst(units: UnitFacts[]): UnitFacts[] {
  return [...units].sort((a, b) => a.path.length - b.path.length || a.path.join('/').localeCompare(b.path.join('/')));
}

/**
 * The one department an employee has in Odoo, from the person's units in
 * Kara (who may be in several): the deepest, then the first by path. None
 * when the person has no unit — Odoo's department is then left as it is.
 */
export function primaryUnit(units: UnitFacts[]): UnitFacts | undefined {
  return [...units].sort((a, b) => b.path.length - a.path.length || a.path.join('/').localeCompare(b.path.join('/')))[0];
}

/** Kara's references in Odoo (the connector adds the caller: `kara:unit:<id>`). */
export const unitRef = (id: string) => `unit:${id}`;
export const memberRef = (accountId: string) => `member:${accountId}`;

/** Only the fields that differ, for a PATCH; empty when nothing changed. */
export function changed(want: Record<string, unknown>, have: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(want).filter(([k, v]) => v !== undefined && JSON.stringify(v ?? null) !== JSON.stringify(have[k] ?? null)));
}

