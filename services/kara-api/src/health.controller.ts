import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { DbService } from './infra/db.service';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Get()
  live() {
    return { status: 'ok' };
  }

  /** Ready when Kara's database answers; Odoo and Keycloak being down only fail the calls that need them. */
  @Get('ready')
  async ready() {
    try {
      await this.db.query('SELECT 1');
    } catch {
      throw new HttpException({ status: 'database unavailable' }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { status: 'ok' };
  }
}
