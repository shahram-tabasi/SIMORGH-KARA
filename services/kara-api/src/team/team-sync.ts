import { createHash, randomBytes } from 'crypto';
import type { DbService } from '../infra/db.service';
import { config } from '../config';
import { splitName } from '../identity/identity.service';
import type { CompanyFacts, MemberFacts } from '../provisioning/plan';
import { MattermostClient, teamNameFor, usernameFor } from './mattermost.client';
import { PLANE_ROLE, PlaneClient } from './plane.client';
import { gitlabIdOf, TeamAccessService, TeamApp } from './team-access.service';

const ASSISTANT_COMMANDS = [
  { trigger: 'mytasks', name: 'کارهای من', desc: 'کارهای باز شما: Plane، میز کار و کارتابل', hint: '' },
  { trigger: 'project', name: 'وضعیت پروژه', desc: 'وضعیت یک پروژه Plane', hint: 'ERP' },
  { trigger: 'issue', name: 'جزئیات کار', desc: 'جزئیات یک کار Plane', hint: 'ERP-42' },
  { trigger: 'ask', name: 'دستیار سیمرغ', desc: 'پرسش آزاد از دستیار سیمرغ', hint: 'سؤال شما' },
];

export interface TeamOutcome { status: 'ok' | 'absent'; externalId: string | null; detail: string }

/** Kara's Plane roles → Plane's workspace role numbers; the highest wins. Exported for tests. */
export function planeRoleFor(roles: string[]): number | null {
  const n = roles.map((r) => (PLANE_ROLE as Record<string, number>)[r]).filter((x): x is number => typeof x === 'number');
  return n.length ? Math.max(...n) : null;
}

/** Does the person get the app now? The provisioner's rule (planMember) for a non-Keycloak target. Exported for tests. */
export function teamPresent(c: CompanyFacts | null, m: MemberFacts | null, app: TeamApp): boolean {
  return !!c && !!m && c.status === 'active' && !!(c.apps as Record<string, boolean>)[app]
    && m.accountActive && m.memberActive && (m.apps as Record<string, string[] | undefined>)[app]?.length! > 0;
}

/**
 * Plane and Mattermost as provisioning targets (docs/TEAM-PLATFORM.md §5.1),
 * next to the Keycloak realms and Odoo. Same rules: look first, change only
 * the difference, never touch an account Kara did not make beyond its access.
 *
 * Mattermost: a team per company (its slug), the default channels, an account
 * per person (signing in through Kara's "GitLab" adapter when
 * MATTERMOST_AUTH=gitlab, else email + a reset link), deactivated when the
 * person loses the app. Plane: one workspace; a person gets an invitation
 * with their role (Plane's API cannot add or remove members directly). Taking
 * Plane away withdraws a pending invitation; for someone who already joined,
 * the adapter refuses their sign-in and the detail says to remove them in
 * Plane.
 */
export class TeamSync {
  constructor(private readonly mm: MattermostClient, private readonly plane: PlaneClient, private readonly ids: TeamAccessService, private readonly db: DbService) {}

  targets(): TeamApp[] {
    return [...(this.mm.configured ? ['mattermost' as const] : []), ...(this.plane.configured ? ['plane' as const] : [])];
  }

  // ── A company ────────────────────────────────────────────────────────────
  async company(app: TeamApp, c: CompanyFacts): Promise<TeamOutcome> {
    if (!(c.apps as Record<string, boolean>)[app] || c.status !== 'active') {
      return { status: 'absent', externalId: null, detail: c.status !== 'active' ? 'company suspended' : 'app not enabled' };
    }
    if (app === 'plane') return { status: 'ok', externalId: this.plane.workspace, detail: `workspace ${this.plane.workspace}` };
    const team = await this.mm.ensureTeam(teamNameFor(c.slug), c.name);
    for (const ch of config.team.defaultChannels) {
      if (ch === 'town-square' || ch === 'off-topic') continue; // made with the team
      await this.mm.ensureChannel(team.id, ch, ch === 'announcements' ? 'اطلاعیه‌ها' : ch === 'kara-notifications' ? 'اعلان‌های کارا' : ch);
    }
    const cmds = await this.commands(team.id);
    return { status: 'ok', externalId: team.id, detail: `team ${team.name}, channels ${config.team.defaultChannels.join(', ')}, commands ${cmds}` };
  }

