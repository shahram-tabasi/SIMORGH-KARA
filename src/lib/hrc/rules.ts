/**
 * موتور ریسک — منطق تصمیم روی سرور، نه در اپ اندروید.
 *
 * A rule is data, not code: `conditions` describe what must be true, `actions`
 * describe the event to raise. The Android client only reports facts; whether
 * a fact is an emergency is decided here, from the company's own rules and
 * thresholds. That means a safety manager can change policy without shipping
 * a new app, and two companies can disagree about what "too hot" means.
 *
 * Deliberately conservative: this raises `ABNORMAL_SENSOR_READING`, never a
 * diagnosis. The system is not a medical device and must not read like one.
 */

export type FactValue = number | string | boolean | null | undefined;
export type Facts = Record<string, FactValue>;

export interface RuleCondition {
  fact: string;
  op: ">" | ">=" | "<" | "<=" | "=" | "!=" | "in";
  value: number | string | boolean | (number | string)[] | { threshold: string };
}

export interface RuleRow {
  id: string;
  code: string;
  name: string;
  enabled: boolean;
  priority: number;
  severity: string;
  conditions: { all?: RuleCondition[] } | null;
  actions: {
    event?: string;
    message?: string;
    metric?: string;
    confirmSeconds?: number;
  } | null;
}

export interface RuleMatch {
  ruleId: string;
  code: string;
  eventType: string;
  severity: string;
  message: string;
  metric?: string;
  confirmSeconds?: number;
  /** the facts that made it fire — stored on the event so a reviewer sees why */
  matched: Record<string, FactValue>;
}

/** Resolve `{threshold:"hr_max"}` against the company's own threshold row. */
function resolve(
  value: RuleCondition["value"],
  thresholds: Record<string, unknown>
): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && "threshold" in value) {
    return thresholds[(value as { threshold: string }).threshold];
  }
  return value;
}

function compare(op: RuleCondition["op"], left: FactValue, right: unknown): boolean {
  if (left === null || left === undefined) return false;
  if (op === "in") {
    return Array.isArray(right) && right.some((v) => String(v) === String(left));
  }
  if (op === "=") return String(left) === String(right);
  if (op === "!=") return String(left) !== String(right);

  const l = Number(left);
  const r = Number(right);
  if (!Number.isFinite(l) || !Number.isFinite(r)) return false;
  switch (op) {
    case ">":
      return l > r;
    case ">=":
      return l >= r;
    case "<":
      return l < r;
    case "<=":
      return l <= r;
  }
}

/**
 * Evaluate every enabled rule against a set of facts, highest priority first
 * (lower number = more urgent). A rule with no conditions never fires — an
 * empty `all` must not mean "always true".
 */
export function evaluateRules(
  rules: RuleRow[],
  facts: Facts,
  thresholds: Record<string, unknown>
): RuleMatch[] {
  const out: RuleMatch[] = [];
  const ordered = [...rules]
    .filter((r) => r.enabled)
    .sort((a, b) => a.priority - b.priority);

  for (const rule of ordered) {
    const all = rule.conditions?.all;
    if (!Array.isArray(all) || all.length === 0) continue;

    const matched: Record<string, FactValue> = {};
    let fired = true;
    for (const c of all) {
      const left = facts[c.fact];
      // A fact the device did not report is not a violation. A missing sensor
      // must never look like a healthy reading — but it must not raise an
      // emergency either; `SENSOR_UNAVAILABLE` covers that separately.
      if (left === null || left === undefined) {
        fired = false;
        break;
      }
      if (!compare(c.op, left, resolve(c.value, thresholds))) {
        fired = false;
        break;
      }
      matched[c.fact] = left;
    }
    if (!fired) continue;

    const eventType = rule.actions?.event;
    if (!eventType) continue;
    out.push({
      ruleId: rule.id,
      code: rule.code,
      eventType,
      severity: rule.severity,
      message: rule.actions?.message ?? rule.name,
      metric: rule.actions?.metric,
      confirmSeconds: rule.actions?.confirmSeconds,
      matched,
    });
  }
  return out;
}

/**
 * Which lane the command centre shows this in: an employee emergency, or a
 * technical problem with the hardware. Keeping them apart is the difference
 * between a dashboard people trust and one they learn to ignore.
 */
export function sourceCategory(eventType: string): "EMPLOYEE" | "DEVICE" {
  return [
    "DEVICE_OFFLINE",
    "LOW_BATTERY",
    "LOCATION_DISABLED",
    "WATCH_DISCONNECTED",
    "APP_PERMISSION_ERROR",
    "NO_NETWORK",
  ].includes(eventType)
    ? "DEVICE"
    : "EMPLOYEE";
}

/** Default severity when a device reports an event without claiming one. */
export function defaultSeverity(eventType: string): string {
  switch (eventType) {
    case "SOS":
    case "FALL_DETECTED":
      return "CRITICAL";
    case "HIGH_RISK_ZONE_ENTERED":
    case "ABNORMAL_SENSOR_READING":
      return "HIGH";
    case "INACTIVITY_WARNING":
    case "GEOFENCE_ENTER":
    case "GEOFENCE_EXIT":
    case "DEVICE_OFFLINE":
    case "LOCATION_DISABLED":
    case "WATCH_DISCONNECTED":
      return "MEDIUM";
    case "LOW_BATTERY":
    case "NO_NETWORK":
    case "APP_PERMISSION_ERROR":
      return "INFO";
    default:
      return "MEDIUM";
  }
}

/**
 * A device may *lower* its own severity but never raise it above what the
 * server thinks the event type deserves — otherwise a buggy client could
 * flood the command centre with CRITICALs.
 */
const RANK = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
export function clampSeverity(eventType: string, claimed?: string): string {
  const ceiling = defaultSeverity(eventType);
  if (!claimed) return ceiling;
  const ci = RANK.indexOf(claimed);
  const ti = RANK.indexOf(ceiling);
  if (ci < 0) return ceiling;
  return ci <= ti ? claimed : ceiling;
}

/** An incident file is opened for anything this serious or worse. */
export function opensIncident(severity: string): boolean {
  return RANK.indexOf(severity) >= RANK.indexOf("HIGH");
}
