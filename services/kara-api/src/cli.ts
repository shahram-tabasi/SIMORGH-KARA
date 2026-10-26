// One-off tasks inside the kara-api pod:
//
//   kubectl -n kara exec deploy/kara-api -- /nodejs/bin/node dist/cli.js import-identities [--invite]
//
// import-identities  every Kara account into Keycloak (realm kara): user,
//                    organization of its tenant, enabled or not. --invite also
//                    emails each user without a password a link to set one.
//
//   … cli.js import-app-users [--app designSuite] --domains electrokavir.com=ekc,simorghai.com=simorgh [--dry-run]
//
// import-app-users   the people already in an app's realm (Design Suite: realm
//                    simorgh) into Kara: account, member of their company (a
//                    realm role named after the company, else the email
//                    domain), their app roles. Verified, enabled users only.
//                    Then import-identities gives them their Kara sign-in.
//
//   … cli.js seed-org ekc [--dry-run] [--prune] [--place email=Unit/Sub-unit …]
//
// seed-org           a company's prepared organisation (EKC: its chart, where
//                    its people sit, the platform owners, its HR rules and
//                    products) laid onto what it has (provisioning/seed-org.ts);
//                    its provisioning jobs take it to Odoo and the realms.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { IdentityService } from './identity/identity.service';
import { DbService } from './infra/db.service';
import { importAppUsers } from './provisioning/import-app-users';
import { seedOrg } from './provisioning/seed-org';
import { ProvisionerService } from './provisioning/provisioner.service';
import type { AppKey } from './provisioning/plan';

async function main() {
  process.env.KARA_API_CLI = '1';
  const [cmd, ...flags] = process.argv.slice(2);
  if (cmd === 'import-app-users') return importApp(flags);
  if (cmd === 'seed-org') return seed(flags);
  if (cmd !== 'import-identities') {
    console.error('usage: cli.js import-identities [--invite] | import-app-users [--app designSuite] --domains a.com=slug,… [--dry-run] | seed-org <company slug> [--dry-run] [--prune] [--place email=Unit/Sub-unit]');
    process.exit(2);
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const { results, failed } = await app.get(IdentityService).syncAll({ invite: flags.includes('--invite') });
    for (const r of results) console.log(`${r.outcome.padEnd(8)} ${r.email}${r.organization ? ` → ${r.organization}` : ''}${r.invited ? ' (invited)' : ''}${r.note ? ` — ${r.note}` : ''}`);
    for (const f of failed) console.log(`FAILED   ${f.email} — ${f.error}`);
    console.log(`\n${results.filter(r => r.outcome === 'created').length} created, ${results.filter(r => r.outcome === 'updated').length} updated, ${results.filter(r => r.outcome === 'skipped').length} skipped, ${results.filter(r => r.invited).length} invited, ${failed.length} failed`);
    process.exitCode = failed.length ? 1 : 0;
  } finally {
    await app.close();
  }
}

function flag(flags: string[], name: string): string | undefined {
  const i = flags.indexOf(name);
  return i >= 0 ? flags[i + 1] : undefined;
}

async function importApp(flags: string[]) {
  const domains = Object.fromEntries((flag(flags, '--domains') ?? '').split(',').map((p) => p.split('=').map((x) => x.trim().toLowerCase())).filter(([d, c]) => d && c));
  const appKey = (flag(flags, '--app') ?? 'designSuite') as AppKey;
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const lines = await importAppUsers(app.get(DbService), app.get(ProvisionerService), { app: appKey, domains, dryRun: flags.includes('--dry-run') });
    for (const l of lines) console.log(l);
  } finally {
    await app.close();
  }
}


async function seed(flags: string[]) {
  const slug = flags.find((f, i) => !f.startsWith('--') && flags[i - 1] !== '--place');
  if (!slug) { console.error('usage: cli.js seed-org <company slug> [--dry-run] [--prune] [--place email=Unit/Sub-unit …]'); process.exit(2); }
  const place: Record<string, string[]> = {};
  flags.forEach((f, i) => {
    if (f !== '--place' || !flags[i + 1]?.includes('=')) return;
    const [email, path] = flags[i + 1].split('=');
    place[email.trim().toLowerCase()] = path.split('/').map((x) => x.trim()).filter(Boolean);
  });
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const lines = await seedOrg(app.get(DbService), slug, { dryRun: flags.includes('--dry-run'), prune: flags.includes('--prune'), place });
    for (const l of lines) console.log(l);
  } finally {
    await app.close();
  }
}

void main();
