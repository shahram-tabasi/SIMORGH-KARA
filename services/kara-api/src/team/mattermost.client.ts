import { Injectable } from '@nestjs/common';
import { config } from '../config';
import { HttpError, requestJson } from './http';

// Mattermost's REST API v4. Two tokens: the system-admin bot kara-provisioner
// (accounts, teams, channels) and the bot simorgh-assistant (what people read:
// direct messages and the assistant's answers).

export interface MmUser {
  id: string;
  username: string;
  email: string;
  first_name?: string;
  last_name?: string;
  auth_service?: string;
  delete_at: number;
  is_bot?: boolean;
}
export interface MmTeam { id: string; name: string; display_name: string; delete_at: number }
export interface MmChannel { id: string; name: string; team_id: string; type: string }
export interface MmCommand {
  id: string;
  team_id: string;
  trigger: string;
  method: 'P' | 'G';
  url: string;
  token: string;
  display_name: string;
  description: string;
  auto_complete: boolean;
  auto_complete_desc: string;
  auto_complete_hint: string;
  username?: string;
}
export interface MmPost { id: string; channel_id: string; message: string }

export interface MmAction {
  id: string;
  name: string;
  style?: 'default' | 'primary' | 'success' | 'danger';
  integration: { url: string; context: Record<string, unknown> };
}
export interface MmAttachment {
  fallback?: string;
  color?: string;
  title?: string;
  title_link?: string;
  text?: string;
  fields?: { title: string; value: string; short?: boolean }[];
  actions?: MmAction[];
}

/** A valid Mattermost username from an email: lower case, a-z 0-9 . _ -, 3-22 characters, a letter first. */
export function usernameFor(email: string): string {
  let u = email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^[^a-z]+/, '');
  if (u.length < 3) u = `user-${u}`.slice(0, 22);
  return u.slice(0, 22).replace(/[._-]+$/, '') || 'user';
}

/** A valid team name from a company slug: lower case, a-z 0-9 -, 2-64 characters. */
export function teamNameFor(slug: string): string {
  const t = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
  return (t.length >= 2 ? t : `team-${t}`).slice(0, 64);
}

@Injectable()
export class MattermostClient {
  get configured() { return !!config.team.mattermost.adminToken; }
  get botConfigured() { return !!config.team.mattermost.botToken; }

  private req<T>(token: 'admin' | 'bot', method: string, path: string, body?: unknown) {
    const t = token === 'admin' ? config.team.mattermost.adminToken : config.team.mattermost.botToken;
    return requestJson<T>({
      baseUrl: `${config.team.mattermost.url}/api/v4`, name: 'mattermost', timeoutMs: config.team.mattermost.timeoutMs,
      headers: () => ({ Authorization: `Bearer ${t}` }),
    }, method, path, body);
  }

  private async orNull<T>(p: Promise<T>): Promise<T | null> {
    try { return await p; } catch (e) { if (e instanceof HttpError && e.status === 404) return null; throw e; }
  }

  // ── Users ────────────────────────────────────────────────────────────────
  userByEmail(email: string) { return this.orNull(this.req<MmUser>('admin', 'GET', `/users/email/${encodeURIComponent(email)}`)); }
  userById(id: string) { return this.orNull(this.req<MmUser>('admin', 'GET', `/users/${id}`)); }
  userByUsername(name: string) { return this.orNull(this.req<MmUser>('admin', 'GET', `/users/username/${encodeURIComponent(name)}`)); }

  createUser(u: { email: string; username: string; first_name: string; last_name: string; password?: string; auth_service?: string; auth_data?: string }) {
    return this.req<MmUser>('admin', 'POST', '/users', u);
  }
  patchUser(id: string, patch: Partial<Pick<MmUser, 'first_name' | 'last_name' | 'email'>>) { return this.req<MmUser>('admin', 'PUT', `/users/${id}/patch`, patch); }
  /** Switch the user to sign in through "GitLab" (Kara's Keycloak adapter). */
  setAuth(id: string, authService: string, authData: string) {
    return this.req<unknown>('admin', 'PUT', `/users/${id}/auth`, { auth_service: authService, auth_data: authData });
  }
  setActive(id: string, active: boolean) { return this.req<unknown>('admin', 'PUT', `/users/${id}/active`, { active }); }
  revokeSessions(id: string) { return this.req<unknown>('admin', 'POST', `/users/${id}/sessions/revoke/all`); }
  sendPasswordReset(email: string) { return this.req<unknown>('admin', 'POST', '/users/password/reset/send', { email }); }

