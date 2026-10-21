// Every setting, from the environment (the Helm chart sets them; secrets from
// the kara-keycloak and kara-db Secrets).

function str(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== '') return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} is not set`);
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} is not a number: ${v}`);
  return n;
}

function list(name: string, fallback = ''): string[] {
  return (process.env[name] ?? fallback).split(',').map(s => s.trim()).filter(Boolean);
}

const trim = (u: string) => u.replace(/\/+$/, '');

export const config = {
  port: num('PORT', 3001),
  /** Kara's own database (the same one kara-web uses: platform + tenant schemas). */
  databaseUrl: str('DATABASE_URL', 'postgres://simorgh:simorgh@localhost:5432/simorgh_ledger'),

  keycloak: {
    /** Realm `kara`, as the tokens name it (the public address). */
    issuer: trim(str('KEYCLOAK_ISSUER', 'https://auth.simorghai.com/realms/kara')),
    /** The same realm inside the cluster, for keys, tokens and the admin API. Empty: the issuer. */
    internalUrl: trim(str('KEYCLOAK_INTERNAL_URL', '')),
    /** This service's client (service account: users and organizations). */
    clientId: str('KEYCLOAK_CLIENT_ID', 'kara-api'),
    clientSecret: str('KEYCLOAK_CLIENT_SECRET', ''),
    /**
     * Clients whose service-account token may act for a Kara account named in
     * X-Kara-Account (kara-web, which keeps its own session for the user).
     */
    trustedClients: list('TRUSTED_CLIENTS', 'kara-web'),
    /** How long an invitation link (set your password) stays valid. */
    inviteLifespanSeconds: num('INVITE_LIFESPAN_SECONDS', 7 * 24 * 3600),
    /** Where the invitation sends the user afterwards. */
    inviteRedirectUri: str('INVITE_REDIRECT_URI', ''),
    inviteClientId: str('INVITE_CLIENT_ID', 'kara-web'),
    /**
     * Email domains whose people sign in through a linked identity provider
     * (Simorgh staff: realm simorgh). Keycloak creates their accounts on first
     * sign-in, so they are neither created nor invited here.
     */
    brokeredDomains: list('BROKERED_DOMAINS'),
  },

  erp: {
    /** The erp-connector; empty turns the ERP part off (tenants show "not linked"). */
    url: trim(str('ERP_CONNECTOR_URL', '')),
    /** Token for the connector: client credentials in realm simorgh … */
    tokenUrl: str('ERP_TOKEN_URL', ''),
    clientId: str('ERP_CLIENT_ID', 'kara-api'),
    clientSecret: str('ERP_CLIENT_SECRET', ''),
    /** … or a static token (STATIC_TOKENS on the connector), for a quick start. */
    staticToken: str('ERP_STATIC_TOKEN', ''),
    timeoutMs: num('ERP_TIMEOUT_MS', 30_000),
  },

  /**
   * Meetings and calls on Jitsi (meet.simorghai.com, token auth): Kara signs a
   * short-lived token per person and room with the secret Jitsi's prosody
   * also holds (Secret kara-jitsi, the same value as jitsi/jitsi-jwt).
   */
  jitsi: {
    /** Empty turns meetings and calls off. */
    url: trim(str('JITSI_URL', '')),
    appId: str('JITSI_APP_ID', 'kara'),
    audience: str('JITSI_AUDIENCE', 'jitsi'),
    /** Jitsi's XMPP domain (XMPP_DOMAIN of the chart): the token's `sub`. */
    subject: str('JITSI_SUBJECT', 'meet.jitsi'),
    secret: str('JITSI_JWT_SECRET', ''),
    tokenTtlSeconds: num('JITSI_TOKEN_TTL_SECONDS', 4 * 3600),
  },
  calls: {
    /** Unanswered for this long: a missed call. */
    ringSeconds: num('CALL_RING_SECONDS', 45),
  },

  kafka: {
    /** Empty: no events; read models only from the backfill. */
    brokers: list('KAFKA_BROKERS'),
    clientId: str('KAFKA_CLIENT_ID', 'kara-api'),
    groupId: str('KAFKA_GROUP_ID', 'kara-api'),
    ssl: str('KAFKA_SSL', 'false') === 'true',
  },
};
