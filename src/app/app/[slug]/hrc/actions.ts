"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { withTenant } from "@/lib/db";
import {
  requireTenant,
  ensurePermission,
  ensureModule,
  type TenantContext,
} from "@/lib/session";
import { evaluateReading, DEFAULT_THRESHOLDS, type Thresholds } from "@/lib/hrc";
import type { PermissionKey } from "@/lib/rbac";

export interface HrcState {
  error?: string;
  ok?: boolean;
  token?: string;
}

async function hrcCtx(
  slug: string,
  permission: PermissionKey
): Promise<TenantContext> {
  const ctx = await requireTenant(slug);
  ensureModule(ctx, "hrc");
  ensurePermission(ctx, permission);
  return ctx;
}

function rev(slug: string, sub = "") {
  revalidatePath(`/app/${slug}/hrc${sub}`);
}

/* ------------------------- ساعت‌های هوشمند (دستگاه) ------------------------ */

export async function createDeviceAction(
  _prev: HrcState,
  formData: FormData
): Promise<HrcState> {
  const slug = String(formData.get("slug"));
  const ctx = await hrcCtx(slug, "hrc.devices.manage");
  const serial = String(formData.get("serial") || "").trim();
  if (serial.length < 3) return { error: "شمارهٔ سریال دستگاه را وارد کنید." };

  const token = `hrc_${randomBytes(20).toString("base64url")}`;
  try {
    await withTenant(ctx.company.schema, async (tx) => {
      await tx`
        INSERT INTO hrc_devices (serial, token, model, kind, member_id, note)
        VALUES (
          ${serial}, ${token},
          ${String(formData.get("model") || "") || null},
          ${String(formData.get("kind") || "watch")},
          ${String(formData.get("memberId") || "") || null},
          ${String(formData.get("note") || "") || null}
        )
      `;
    });
  } catch {
    return { error: "دستگاهی با این سریال از قبل ثبت شده است." };
  }
  rev(slug, "/devices");
  return { ok: true, token };
}

export async function assignDeviceAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await hrcCtx(slug, "hrc.devices.manage");
  const id = String(formData.get("deviceId"));
  const memberId = String(formData.get("memberId") || "") || null;
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`UPDATE hrc_devices SET member_id = ${memberId} WHERE id = ${id}`;
  });
  rev(slug, "/devices");
}

export async function toggleDeviceAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await hrcCtx(slug, "hrc.devices.manage");
  const id = String(formData.get("deviceId"));
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`UPDATE hrc_devices SET is_active = NOT is_active WHERE id = ${id}`;
  });
  rev(slug, "/devices");
}

export async function deleteDeviceAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await hrcCtx(slug, "hrc.devices.manage");
  const id = String(formData.get("deviceId"));
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`DELETE FROM hrc_devices WHERE id = ${id}`;
  });
  rev(slug, "/devices");
}

/* --------------------------- نقشه و ناحیه‌بندی ---------------------------- */

export async function saveMapAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await hrcCtx(slug, "hrc.map.manage");
  const num = (k: string) => {
    const v = String(formData.get(k) || "").trim();
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`
      INSERT INTO hrc_map (id, title, image_url, north, south, east, west, updated_at)
      VALUES (1, ${String(formData.get("title") || "نقشهٔ شرکت")},
              ${String(formData.get("imageUrl") || "") || null},
              ${num("north")}, ${num("south")}, ${num("east")}, ${num("west")}, now())
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title, image_url = EXCLUDED.image_url,
        north = EXCLUDED.north, south = EXCLUDED.south,
        east = EXCLUDED.east, west = EXCLUDED.west, updated_at = now()
    `;
  });
  rev(slug, "/settings");
  rev(slug, "/map");
}

