// Kara's companies, units and people in Odoo, through the erp-connector
// (docs/INTEGRATION.md §2): a company is its Odoo company (linked by
// platform.companies.odoo_company_id, made when missing), a unit a
// department, a person an employee (no Odoo user: Employee only).
//
// Like the Keycloak side, every step reads first and changes only the
// difference; records Kara made or took over carry its reference
// (kara:unit:<id>, kara:member:<account id>). A department or employee that
// was already there — same name under the same parent, same work email — is
// taken over (adopt) rather than doubled. A person who leaves is archived,
// never deleted: Odoo keeps their history.

import { ConnectorClient } from '../erp/connector.client';
import { CompanyFacts, UnitFacts, changed, memberRef, parentsFirst, primaryUnit, unitRef } from './plan';

interface Ref { id: number; name: string }
interface Department { id: number; ref: string | null; name: string; active: boolean; parent: Ref | null; manager: Ref | null; company: Ref | null }
interface Employee { id: number; ref: string | null; name: string; active: boolean; workEmail: string | null; jobTitle: string | null; department: Ref | null; company: Ref | null }
interface Page<T> { total: number; items: T[] }
interface RemoteKnowledge {
  id: number; ref: string | null; active: boolean; name: string; kind: string; code: string | null; summary: string | null;
  body: string | null; attributes: Record<string, unknown>; address: string | null; impact: string | null;
  effectiveDate: string | null; sequence: number;
}

/** A piece of company knowledge as Kara holds it (the tenant's `knowledge` table). */
export interface KnowledgeFacts {
  id: string; kind: string; name: string; code: string | null; summary: string | null; body: string | null;
  attributes: Record<string, unknown>; address: string | null; impact: string | null; effectiveDate: string | null;
  sequence: number; active: boolean;
}

export interface OdooCompany extends CompanyFacts {
  odooCompanyId: number | null;
  unitList: UnitFacts[];
  knowledge: KnowledgeFacts[];
}

export interface OdooMember {
  accountId: string;
  email: string;
  fullName: string;
  title: string | null;
  active: boolean;
  /** The units the person is in. */
  units: UnitFacts[];
}

export type Outcome = { status: 'ok' | 'absent'; externalId: string | null; detail: string };

const KARA = 'kara:';

export class OdooSync {
  constructor(
    private readonly connector: ConnectorClient,
    /** Records the Odoo company made for a Kara company. */
    private readonly linkCompany: (companyId: string, odooCompanyId: number) => Promise<void>,
  ) {}

  get configured() {
    return this.connector.configured;
  }

  /** Every page of a list (the connector gives at most 500 at a time). */
  private async all<T>(collection: string, params: Record<string, string>): Promise<T[]> {
    const out: T[] = [];
    for (let offset = 0; ; offset += 500) {
      const q = new URLSearchParams({ ...params, limit: '500', offset: String(offset), includeArchived: 'true' });
      const page = await this.connector.call<Page<T>>('GET', `/v1/${collection}?${q}`);
      out.push(...page.items);
      if (page.items.length < 500) return out;
    }
  }

  /** The Odoo company of a Kara company: the linked one, or a new one (same externalId as Admin's "create in Odoo"). */
  private async odooCompany(c: OdooCompany): Promise<number> {
    if (c.odooCompanyId) return c.odooCompanyId;
    const made = await this.connector.call<{ id: number; name: string }>('POST', '/v1/companies', {
      body: { name: c.name, externalId: `tenant:${c.slug}` },
    });
    await this.linkCompany(c.id, made.id);
    c.odooCompanyId = made.id;
    return made.id;
  }

  // ── A company: its Odoo company and its units as departments ─────────────

