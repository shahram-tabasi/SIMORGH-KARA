import { LoggerService } from '@nestjs/common';

/** One JSON object per line, for Filebeat → Elasticsearch. */
export class JsonLogger implements LoggerService {
  private write(level: string, message: unknown, context?: string, extra?: Record<string, unknown>) {
    const line = { '@timestamp': new Date().toISOString(), level, service: 'kara-api', context, message: typeof message === 'string' ? message : JSON.stringify(message), ...extra };
    (level === 'error' ? process.stderr : process.stdout).write(`${JSON.stringify(line)}\n`);
  }
  log(message: unknown, context?: string) { this.write('info', message, context); }
  error(message: unknown, trace?: string, context?: string) { this.write('error', message, context, trace ? { trace } : undefined); }
  warn(message: unknown, context?: string) { this.write('warn', message, context); }
  debug(message: unknown, context?: string) { this.write('debug', message, context); }
  verbose(message: unknown, context?: string) { this.write('debug', message, context); }
  /** An HTTP request, with the id that follows it through the platform. */
  request(fields: Record<string, unknown>) { this.write('info', 'request', 'http', fields); }
}

export const logger = new JsonLogger();