export async function createZoneAction(
  _prev: HrcState,
  formData: FormData
): Promise<HrcState> {
  const slug = String(formData.get("slug"));
  const ctx = await hrcCtx(slug, "hrc.map.manage");
  const name = String(formData.get("name") || "").trim();
  if (name.length < 2) return { error: "نام ناحیه را وارد کنید." };

  // Polygon is typed as JSON: [[lat,lng], …] (geo) or [[x,y], …] (plan, %).
  const raw = String(formData.get("polygon") || "[]").trim();
  let polygon: unknown;
  try {
    polygon = JSON.parse(raw || "[]");
  } catch {
    return { error: "چندضلعی ناحیه باید JSON معتبر باشد؛ مثال: [[35.7,51.4],[35.7,51.5],[35.6,51.5]]" };
  }
  if (!Array.isArray(polygon)) return { error: "چندضلعی باید آرایه‌ای از نقاط باشد." };
  if (polygon.length > 0 && polygon.length < 3) {
    return { error: "یک ناحیه حداقل به سه نقطه نیاز دارد." };
  }

  await withTenant(ctx.company.schema, async (tx) => {
    await tx`
      INSERT INTO hrc_zones
        (name, kind, color, coord_mode, polygon, alert_on_enter, alert_on_exit, note)
      VALUES (
        ${name}, ${String(formData.get("kind") || "area")},
        ${String(formData.get("color") || "#38bdf8")},
        ${String(formData.get("coordMode") || "geo")},
        ${tx.json(polygon as never)},
        ${formData.get("alertOnEnter") === "on"},
        ${formData.get("alertOnExit") === "on"},
        ${String(formData.get("note") || "") || null}
      )
    `;
  });
  rev(slug, "/zones");
  rev(slug, "/map");
  return { ok: true };
}

export async function deleteZoneAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await hrcCtx(slug, "hrc.map.manage");
  const id = String(formData.get("zoneId"));
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`DELETE FROM hrc_zones WHERE id = ${id}`;
  });
  rev(slug, "/zones");
  rev(slug, "/map");
}

/* ------------------------------ آستانه‌ها ------------------------------- */

export async function saveThresholdsAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await hrcCtx(slug, "hrc.thresholds.manage");
  const n = (k: string, d: number) => {
    const v = Number(formData.get(k));
    return Number.isFinite(v) ? v : d;
  };
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`
      INSERT INTO hrc_thresholds
        (id, hr_min, hr_max, spo2_min, temp_min, temp_max, no_motion_minutes,
         offline_minutes, battery_low, fall_alert, geofence_alert, auto_dispatch,
         auto_dispatch_team, updated_at)
      VALUES (
        1, ${n("hrMin", 45)}, ${n("hrMax", 140)}, ${n("spo2Min", 92)},
        ${n("tempMin", 35)}, ${n("tempMax", 38.5)}, ${n("noMotion", 20)},
        ${n("offline", 15)}, ${n("batteryLow", 15)},
        ${formData.get("fallAlert") === "on"},
        ${formData.get("geofenceAlert") === "on"},
        ${formData.get("autoDispatch") === "on"},
        ${String(formData.get("autoDispatchTeam") || "") || null},
        now()
      )
      ON CONFLICT (id) DO UPDATE SET
        hr_min = EXCLUDED.hr_min, hr_max = EXCLUDED.hr_max,
        spo2_min = EXCLUDED.spo2_min, temp_min = EXCLUDED.temp_min,
        temp_max = EXCLUDED.temp_max,
        no_motion_minutes = EXCLUDED.no_motion_minutes,
        offline_minutes = EXCLUDED.offline_minutes,
        battery_low = EXCLUDED.battery_low,
        fall_alert = EXCLUDED.fall_alert,
        geofence_alert = EXCLUDED.geofence_alert,
        auto_dispatch = EXCLUDED.auto_dispatch,
        auto_dispatch_team = EXCLUDED.auto_dispatch_team,
        updated_at = now()
    `;
  });
  rev(slug, "/settings");
}

/* -------------------------------- هشدارها -------------------------------- */

export async function setAlertStatusAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await hrcCtx(slug, "hrc.alerts.manage");
  const id = String(formData.get("alertId"));
  const status = String(formData.get("status"));
  const note = String(formData.get("note") || "") || null;
  if (!["ack", "resolved", "false_alarm", "open"].includes(status)) return;

  await withTenant(ctx.company.schema, async (tx) => {
    if (status === "ack") {
      await tx`
        UPDATE hrc_alerts
        SET status = 'ack', acked_by = ${ctx.member.memberId}, acked_at = now()
        WHERE id = ${id}
      `;
    } else if (status === "open") {
      await tx`UPDATE hrc_alerts SET status = 'open' WHERE id = ${id}`;
    } else {
      await tx`
        UPDATE hrc_alerts
        SET status = ${status}, resolved_by = ${ctx.member.memberId},
            resolved_at = now(), resolution_note = ${note}
        WHERE id = ${id}
      `;
    }
  });
  rev(slug, "/alerts");
  rev(slug);
}

