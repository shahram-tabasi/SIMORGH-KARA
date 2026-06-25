/**
 * Minimal iCalendar (.ics) builder. A downloaded .ics imports into Windows
 * Calendar / Outlook / Google / Apple Calendar, which then fire native
 * reminders (sound + popup) even when the browser is closed — the reliable way
 * to remind a user off-screen from a web app.
 */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Date → UTC stamp "YYYYMMDDTHHMMSSZ". */
function toICSDate(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** Escape per RFC 5545 (commas, semicolons, backslashes, newlines). */
function esc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

export interface ICSEvent {
  uid: string;
  title: string;
  description?: string;
  start: Date;
  /** event length in minutes (default 30) */
  durationMin?: number;
  /** minutes before start to alarm (default 0 = at the time) */
  alarmMinBefore?: number;
  stamp?: Date; // DTSTAMP; pass an explicit "now" (Date.now is unavailable in some contexts)
}

export function buildICS(ev: ICSEvent): string {
  const start = ev.start;
  const end = new Date(start.getTime() + (ev.durationMin ?? 30) * 60000);
  const alarm = ev.alarmMinBefore ?? 0;
  const stamp = ev.stamp ?? start;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Simorgh Ledger//Kartabl Reminder//FA",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${ev.uid}`,
    `DTSTAMP:${toICSDate(stamp)}`,
    `DTSTART:${toICSDate(start)}`,
    `DTEND:${toICSDate(end)}`,
    `SUMMARY:${esc(ev.title)}`,
    ev.description ? `DESCRIPTION:${esc(ev.description)}` : "",
    "BEGIN:VALARM",
    `TRIGGER:-PT${alarm}M`,
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(ev.title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  // RFC 5545 wants CRLF line endings.
  return lines.join("\r\n") + "\r\n";
}
