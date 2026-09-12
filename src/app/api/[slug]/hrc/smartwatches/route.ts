import { NextRequest, NextResponse } from "next/server";
import { requireTenant } from "@/lib/session";
import { withTenant } from "@/lib/db";

// GET: List all smartwatches for the company
export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const ctx = await requireTenant(params.slug);
    
    const smartwatches = await withTenant(ctx.company.schema_name, async (tx) => {
      const result = await tx`
        SELECT 
          sw.id,
          sw.member_id,
          m.full_name as member_name,
          sw.device_name,
          sw.device_model,
          sw.mac_address,
          sw.is_active,
          sw.last_sync,
          sw.battery_level,
          sw.firmware_version,
          sw.created_at
        FROM hrc_smartwatches sw
        LEFT JOIN members m ON sw.member_id = m.id
        ORDER BY sw.created_at DESC
      `;
      return result;
    });

    return NextResponse.json(smartwatches);
  } catch (error) {
    console.error("Error fetching HRC smartwatches:", error);
    return NextResponse.json(
      { error: "Failed to fetch smartwatches" },
      { status: 500 }
    );
  }
}

// POST: Register a new smartwatch
export async function POST(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const ctx = await requireTenant(params.slug);
    const body = await request.json();
    
    const { member_id, device_name, device_model, mac_address, device_token } = body;
    
    if (!member_id || !device_name) {
      return NextResponse.json(
        { error: "member_id و device_name الزامی هستند" },
        { status: 400 }
      );
    }

    const smartwatch = await withTenant(ctx.company.schema_name, async (tx) => {
      const result = await tx`
        INSERT INTO hrc_smartwatches (member_id, device_name, device_model, mac_address, device_token)
        VALUES (${member_id}, ${device_name}, ${device_model || null}, ${mac_address || null}, ${device_token || null})
        RETURNING *
      `;
      return result[0];
    });

    return NextResponse.json(smartwatch, { status: 201 });
  } catch (error) {
    console.error("Error creating HRC smartwatch:", error);
    return NextResponse.json(
      { error: "Failed to create smartwatch" },
      { status: 500 }
    );
  }
}
