import { NextRequest, NextResponse } from "next/server";
import { requireTenant } from "@/lib/session";
import { withTenant } from "@/lib/db";

// GET: Get recent health metrics (with optional filters)
export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const ctx = await requireTenant(params.slug);
    const { searchParams } = new URL(request.url);
    
    const member_id = searchParams.get("member_id");
    const limit = parseInt(searchParams.get("limit") || "50");
    const alerts_only = searchParams.get("alerts_only") === "true";
    
    const healthMetrics = await withTenant(ctx.company.schema_name, async (tx) => {
      let query = tx`
        SELECT 
          hm.id,
          hm.smartwatch_id,
          hm.member_id,
          m.full_name as member_name,
          hm.recorded_at,
          hm.heart_rate,
          hm.spo2,
          hm.body_temp,
          hm.steps,
          hm.calories,
          hm.activity_level,
          hm.stress_level,
          hm.is_alert,
          hm.alert_reason,
          hm.location_lat,
          hm.location_lng
        FROM hrc_health_metrics hm
        LEFT JOIN members m ON hm.member_id = m.id
        WHERE 1=1
      `;
      
      if (member_id) {
        query = tx`${query} AND hm.member_id = ${member_id}`;
      }
      
      if (alerts_only) {
        query = tx`${query} AND hm.is_alert = true`;
      }
      
      query = tx`${query} ORDER BY hm.recorded_at DESC LIMIT ${limit}`;
      
      const result = await query;
      return result;
    });

    return NextResponse.json(healthMetrics);
  } catch (error) {
    console.error("Error fetching HRC health metrics:", error);
    return NextResponse.json(
      { error: "Failed to fetch health metrics" },
      { status: 500 }
    );
  }
}

// POST: Submit new health metric data (from smartwatch or gateway)
export async function POST(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const ctx = await requireTenant(params.slug);
    const body = await request.json();
    
    const { 
      smartwatch_id, 
      member_id, 
      heart_rate, 
      spo2, 
      body_temp,
      steps,
      calories,
      activity_level,
      stress_level,
      location_lat,
      location_lng 
    } = body;
    
    if (!smartwatch_id || !member_id) {
      return NextResponse.json(
        { error: "smartwatch_id و member_id الزامی هستند" },
        { status: 400 }
      );
    }

    // Determine if this is an alert condition
    let is_alert = false;
    let alert_reasons: string[] = [];
    
    if (heart_rate && (heart_rate < 50 || heart_rate > 120)) {
      is_alert = true;
      alert_reasons.push(`ضربان قلب غیرعادی: ${heart_rate}`);
    }
    
    if (spo2 && spo2 < 90) {
      is_alert = true;
      alert_reasons.push(`سطح اکسیژن پایین: ${spo2}%`);
    }
    
    if (body_temp && body_temp > 38) {
      is_alert = true;
      alert_reasons.push(`دمای بدن بالا: ${body_temp}°C`);
    }
    
    if (stress_level && stress_level > 80) {
      is_alert = true;
      alert_reasons.push(`سطح استرس بالا: ${stress_level}`);
    }
    
    const alert_reason = alert_reasons.length > 0 ? alert_reasons.join("، ") : null;

    const metric = await withTenant(ctx.company.schema_name, async (tx) => {
      const result = await tx`
        INSERT INTO hrc_health_metrics (
          smartwatch_id, 
          member_id, 
          heart_rate, 
          spo2, 
          body_temp,
          steps,
          calories,
          activity_level,
          stress_level,
          is_alert,
          alert_reason,
          location_lat,
          location_lng
        )
        VALUES (
          ${smartwatch_id},
          ${member_id},
          ${heart_rate || null},
          ${spo2 || null},
          ${body_temp || null},
          ${steps || 0},
          ${calories || 0},
          ${activity_level || 'normal'},
          ${stress_level || null},
          ${is_alert},
          ${alert_reason},
          ${location_lat || null},
          ${location_lng || null}
        )
        RETURNING *
      `;
      return result[0];
    });

    // Update last_sync on the smartwatch
    await withTenant(ctx.company.schema_name, async (tx) => {
      await tx`
        UPDATE hrc_smartwatches 
        SET last_sync = now() 
        WHERE id = ${smartwatch_id}
      `;
    });

    return NextResponse.json(metric, { status: 201 });
  } catch (error) {
    console.error("Error creating HRC health metric:", error);
    return NextResponse.json(
      { error: "Failed to create health metric" },
      { status: 500 }
    );
  }
}