  async company(c: OdooCompany): Promise<Outcome> {
    const odooId = await this.odooCompany(c);
    const company = String(odooId);
    const departments = await this.all<Department>('departments', { companyId: company });
    const employees = await this.all<Employee>('employees', { companyId: company, externalIdPrefix: 'member:' });
    const employeeOf = new Map(employees.map((e) => [e.ref, e.id]));
    const karaEmployees = new Set(employees.map((e) => e.id));
    const byRef = new Map(departments.filter((d) => d.ref).map((d) => [d.ref!, d]));
    const odooIdOf = new Map<string, number>();
    let made = 0;
    let adopted = 0;
    let updated = 0;

    for (const u of parentsFirst(c.unitList)) {
      const ref = KARA + unitRef(u.id);
      const parentId = u.parentId ? odooIdOf.get(u.parentId) ?? null : null;
      let d = byRef.get(ref);
      if (!d) {
        // Already in Odoo by hand: same name under the same parent, nobody's yet.
        const same = departments.find((x) => !x.ref && x.name.trim() === u.name.trim() && (x.parent?.id ?? null) === parentId);
        if (same) {
          same.ref = ref; // not a second unit's to take
          d = await this.connector.call<Department>('POST', `/v1/departments/${same.id}/adopt`, { body: { externalId: unitRef(u.id) } });
          adopted += 1;
        } else {
          d = await this.connector.call<Department>('POST', '/v1/departments', {
            body: { externalId: unitRef(u.id), name: u.name, parentId, companyId: odooId },
          });
          made += 1;
        }
      }
      if (!d.active) await this.connector.call('POST', `/v1/departments/${d.id}/unarchive`);
      // The unit's manager; none in Kara clears only a manager Kara had set (one of its employees).
      const managerId = u.managerAccountId
        ? employeeOf.get(KARA + memberRef(u.managerAccountId))
        : d.manager && karaEmployees.has(d.manager.id) ? null : undefined;
      const diff = changed(
        { name: u.name, parentId, ...(managerId !== undefined ? { managerId } : {}) },
        { name: d.name, parentId: d.parent?.id ?? null, managerId: d.manager?.id ?? null },
      );
      if (Object.keys(diff).length) {
        await this.connector.call('PATCH', `/v1/departments/${d.id}`, { body: diff });
        updated += 1;
      }
      odooIdOf.set(u.id, d.id);
    }

    // Units deleted in Kara: their departments are archived (kept for history).
    const gone = departments.filter((d) => d.active && d.ref?.startsWith(KARA + 'unit:') && !c.unitList.some((u) => KARA + unitRef(u.id) === d.ref));
    for (const d of gone) await this.connector.call('POST', `/v1/departments/${d.id}/archive`);

    const k = await this.knowledge(c, odooId);

    const parts = [`company #${odooId}`, `${c.unitList.length} department(s)`, k];
    if (made) parts.push(`${made} made`);
    if (adopted) parts.push(`${adopted} taken over`);
    if (updated) parts.push(`${updated} updated`);
    if (gone.length) parts.push(`${gone.length} archived`);
    return { status: 'ok', externalId: company, detail: parts.join(', ') };
  }

  /** The company's knowledge as simorgh.knowledge (kara:knowledge:<id>); deleted in Kara → archived in Odoo. */
  private async knowledge(c: OdooCompany, odooId: number): Promise<string> {
    const remote = await this.all<RemoteKnowledge>('knowledge', { companyId: String(odooId), externalIdPrefix: 'knowledge:' });
    const byRef = new Map(remote.map((r) => [r.ref, r]));
    let made = 0;
    let updated = 0;
    let archived = 0;
    for (const k of c.knowledge) {
      const want = {
        name: k.name, kind: k.kind, code: k.code, summary: k.summary, body: k.body, attributes: k.attributes ?? {},
        address: k.address, impact: k.impact, effectiveDate: k.effectiveDate, sequence: k.sequence,
      };
      const r = byRef.get(`${KARA}knowledge:${k.id}`);
      if (!r) {
        if (!k.active) continue;
        await this.connector.call('POST', '/v1/knowledge', { body: { externalId: `knowledge:${k.id}`, ...want, companyId: odooId } });
        made += 1;
        continue;
      }
      const diff = changed(want, { ...r });
      if (Object.keys(diff).length) {
        await this.connector.call('PATCH', `/v1/knowledge/${r.id}`, { body: diff });
        updated += 1;
      }
      if (r.active !== k.active) {
        await this.connector.call('POST', `/v1/knowledge/${r.id}/${k.active ? 'unarchive' : 'archive'}`);
        if (!k.active) archived += 1;
      }
    }
    for (const r of remote) {
      if (r.active && !c.knowledge.some((k) => `${KARA}knowledge:${k.id}` === r.ref)) {
        await this.connector.call('POST', `/v1/knowledge/${r.id}/archive`);
        archived += 1;
      }
    }
    const n = c.knowledge.filter((k) => k.active).length;
    return [`${n} knowledge item(s)`, made && `${made} added`, updated && `${updated} changed`, archived && `${archived} archived`]
      .filter(Boolean).join(', ');
  }

