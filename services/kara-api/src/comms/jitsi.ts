import { SignJWT } from 'jose';
import { config } from '../config';

export const jitsiEnabled = () => !!config.jitsi.url && !!config.jitsi.secret;

/** Jitsi room names: lowercase letters, digits and dashes, at most 120. */
export function roomName(...parts: string[]): string {
  return parts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
}

export interface JitsiUser {
  id: string;
  name: string;
  email: string;
}

export interface JoinInfo {
  /** https://meet.simorghai.com */
  url: string;
  /** meet.simorghai.com: the IFrame API's domain. */
  domain: string;
  room: string;
  jwt: string;
}

/**
 * A token for one person and one room, as Jitsi's prosody (AUTH_TYPE=jwt)
 * checks it: iss = app id, aud, sub = the XMPP domain, room, and the user's
 * name and email in context.user. Short-lived: the meeting itself goes on
 * after it expires; only joining needs it.
 */
export async function joinInfo(room: string, user: JitsiUser, moderator: boolean): Promise<JoinInfo> {
  const j = config.jitsi;
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({
    room,
    context: { user: { id: user.id, name: user.name, email: user.email, moderator } },
    moderator,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(j.appId)
    .setAudience(j.audience)
    .setSubject(j.subject)
    .setNotBefore(now - 30)
    .setIssuedAt(now)
    .setExpirationTime(now + j.tokenTtlSeconds)
    .sign(new TextEncoder().encode(j.secret));
  return { url: j.url, domain: new URL(j.url).host, room, jwt };
}