/** ثبت دستی هشدار — مثلاً وقتی گزارش حادثه تلفنی می‌رسد. */
export async function createManualAlertAction(
  _prev: HrcState,
  formData: FormData
): Promise<HrcState> {
  const slug = String(formData.get("slug"));
  const ctx = await hrcCtx(slug, "hrc.alerts.manage");
  const memberId = String(formData.get("memberId") || "") || null;
  const message = String(formData.get("message") || "").trim();
  if (!message) return { error: "شرح حادثه را بنویسید." };

  await withTenant(ctx.company.schema, async (tx) => {
    await tx`
      INSERT INTO hrc_alerts (member_id, kind, severity, message)
      VALUES (${memberId}, 'manual',
              ${String(formData.get("severity") || "warn")}, ${message})
    `;
  });
  rev(slug, "/alerts");
  return { ok: true };
}

/* --------------------------- تیم‌های HRC و اعزام -------------------------- */

export async function createTeamAction(
  _prev: HrcState,
  formData: FormData
): Promise<HrcState> {
  const slug = String(formData.get("slug"));
  const ctx = await hrcCtx(slug, "hrc.teams.manage");
  const name = String(formData.get("name") || "").trim();
  if (name.length < 2) return { error: "نام تیم را وارد کنید." };

  const num = (k: string) => {
    const v = String(formData.get(k) || "").trim();
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  await withTenant(ctx.company.schema, async (tx) => {
    await tx`
      INSERT INTO hrc_teams (name, kind, phone, radio_channel, base_location, lat, lng)
      VALUES (
        ${name}, ${String(formData.get("kind") || "medical")},
        ${String(formData.get("phone") || "") || null},
        ${String(formData.get("radio") || "") || null},
        ${String(formData.get("base") || "") || null},
        ${num("lat")}, ${num("lng")}
      )
    `;
  });
  rev(slug, "/teams");
  return { ok: true };
}

export async function toggleTeamMemberAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await hrcCtx(slug, "hrc.teams.manage");
  const teamId = String(formData.get("teamId"));
  const memberId = String(formData.get("memberId"));
  const checked = formData.get("checked") === "1";

  await withTenant(ctx.company.schema, async (tx) => {
    if (checked) {
      await tx`
        INSERT INTO hrc_team_members (team_id, member_id)
        VALUES (${teamId}, ${memberId}) ON CONFLICT DO NOTHING
      `;
    } else {
      await tx`
        DELETE FROM hrc_team_members
        WHERE team_id = ${teamId} AND member_id = ${memberId}
      `;
    }
  });
  rev(slug, "/teams");
}

export async function toggleTeamActiveAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await hrcCtx(slug, "hrc.teams.manage");
  const id = String(formData.get("teamId"));
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`UPDATE hrc_teams SET is_active = NOT is_active WHERE id = ${id}`;
  });
  rev(slug, "/teams");
}

/**
 * اعزام تیم HRC — the alert (if any) moves to "dispatched" and the person's last
 * known position is copied onto the dispatch so the team has a destination even
 * if the watch goes offline afterwards.
 */
export async function dispatchTeamAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await hrcCtx(slug, "hrc.dispatch");
  const teamId = String(formData.get("teamId") || "");
  const alertId = String(formData.get("alertId") || "") || null;
  const targetMemberId = String(formData.get("memberId") || "") || null;
  if (!teamId) return;

  await withTenant(ctx.company.schema, async (tx) => {
    let lat: number | null = null;
    let lng: number | null = null;
    let zoneId: string | null = null;

    if (alertId) {
      const [a] = await tx<
        { lat: number | null; lng: number | null; zone_id: string | null; member_id: string | null }[]
      >`SELECT lat, lng, zone_id, member_id FROM hrc_alerts WHERE id = ${alertId}`;
      lat = a?.lat ?? null;
      lng = a?.lng ?? null;
      zoneId = a?.zone_id ?? null;
    }
    const member = targetMemberId ?? null;
    if ((lat === null || lng === null) && member) {
      const [r] = await tx<{ lat: number | null; lng: number | null; zone_id: string | null }[]>`
        SELECT lat, lng, zone_id FROM hrc_readings
        WHERE member_id = ${member} AND lat IS NOT NULL
        ORDER BY recorded_at DESC LIMIT 1
      `;
      lat = r?.lat ?? lat;
      lng = r?.lng ?? lng;
      zoneId = r?.zone_id ?? zoneId;
    }

    await tx`
      INSERT INTO hrc_dispatches
        (alert_id, team_id, target_member_id, priority, lat, lng, zone_id, note,
         dispatched_by)
      VALUES (
        ${alertId}, ${teamId}, ${member},
        ${String(formData.get("priority") || "high")},
        ${lat}, ${lng}, ${zoneId},
        ${String(formData.get("note") || "") || null},
        ${ctx.member.memberId}
      )
    `;
    if (alertId) {
      await tx`
        UPDATE hrc_alerts SET status = 'dispatched'
        WHERE id = ${alertId} AND status IN ('open','ack')
      `;
    }
  });
  rev(slug, "/dispatch");
  rev(slug, "/alerts");
}