  /** The assistant's slash commands in a team, pointing at kara-api; their tokens (hashed) for the command endpoint. */
  private async commands(teamId: string): Promise<string> {
    const have = await this.mm.teamCommands(teamId);
    const out: string[] = [];
    for (const d of ASSISTANT_COMMANDS) {
      const want = { team_id: teamId, trigger: d.trigger, method: 'P' as const, url: config.team.commandUrl, display_name: d.name,
        description: d.desc, auto_complete: true, auto_complete_desc: d.desc, auto_complete_hint: d.hint, username: 'simorgh-assistant' };
      let cmd = have.find((c) => c.trigger === d.trigger);
      if (!cmd) cmd = await this.mm.createCommand(want);
      else if (cmd.url !== want.url || cmd.method !== 'P' || cmd.auto_complete_desc !== d.desc) cmd = await this.mm.updateCommand({ ...cmd, ...want });
      await this.db.query(`INSERT INTO kara_team.mm_commands (team_id, trigger, command_id, token_hash) VALUES ($1, $2, $3, $4)
        ON CONFLICT (team_id, trigger) DO UPDATE SET command_id = $3, token_hash = $4, updated_at = now()`,
      [teamId, d.trigger, cmd.id, createHash('sha256').update(cmd.token).digest('hex')]);
      out.push(`/${d.trigger}`);
    }
    return out.join(' ');
  }

  // ── A person ─────────────────────────────────────────────────────────────
  async member(app: TeamApp, accountId: string, c: CompanyFacts | null, m: MemberFacts | null, email: string | null): Promise<TeamOutcome> {
    const present = teamPresent(c, m, app);
    return app === 'mattermost'
      ? this.mattermost(accountId, present ? { c: c!, m: m! } : null, email)
      : this.planeMember(accountId, present ? { c: c!, m: m! } : null, email);
  }

