import { NextRequest, NextResponse } from "next/server";
import { requireTenant } from "@/lib/session";
import { withTenant } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const ctx = await requireTenant(params.slug);
    
    // Get recent incidents from tenant schema
    const incidents = await withTenant(ctx.company.schema_name, async (tx) => {
      const result = await tx`
        SELECT 
          id,
          title,
          incident_type,
          severity,
          occurred_at,
          lat,
          lng,
          status
        FROM hrc_incidents
        WHERE lat IS NOT NULL AND lng IS NOT NULL
        ORDER BY occurred_at DESC
        LIMIT 50
      `;
      return result;
    });

    return NextResponse.json(incidents);
  } catch (error) {
    console.error("Error fetching HRC incidents:", error);
    return NextResponse.json(
      { error: "Failed to fetch incidents" },
      { status: 500 }
    );
  }
}
