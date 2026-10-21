import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { createRemoteJWKSet, JWTPayload, jwtVerify } from 'jose';
import { config } from '../config';

const kc = config.keycloak;
/** Realm `kara` as this pod reaches it (inside the cluster when configured). */
export const realmUrl = kc.internalUrl || kc.issuer;

const jwks = createRemoteJWKSet(new URL(`${realmUrl}/protocol/openid-connect/certs`));

export interface KaraToken extends JWTPayload {
  azp?: string;
  client_id?: string;
  email?: string;
  email_verified?: boolean;
  preferred_username?: string;
  name?: string;
}

/** A realm-kara access token, checked against the realm's keys and issuer. */
export async function verifyToken(token: string): Promise<KaraToken> {
  const { payload } = await jwtVerify(token, jwks, { issuer: kc.issuer });
  return payload as KaraToken;
}

/** A client-credentials token, kept until shortly before it expires. */
export class ServiceToken {
  private token = '';
  private until = 0;
  private pending?: Promise<string>;

  constructor(private readonly tokenUrl: string, private readonly clientId: string, private readonly secret: string) {}

  get configured(): boolean {
    return !!(this.tokenUrl && this.clientId && this.secret);
  }

  async get(): Promise<string> {
    if (this.token && Date.now() < this.until) return this.token;
    this.pending ??= this.fetch().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private async fetch(): Promise<string> {
    const res = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.clientId, client_secret: this.secret }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`token for ${this.clientId} from ${this.tokenUrl}: HTTP ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = body.access_token;
    this.until = Date.now() + Math.max(body.expires_in - 30, 10) * 1000;
    return this.token;
  }
}

export interface KcUser {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled: boolean;
  emailVerified?: boolean;
  federationLink?: string;
}

export interface KcOrganization {
  id: string;
  alias: string;
  name: string;
  enabled: boolean;
}

/** The few admin-API calls Kara needs: users, organizations, invitations. */
export class KeycloakAdmin {
  private readonly log = new Logger('KeycloakAdmin');
  private readonly base = realmUrl.replace('/realms/', '/admin/realms/');
  private readonly token = new ServiceToken(`${realmUrl}/protocol/openid-connect/token`, kc.clientId, kc.clientSecret);

  get configured(): boolean {
    return this.token.configured;
  }

  private async call<T>(method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<{ status: number; body: T; location?: string }> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${await this.token.get()}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!res.ok && !okStatuses.includes(res.status)) {
      this.log.error(`${method} ${path}: HTTP ${res.status} ${text.slice(0, 300)}`);
      throw new HttpException(`Keycloak refused ${method} ${path.split('?')[0]} (HTTP ${res.status})`, HttpStatus.BAD_GATEWAY);
    }
    return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T, location: res.headers.get('location') ?? undefined };
  }

  async userByEmail(email: string): Promise<KcUser | undefined> {
    const { body } = await this.call<KcUser[]>('GET', `/users?email=${encodeURIComponent(email)}&exact=true&briefRepresentation=false`);
    return body.find(u => u.email?.toLowerCase() === email.toLowerCase());
  }

  async createUser(user: Omit<KcUser, 'id'>): Promise<string> {
    const { location } = await this.call('POST', '/users', user);
    const id = location?.split('/').pop();
    if (!id) throw new Error('Keycloak created the user but gave no id');
    return id;
  }

  async updateUser(id: string, changes: Partial<KcUser>): Promise<void> {
    await this.call('PUT', `/users/${id}`, changes);
  }

  async hasPassword(id: string): Promise<boolean> {
    const { body } = await this.call<{ type: string }[]>('GET', `/users/${id}/credentials`);
    return body.some(c => c.type === 'password');
  }

  /** Email with a link to set a password (UPDATE_PASSWORD). Needs the realm's SMTP. */
  async invite(id: string): Promise<void> {
    const q = new URLSearchParams({ lifespan: String(kc.inviteLifespanSeconds) });
    if (kc.inviteRedirectUri) {
      q.set('client_id', kc.inviteClientId);
      q.set('redirect_uri', kc.inviteRedirectUri);
    }
    await this.call('PUT', `/users/${id}/execute-actions-email?${q}`, ['UPDATE_PASSWORD']);
  }

  /** Exact lookup by alias: the search parameter matches names and domains, so filter here. */
  async organizationByAlias(alias: string): Promise<KcOrganization | undefined> {
    for (let first = 0; ; first += 100) {
      const { body } = await this.call<KcOrganization[]>('GET', `/organizations?first=${first}&max=100&briefRepresentation=true`);
      const hit = body.find(o => o.alias === alias);
      if (hit || body.length < 100) return hit;
    }
  }

  async ensureOrganization(alias: string, name: string): Promise<KcOrganization> {
    const found = await this.organizationByAlias(alias);
    if (found) {
      if (found.name !== name) {
        const { body: full } = await this.call<Record<string, unknown>>('GET', `/organizations/${found.id}`);
        await this.call('PUT', `/organizations/${found.id}`, { ...full, name });
      }
      return found;
    }
    // A name must be unique in the realm: two tenants may share a display name.
    const { status } = await this.call('POST', '/organizations', { alias, name, enabled: true }, [409]);
    if (status === 409) await this.call('POST', '/organizations', { alias, name: `${name} (${alias})`, enabled: true });
    const made = await this.organizationByAlias(alias);
    if (!made) throw new Error(`organization ${alias} was created but cannot be found`);
    return made;
  }

  /** Adds the user to the organization; already a member is fine. */
  async addMember(orgId: string, userId: string): Promise<void> {
    await this.call('POST', `/organizations/${orgId}/members`, userId, [409]);
  }

  async memberOrganizations(userId: string): Promise<KcOrganization[]> {
    const { body } = await this.call<KcOrganization[]>('GET', `/organizations/members/${userId}/organizations?briefRepresentation=true`);
    return body;
  }

  async removeMember(orgId: string, userId: string): Promise<void> {
    await this.call('DELETE', `/organizations/${orgId}/members/${userId}`, undefined, [404]);
  }
}
