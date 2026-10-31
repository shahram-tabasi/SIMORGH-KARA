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

/** "offer=offer,engineering=simorgh-engineer" → { offer: 'offer', engineering: 'simorgh-engineer' }. */
function mapping(v: string): Record<string, string> {
  return Object.fromEntries(v.split(',').map(p => p.split('=').map(x => x.trim())).filter(([k, r]) => k && r));
}

/** Another realm on the same Keycloak as realm kara (inside the cluster when configured). */
function realmUrlOf(realm: string): string {
  const base = trim(process.env.KEYCLOAK_INTERNAL_URL || process.env.KEYCLOAK_ISSUER || 'https://auth.simorghai.com/realms/kara');
  return base.replace(/\/realms\/[^/]+$/, `/realms/${realm}`);
}

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
    /** Odoo as people open it: links to the engineering changes Design Suite sends. */
    publicUrl: trim(str('ODOO_PUBLIC_URL', 'https://erp.simorghai.com')),
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

  /**
   * Provisioning (docs/INTEGRATION.md): Kara's companies, units, people and
   * app access into each app's Keycloak realm (and Odoo). An app with no
   * client secret is left out.
   */
  provision: {
    enabled: str('PROVISION_ENABLED', 'true') === 'true',
    pollMs: num('PROVISION_POLL_MS', 3000),
    maxAttempts: num('PROVISION_MAX_ATTEMPTS', 8),
    /** Every company and person checked again this often (hours; 0: never): drift is repaired. */
    reconcileHours: num('PROVISION_RECONCILE_HOURS', 24),
    apps: [
      {
        key: 'designSuite' as const,
        target: 'kc:simorgh',
        // Its own realm: simorgh (as today). Client kara-api there (the one the erp-connector trusts).
        realmUrl: trim(str('PROVISION_DS_REALM_URL', realmUrlOf('simorgh'))),
        clientId: str('PROVISION_DS_CLIENT_ID', str('ERP_CLIENT_ID', 'kara-api')),
        clientSecret: str('PROVISION_DS_CLIENT_SECRET', str('ERP_CLIENT_SECRET', '')),
        // Kara's role → the realm's role.
        roles: mapping(str('PROVISION_DS_ROLES', 'offer=offer,engineering=simorgh-engineer')),
        inviteClientId: str('PROVISION_DS_INVITE_CLIENT', 'simorgh-web'),
        inviteRedirectUri: str('PROVISION_DS_INVITE_REDIRECT', ''),
      },
      {
        key: 'hrChatbot' as const,
        target: 'kc:hr',
        realmUrl: trim(str('PROVISION_HR_REALM_URL', realmUrlOf('hr'))),
        clientId: str('PROVISION_HR_CLIENT_ID', 'kara-provisioner'),
        clientSecret: str('PROVISION_HR_CLIENT_SECRET', ''),
        roles: mapping(str('PROVISION_HR_ROLES', 'user=hr-user')),
        inviteClientId: str('PROVISION_HR_INVITE_CLIENT', 'simorgh-hr-chatbot'),
        inviteRedirectUri: str('PROVISION_HR_INVITE_REDIRECT', ''),
      },
    ],
  },

  /**
   * GET /v1/context: what an app (Design Suite, the HR chatbot) should know
   * about its signed-in user's company. The app passes the user's token from
   * its own realm; the realm decides which app is asking.
   */
  context: {
    apps: [
      { realm: 'simorgh', app: 'designSuite' as const, jwksUrl: `${realmUrlOf('simorgh')}/protocol/openid-connect/certs` },
      { realm: 'hr', app: 'hrChatbot' as const, jwksUrl: `${realmUrlOf('hr')}/protocol/openid-connect/certs` },
    ],
    /** The public address tokens are issued for (iss), besides the in-cluster one. */
    publicBase: trim(str('KEYCLOAK_ISSUER', 'https://auth.simorghai.com/realms/kara')).replace(/\/realms\/[^/]+$/, ''),
    internalBase: trim(process.env.KEYCLOAK_INTERNAL_URL || '').replace(/\/realms\/[^/]+$/, ''),
    /**
     * Service accounts that may ask for any company of their app with
     * ?company=<slug> (an app's ingestion job), as realm:client.
     */
    serviceClients: list('CONTEXT_SERVICE_CLIENTS', ''),
    cacheSeconds: num('CONTEXT_CACHE_SECONDS', 60),
  },

  /**
   * The Team Platform (docs/TEAM-PLATFORM.md): Plane for project work,
   * Mattermost for team chat. Each part is off while its credentials are empty.
   */
  team: {
    plane: {
      /** Plane's API inside the cluster; the public address for links people open. */
      url: trim(str('PLANE_URL', 'http://plane-api.plane.svc.cluster.local:8000')),
      publicUrl: trim(str('PLANE_PUBLIC_URL', 'https://plane.simorghai.com')),
      /** The workspace Kara manages (its slug in Plane's URLs). */
      workspace: str('PLANE_WORKSPACE', 'simorgh'),
      /** A workspace admin's API token (Plane → Profile → Personal access tokens). Empty: Plane off. */
      apiKey: str('PLANE_API_KEY', ''),
      /** The secret Plane shows for the webhook to Kara: deliveries without its signature are refused. */
      webhookSecret: str('PLANE_WEBHOOK_SECRET', ''),
      /** Every issue loaded again from the API this often (hours; 0: only on start). */
      backfillHours: num('PLANE_BACKFILL_HOURS', 6),
      timeoutMs: num('PLANE_TIMEOUT_MS', 20_000),
    },
    mattermost: {
      url: trim(str('MATTERMOST_URL', 'http://mattermost.mattermost.svc.cluster.local:8065')),
      publicUrl: trim(str('MATTERMOST_PUBLIC_URL', 'https://team.simorghai.com')),
      /** Token of the system-admin bot kara-provisioner (accounts, teams). Empty: Mattermost off. */
      adminToken: str('MATTERMOST_ADMIN_TOKEN', ''),
      /** Token of the bot simorgh-assistant (direct messages, the assistant's answers). */
      botToken: str('MATTERMOST_BOT_TOKEN', ''),
      /** Slash-command tokens Mattermost sends with /ask, /mytasks … (comma-separated). */
      commandTokens: list('MATTERMOST_COMMAND_TOKENS'),
      timeoutMs: num('MATTERMOST_TIMEOUT_MS', 15_000),
    },
    /**
     * Kara's "GitLab" sign-in adapter (src/sso): Plane and Mattermost (free
     * editions) sign in with GitLab OAuth only; Kara answers as GitLab and
     * signs people in with Keycloak (client kara-team-sso, realm kara).
     */
    sso: {
      /** Where browsers reach the adapter (the Kara gateway routes /sso/gitlab here). */
      publicBase: trim(str('SSO_PUBLIC_BASE', 'https://kara.simorghai.com/sso/gitlab')),
      keycloakClientId: str('SSO_KEYCLOAK_CLIENT_ID', 'kara-team-sso'),
      keycloakClientSecret: str('SSO_KEYCLOAK_CLIENT_SECRET', ''),
      /** The apps that may use it: client id → secret, allowed redirect prefix, Kara app key. */
      clients: [
        { id: 'plane', secret: str('SSO_PLANE_CLIENT_SECRET', ''), app: 'plane' as const,
          redirectPrefix: str('SSO_PLANE_REDIRECT_PREFIX', 'https://plane.simorghai.com/auth/gitlab/callback') },
        { id: 'mattermost', secret: str('SSO_MATTERMOST_CLIENT_SECRET', ''), app: 'mattermost' as const,
          redirectPrefix: str('SSO_MATTERMOST_REDIRECT_PREFIX', 'https://team.simorghai.com/signup/gitlab/complete') },
      ],
      tokenTtlSeconds: num('SSO_TOKEN_TTL_SECONDS', 3600),
    },
    /** Mattermost accounts made by Kara sign in through the adapter ("gitlab") or by email and password. */
    mattermostAuth: str('MATTERMOST_AUTH', 'email') as 'email' | 'gitlab',
    /** Where Mattermost sends the assistant's slash commands (kara-api inside the cluster). */
    commandUrl: str('MATTERMOST_COMMAND_URL', 'http://kara-api.kara.svc.cluster.local:3001/v1/team/mattermost/command'),
    /** The Mattermost channels every member of a company's team joins. */
    defaultChannels: list('MATTERMOST_DEFAULT_CHANNELS', 'town-square,announcements,kara-notifications'),
    /**
     * The Team Assistant (src/assistant): the office LLM through llm-gateway
     * (OpenAI-compatible, key team-assistant), tools answered by Kara as the
     * asking person. Empty key: /ask is off, the plain commands still work.
     */
    assistant: {
      llmUrl: trim(str('LLM_URL', 'https://llm.simorghai.com/v1')),
      llmApiKey: str('LLM_API_KEY', ''),
      model: str('LLM_MODEL', 'qwen3.8-27b'),
      timeoutMs: num('LLM_TIMEOUT_MS', 120_000),
      maxToolRounds: num('ASSISTANT_MAX_TOOL_ROUNDS', 5),
      /** n8n's service token (Secret kara-team assistantServiceToken): /v1/assistant/* for workflows. */
      serviceToken: str('ASSISTANT_SERVICE_TOKEN', ''),
    },
    /** Phase 4: Kara's own notices (kartabl items, tasks) as direct messages; how often to look (s; 0: off). */
    noticePollSeconds: num('TEAM_NOTICE_POLL_SECONDS', 60),
    /** Kafka topic for Plane's issue events (others may follow them). */
    planeTopic: str('PLANE_KAFKA_TOPIC', 'plane.issue.v1'),
  },

  kafka: {
    /** Empty: no events; read models only from the backfill. */
    brokers: list('KAFKA_BROKERS'),
    clientId: str('KAFKA_CLIENT_ID', 'kara-api'),
    groupId: str('KAFKA_GROUP_ID', 'kara-api'),
    ssl: str('KAFKA_SSL', 'false') === 'true',
  },
};
