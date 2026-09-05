/**
 * پاک‌سازی دوره‌ای دادهٔ HRC بر اساس سیاست نگهداشتِ هر شرکت.
 *
 * A safety platform that keeps location history forever is a surveillance
 * archive. Each company sets its own horizon in `hrc_policies`; this job is
 * what makes that promise real rather than decorative.
 *
 * Run it from cron, e.g. nightly at 03:00:
 *   0 3 * * *  cd /path/to/app && npm run hrc:retention >> /var/log/hrc-retention.log 2>&1
 */
import { runRetention, hrcSchemas } from "../src/lib/hrc/audit";
import { sql } from "../src/lib/db";

async function main() {
  const schemas = await hrcSchemas();
  console.log(`→ ${schemas.length} شرکت با پنل HRC`);
  let total = { locations: 0, heartbeats: 0, health: 0, events: 0 };

  for (const schema of schemas) {
    try {
      const n = await runRetention(schema);
      total = {
        locations: total.locations + n.locations,
        heartbeats: total.heartbeats + n.heartbeats,
        health: total.health + n.health,
        events: total.events + n.events,
      };
      console.log(
        `  ${schema}: موقعیت ${n.locations} · ضربان ${n.heartbeats} · ` +
          `سلامت ${n.health} · رویداد ${n.events}`
      );
    } catch (e) {
      // One company's problem must not stop the sweep for every other company.
      console.error(`  ${schema}: خطا —`, e instanceof Error ? e.message : e);
    }
  }
  console.log(
    `✔ پاک‌سازی تمام شد — مجموع: موقعیت ${total.locations} · ضربان ${total.heartbeats} · ` +
      `سلامت ${total.health} · رویداد ${total.events}`
  );
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
