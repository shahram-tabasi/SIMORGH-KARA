// One-off tasks inside the kara-api pod:
//
//   kubectl -n kara exec deploy/kara-api -- /nodejs/bin/node dist/cli.js import-identities [--invite]
//
// import-identities  every Kara account into Keycloak (realm kara): user,
//                    organization of its tenant, enabled or not. --invite also
//                    emails each user without a password a link to set one.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { IdentityService } from './identity/identity.service';

async function main() {
  process.env.KARA_API_CLI = '1';
  const [cmd, ...flags] = process.argv.slice(2);
  if (cmd !== 'import-identities') {
    console.error('usage: cli.js import-identities [--invite]');
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

void main();
