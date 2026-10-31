import { Injectable } from '@nestjs/common';
import { config } from '../config';
import { HttpError, requestJson } from './http';

// Plane's public API (/api/v1, X-Api-Key), Plane CE v1.4: what Kara needs and
// no more. The key is a workspace admin's personal access token; Plane
// answers as that person.

export interface PlaneProject { id: string; identifier: string; name: string; archived_at?: string | null }
export interface PlaneState { id: string; name: string; group: string }
export interface PlaneUserLite { id: string; email?: string; display_name?: string; first_name?: string; last_name?: string }
export interface PlaneIssue {
  id: string;
  name: string;
  project: string;
  workspace?: string;
  sequence_id?: number;
  priority?: string;
  state?: string | PlaneState | null;
  assignees?: (string | PlaneUserLite)[];
  start_date?: string | null;
  target_date?: string | null;
  updated_at?: string;
  deleted_at?: string | null;
  description_stripped?: string | null;
}
export interface PlaneMember extends PlaneUserLite { role: number }
export interface PlaneInvitation { id: string; email: string; role: number; accepted: boolean; responded_at: string | null }

/** Plane's workspace roles. */
export const PLANE_ROLE = { admin: 20, member: 15, guest: 5 } as const;

interface Page<T> { results: T[]; next_cursor?: string; next_page_results?: boolean }

@Injectable()
export class PlaneClient {
  get configured() { return !!config.team.plane.apiKey; }
  get workspace() { return config.team.plane.workspace; }

  private req<T>(method: string, path: string, body?: unknown) {
    return requestJson<T>({
      baseUrl: `${config.team.plane.url}/api/v1`, name: 'plane', timeoutMs: config.team.plane.timeoutMs,
      headers: () => ({ 'X-Api-Key': config.team.plane.apiKey }),
    }, method, path, body);
  }

  private ws(path: string) { return `/workspaces/${encodeURIComponent(this.workspace)}${path}`; }

  /** Every page of a cursor-paginated list. */
  private async all<T>(path: string, perPage = 100): Promise<T[]> {
    const out: T[] = [];
    let cursor = `${perPage}:0:0`;
    for (let i = 0; i < 1000; i++) {
      const sep = path.includes('?') ? '&' : '?';
      const page = await this.req<Page<T> | T[]>('GET', `${path}${sep}per_page=${perPage}&cursor=${cursor}`);
      if (Array.isArray(page)) return page; // an endpoint that does not paginate
      out.push(...page.results);
      if (!page.next_page_results || !page.next_cursor) break;
      cursor = page.next_cursor;
    }
    return out;
  }

  me() { return this.req<PlaneUserLite>('GET', '/users/me/'); }

  projects() { return this.all<PlaneProject>(this.ws('/projects/')); }

  states(projectId: string) { return this.all<PlaneState>(this.ws(`/projects/${projectId}/states/`)); }

  issues(projectId: string) { return this.all<PlaneIssue>(this.ws(`/projects/${projectId}/issues/?expand=state`)); }

  issue(projectId: string, id: string) { return this.req<PlaneIssue>('GET', this.ws(`/projects/${projectId}/issues/${id}/?expand=state,assignees`)); }

  /** By its human key, e.g. ERP-42. */
  issueByKey(key: string) {
    const m = /^([A-Za-z0-9]+)-(\d+)$/.exec(key.trim());
    if (!m) throw new HttpError(400, `not an issue key: ${key}`);
    return this.req<PlaneIssue>('GET', this.ws(`/issues/${m[1].toUpperCase()}-${m[2]}/`));
  }

  members() { return this.req<PlaneMember[]>('GET', this.ws('/members/')); }

  /** A project's members (Plane users); a list or a page, depending on the version. */
  async projectMembers(projectId: string): Promise<PlaneUserLite[]> {
    const r = await this.req<PlaneUserLite[] | Page<PlaneUserLite & { member?: string }>>('GET', this.ws(`/projects/${projectId}/members/`));
    const list = Array.isArray(r) ? r : r.results;
    return list.map((u) => ({ ...u, id: (u as { member?: string }).member ?? u.id }));
  }

  invitations() { return this.all<PlaneInvitation>(this.ws('/invitations/')); }

  invite(email: string, role: number) { return this.req<PlaneInvitation>('POST', this.ws('/invitations/'), { email, role }); }

  updateInvitation(id: string, role: number) { return this.req<PlaneInvitation>('PATCH', this.ws(`/invitations/${id}/`), { role }); }

  deleteInvitation(id: string) { return this.req<void>('DELETE', this.ws(`/invitations/${id}/`)); }

  projectUrl(projectId: string) {
    return `${config.team.plane.publicUrl}/${encodeURIComponent(this.workspace)}/projects/${projectId}/issues`;
  }

  /** A browser link to an issue. */
  issueUrl(projectId: string, issueId: string) {
    return `${config.team.plane.publicUrl}/${encodeURIComponent(this.workspace)}/projects/${projectId}/issues/${issueId}`;
  }
}