export async function setDispatchStatusAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await hrcCtx(slug, "hrc.dispatch");
  const id = String(formData.get("dispatchId"));
  const status = String(formData.get("status"));
  const outcome = String(formData.get("outcome") || "") || null;
  if (!["enroute", "onsite", "done", "cancelled"].includes(status)) return;

  await withTenant(ctx.company.schema, async (tx) => {
    await tx`
      UPDATE hrc_dispatches SET
        status = ${status},
        enroute_at = CASE WHEN ${status} = 'enroute' THEN now() ELSE enroute_at END,
        onsite_at  = CASE WHEN ${status} = 'onsite'  THEN now() ELSE onsite_at END,
        closed_at  = CASE WHEN ${status} IN ('done','cancelled') THEN now() ELSE closed_at END,
        outcome    = COALESCE(${outcome}, outcome)
      WHERE id = ${id}
    `;
    if (status === "done") {
      const [d] = await tx<{ alert_id: string | null }[]>`
        SELECT alert_id FROM hrc_dispatches WHERE id = ${id}
      `;
      if (d?.alert_id) {
        await tx`
          UPDATE hrc_alerts
          SET status = 'resolved', resolved_by = ${ctx.member.memberId},
              resolved_at = now(),
              resolution_note = COALESCE(resolution_note, 'با اعزام تیم HRC رفع شد')
          WHERE id = ${d.alert_id} AND status <> 'resolved'
        `;
      }
    }
  });
  rev(slug, "/dispatch");
  rev(slug, "/alerts");
}

/* --------------------------- ثبت دستی یک قرائت --------------------------- */

/**
 * Record a reading by hand (drill, a watch without connectivity, or a nurse's
 * measurement). Runs through the very same threshold engine as the ingest API.
 */
export async function recordReadingAction(
  _prev: HrcState,
  formData: FormData
): Promise<HrcState> {
  const slug = String(formData.get("slug"));
  const ctx = await hrcCtx(slug, "hrc.monitor");
  const memberId = String(formData.get("memberId") || "");
  if (!memberId) return { error: "کارمند را انتخاب کنید." };

  const num = (k: string) => {
    const v = String(formData.get(k) || "").trim();
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  await withTenant(ctx.company.schema, async (tx) => {
    const [t] = await tx<Thresholds[]>`SELECT * FROM hrc_thresholds WHERE id = 1`;
    const thresholds = t ?? DEFAULT_THRESHOLDS;
    const reading = {
      heart_rate: num("heartRate"),
      spo2: num("spo2"),
      body_temp: num("bodyTemp"),
      battery: null,
      motion: String(formData.get("motion") || "") || null,
    };
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO hrc_readings
        (member_id, recorded_at, heart_rate, spo2, body_temp, motion, lat, lng, source)
      VALUES (${memberId}, now(), ${reading.heart_rate}, ${reading.spo2},
              ${reading.body_temp}, ${reading.motion}, ${num("lat")}, ${num("lng")},
              'manual')
      RETURNING id
    `;
    for (const a of evaluateReading(reading, thresholds)) {
      await tx`
        INSERT INTO hrc_alerts
          (member_id, reading_id, kind, severity, message, lat, lng)
        VALUES (${memberId}, ${row.id}, ${a.kind}, ${a.severity}, ${a.message},
                ${num("lat")}, ${num("lng")})
      `;
    }
  });
  rev(slug);
  rev(slug, "/alerts");
  return { ok: true };
}