  private async mattermost(accountId: string, want: { c: CompanyFacts; m: MemberFacts } | null, email: string | null): Promise<TeamOutcome> {
    const known = await this.ids.identity(accountId, 'mattermost');
    let user = known?.external_id ? await this.mm.userById(known.external_id) : null;
    if (!user && (want?.m.email ?? email)) user = await this.mm.userByEmail((want?.m.email ?? email)!);

    if (!want) {
      if (!user) return { status: 'absent', externalId: null, detail: 'no access to this app' };
      const managed = known?.managed ?? false;
      if (!managed) {
        await this.ids.setIdentity(accountId, 'mattermost', { externalId: user.id, username: user.username, state: 'absent', managed: false });
        return { status: 'absent', externalId: user.id, detail: 'an account with this email exists there that Kara did not make; left as it is' };
      }
      if (!user.delete_at) {
        await this.mm.setActive(user.id, false);
        await this.mm.revokeSessions(user.id).catch(() => undefined);
      }
      await this.ids.setIdentity(accountId, 'mattermost', { externalId: user.id, username: user.username, state: 'deactivated' });
      return { status: 'absent', externalId: user.id, detail: 'access taken away: account deactivated' };
    }

    const { c, m } = want;
    const names = splitName(m.fullName);
    let created = '';
    let managed = known?.managed ?? true;
    if (!user) {
      let username = usernameFor(m.email);
      if (await this.mm.userByUsername(username)) username = `${username.slice(0, 17)}-${randomBytes(2).toString('hex')}`;
      const sso = config.team.mattermostAuth === 'gitlab';
      user = await this.mm.createUser({
        email: m.email, username, first_name: names.firstName, last_name: names.lastName,
        ...(sso ? { auth_service: 'gitlab', auth_data: String(gitlabIdOf(accountId)) } : { password: `${randomBytes(18).toString('base64url')}Aa1!` }),
      });
      managed = true;
      if (!sso) {
        await this.mm.sendPasswordReset(m.email).then(() => { created = ', created, password link sent'; },
          (e) => { created = `, created, password link not sent (${(e as Error).message})`; });
      } else created = ', created (signs in with Kara)';
    } else {
      if (!known) managed = false; // there before Kara: access only, never name or state
      if (user.delete_at) await this.mm.setActive(user.id, true);
      if (managed && (user.first_name !== names.firstName || user.last_name !== names.lastName)) {
        await this.mm.patchUser(user.id, { first_name: names.firstName, last_name: names.lastName });
      }
      if (managed && config.team.mattermostAuth === 'gitlab' && user.auth_service !== 'gitlab') {
        await this.mm.setAuth(user.id, 'gitlab', String(gitlabIdOf(accountId)));
      }
    }
    const team = await this.mm.ensureTeam(teamNameFor(c.slug), c.name);
    await this.mm.addToTeam(team.id, user.id);
    for (const ch of config.team.defaultChannels) {
      const channel = await this.mm.channelByName(team.id, ch);
      if (channel) await this.mm.addToChannel(channel.id, user.id).catch(() => undefined);
    }
    await this.ids.setIdentity(accountId, 'mattermost', { externalId: user.id, username: user.username, state: 'active', managed });
    return { status: 'ok', externalId: user.id, detail: `@${user.username} in team ${team.name}${created}${managed ? '' : ' (account was there before Kara)'}` };
  }

  private async planeMember(accountId: string, want: { c: CompanyFacts; m: MemberFacts } | null, email: string | null): Promise<TeamOutcome> {
    const address = (want?.m.email ?? email ?? '').toLowerCase();
    if (!address) return { status: 'absent', externalId: null, detail: 'no email' };
    const member = (await this.plane.members()).find((u) => (u.email ?? '').toLowerCase() === address);
    const invitation = (await this.plane.invitations()).find((i) => i.email.toLowerCase() === address && !i.accepted);

    if (!want) {
      if (invitation) await this.plane.deleteInvitation(invitation.id);
      if (member) {
        await this.ids.setIdentity(accountId, 'plane', { externalId: member.id, username: member.display_name ?? null, state: 'deactivated' });
        return { status: 'absent', externalId: member.id,
          detail: 'access taken away: Kara refuses the sign-in; remove them from the workspace in Plane (Workspace settings → Members), its API cannot' };
      }
      await this.ids.setIdentity(accountId, 'plane', { externalId: null, username: null, state: 'absent' });
      return { status: 'absent', externalId: null, detail: invitation ? 'invitation withdrawn' : 'no access to this app' };
    }

    const role = planeRoleFor(want.m.apps.plane ?? []) ?? PLANE_ROLE.member;
    if (member) {
      await this.ids.setIdentity(accountId, 'plane', { externalId: member.id, username: member.display_name ?? null, state: 'active' });
      const note = member.role !== role ? `; role in Plane is ${member.role}, Kara says ${role} — change it in Plane (its API cannot)` : '';
      return { status: 'ok', externalId: member.id, detail: `workspace member${note}` };
    }
    if (invitation) {
      if (invitation.role !== role) await this.plane.updateInvitation(invitation.id, role);
    } else {
      await this.plane.invite(want.m.email, role);
    }
    await this.ids.setIdentity(accountId, 'plane', { externalId: null, username: null, state: 'invited' });
    return { status: 'ok', externalId: null, detail: `invited to workspace ${this.plane.workspace} (role ${role}); joins on first sign-in` };
  }
}
