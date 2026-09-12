import { NextRequest, NextResponse } from "next/server";
import { requireTenant } from "@/lib/session";
import { sql as platformSql } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const ctx = await requireTenant(params.slug);
    
    // Get company locations from platform schema
    const locations = await platformSql`
      SELECT 
        cl.id,
        cl.name,
        cl.address,
        cl.lat,
        cl.lng,
        cl.radius_meters,
        cl.location_type,
        cl.is_active
      FROM platform.company_locations cl
      WHERE cl.company_id = ${ctx.company.id}
        AND cl.is_active = true
      ORDER BY cl.created_at DESC
    `;

    return NextResponse.json(locations);
  } catch (error) {
    console.error("Error fetching HRC locations:", error);
    return NextResponse.json(
      { error: "Failed to fetch locations" },
      { status: 500 }
    );
  }
}