  // ── Teams and channels ───────────────────────────────────────────────────
  teamByName(name: string) { return this.orNull(this.req<MmTeam>('admin', 'GET', `/teams/name/${encodeURIComponent(name)}`)); }
  async ensureTeam(name: string, displayName: string): Promise<MmTeam> {
    const t = await this.teamByName(name);
    if (t) {
      if (t.display_name !== displayName) await this.req('admin', 'PUT', `/teams/${t.id}/patch`, { display_name: displayName });
      return t;
    }
    return this.req<MmTeam>('admin', 'POST', '/teams', { name, display_name: displayName, type: 'I' });
  }
  teamMembers(teamId: string, userId: string) { return this.orNull(this.req<{ delete_at: number }>('admin', 'GET', `/teams/${teamId}/members/${userId}`)); }
  async addToTeam(teamId: string, userId: string) {
    const m = await this.teamMembers(teamId, userId);
    if (m && !m.delete_at) return;
    await this.req('admin', 'POST', `/teams/${teamId}/members`, { team_id: teamId, user_id: userId });
  }
  removeFromTeam(teamId: string, userId: string) { return this.orNull(this.req('admin', 'DELETE', `/teams/${teamId}/members/${userId}`)); }
  channelByName(teamId: string, name: string) { return this.orNull(this.req<MmChannel>('admin', 'GET', `/teams/${teamId}/channels/name/${encodeURIComponent(name)}`)); }
  async ensureChannel(teamId: string, name: string, displayName: string, purpose = ''): Promise<MmChannel> {
    return (await this.channelByName(teamId, name))
      ?? this.req<MmChannel>('admin', 'POST', '/channels', { team_id: teamId, name, display_name: displayName, purpose, type: 'O' });
  }
  addToChannel(channelId: string, userId: string) { return this.req('admin', 'POST', `/channels/${channelId}/members`, { user_id: userId }); }

  // ── Slash commands ───────────────────────────────────────────────────────
  teamCommands(teamId: string) { return this.req<MmCommand[]>('admin', 'GET', `/commands?team_id=${teamId}&custom_only=true`); }
  createCommand(c: Omit<MmCommand, 'id' | 'token'>) { return this.req<MmCommand>('admin', 'POST', '/commands', c); }
  updateCommand(c: MmCommand) { return this.req<MmCommand>('admin', 'PUT', `/commands/${c.id}`, c); }

  // ── Messages (as the bot simorgh-assistant) ──────────────────────────────
  private botId?: string;
  async botUserId(): Promise<string> {
    if (!this.botId) this.botId = (await this.req<MmUser>('bot', 'GET', '/users/me')).id;
    return this.botId;
  }
  async directChannel(userId: string): Promise<MmChannel> {
    return this.req<MmChannel>('bot', 'POST', '/channels/direct', [await this.botUserId(), userId]);
  }
  post(channelId: string, message: string, attachments?: MmAttachment[], rootId?: string) {
    return this.req<MmPost>('bot', 'POST', '/posts', {
      channel_id: channelId, message, root_id: rootId,
      props: attachments?.length ? { attachments } : undefined,
    });
  }
  async dm(userId: string, message: string, attachments?: MmAttachment[]) {
    const ch = await this.directChannel(userId);
    return this.post(ch.id, message, attachments);
  }
  updatePost(postId: string, message: string, attachments?: MmAttachment[]) {
    return this.req<MmPost>('bot', 'PUT', `/posts/${postId}/patch`, { message, props: { attachments: attachments ?? [] } });
  }
}