  /**
   * A company deleted in Kara: what Kara made in its Odoo company — the
   * departments, employees and knowledge carrying a kara: reference — is
   * archived. Odoo keeps the company itself and its accounting (records a
   * business must keep); deleting those is a decision for Odoo, not Kara.
   */
  async archiveCompany(odooCompanyId: number): Promise<string> {
    const company = String(odooCompanyId);
    const counts: string[] = [];
    for (const [collection, prefix] of [['employees', 'member:'], ['departments', 'unit:'], ['knowledge', 'knowledge:']] as const) {
      const items = await this.all<{ id: number; active: boolean }>(collection, { companyId: company, externalIdPrefix: prefix });
      const live = items.filter((x) => x.active);
      for (const x of live) await this.connector.call('POST', `/v1/${collection}/${x.id}/archive`);
      counts.push(`${live.length} ${collection}`);
    }
    return `Odoo company #${odooCompanyId}: archived ${counts.join(', ')} (the company and its accounting stay in Odoo)`;
  }

  // ── A person: their employee ──────────────────────────────────────────────

  async member(c: OdooCompany, m: OdooMember | null, accountId: string): Promise<Outcome> {
    if (!c.odooCompanyId) throw new Error('the company is not in Odoo yet (its own job makes it; this one is retried)');
    const company = String(c.odooCompanyId);
    const [mine] = await this.all<Employee>('employees', { externalIdPrefix: memberRef(accountId) });

    if (!m || !m.active) {
      if (mine?.active) {
        await this.connector.call('POST', `/v1/employees/${mine.id}/archive`);
        return { status: 'absent', externalId: String(mine.id), detail: 'archived (no longer active in Kara)' };
      }
      return { status: 'absent', externalId: mine ? String(mine.id) : null, detail: 'not an active member' };
    }

    // The department: the person's main unit, when the company job has made it.
    const unit = primaryUnit(m.units);
    let departmentId: number | undefined;
    if (unit) {
      const [d] = await this.all<Department>('departments', { companyId: company, externalIdPrefix: unitRef(unit.id) });
      if (!d) throw new Error(`department of unit ${unit.name} not in Odoo yet (the company job makes it; this one is retried)`);
      departmentId = d.id;
    }

    let e = mine;
    let how = '';
    if (!e) {
      // Already in Odoo by hand: same work email in the same company, nobody's yet.
      const found = await this.all<Employee>('employees', { companyId: company, q: m.email });
      const same = found.find((x) => !x.ref && x.workEmail?.toLowerCase() === m.email.toLowerCase());
      if (same) {
        e = await this.connector.call<Employee>('POST', `/v1/employees/${same.id}/adopt`, { body: { externalId: memberRef(accountId) } });
        how = ', taken over';
      } else {
        e = await this.connector.call<Employee>('POST', '/v1/employees', {
          body: {
            externalId: memberRef(accountId), name: m.fullName, workEmail: m.email,
            ...(m.title ? { jobTitle: m.title } : {}), ...(departmentId ? { departmentId } : {}), companyId: c.odooCompanyId,
          },
        });
        how = ', made';
      }
    }
    if (e.company && e.company.id !== c.odooCompanyId) {
      throw new Error(`employee #${e.id} is in Odoo company #${e.company.id}, not #${c.odooCompanyId}: move it in Odoo`);
    }
    if (!e.active) {
      await this.connector.call('POST', `/v1/employees/${e.id}/unarchive`);
      how += ', unarchived';
    }
    const diff = changed(
      { name: m.fullName, workEmail: m.email, ...(m.title ? { jobTitle: m.title } : {}), ...(departmentId ? { departmentId } : {}) },
      { name: e.name, workEmail: e.workEmail, jobTitle: e.jobTitle, departmentId: e.department?.id ?? null },
    );
    if (Object.keys(diff).length) {
      await this.connector.call('PATCH', `/v1/employees/${e.id}`, { body: diff });
      how += `, updated ${Object.keys(diff).join(', ')}`;
    }

    // The units this person manages: their departments' manager.
    const managed = c.unitList.filter((u) => u.managerAccountId === accountId);
    for (const u of managed) {
      const [d] = await this.all<Department>('departments', { companyId: company, externalIdPrefix: unitRef(u.id) });
      if (d && d.manager?.id !== e.id) await this.connector.call('PATCH', `/v1/departments/${d.id}`, { body: { managerId: e.id } });
    }

    return {
      status: 'ok', externalId: String(e.id),
      detail: `employee #${e.id}${unit ? `, department ${unit.path.join(' / ')}` : ''}${managed.length ? `, manages ${managed.length}` : ''}${how}`,
    };
  }
}
