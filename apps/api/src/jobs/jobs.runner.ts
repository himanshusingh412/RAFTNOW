import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import PgBoss from 'pg-boss';
import { JobsService } from './jobs.service';

/** Strip Prisma-only query parameters so node-postgres gets a clean URL. */
export function pgBossConnectionString(url: string): string {
  try {
    const u = new URL(url);
    for (const p of ['schema', 'connection_limit', 'pool_timeout', 'pgbouncer', 'statement_cache_size']) u.searchParams.delete(p);
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Durable job engine (pg-boss on PostgreSQL — the TRD's chosen design).
 *
 * - Schedules are stored in the database, so they survive restarts and are
 *   shared by every API instance; pg-boss guarantees one job per cron tick.
 * - Queues use the "stately" policy: at most one queued + one active job per
 *   queue, so slow runs never pile up or overlap.
 * - Failed jobs retry with exponential backoff.
 *
 * Disabled with DISABLE_BACKGROUND_JOBS=true (tests).
 */
@Injectable()
export class JobsRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(JobsRunner.name);
  private boss: PgBoss | null = null;
  private started = false;

  constructor(private readonly jobs: JobsService) {}

  status() {
    return { enabled: this.started, engine: 'pg-boss', jobs: this.jobs.definitions().map((d) => ({ name: d.name, cron: d.cron })) };
  }

  async onApplicationBootstrap() {
    if (process.env.DISABLE_BACKGROUND_JOBS === 'true') {
      this.logger.warn('Background jobs disabled (DISABLE_BACKGROUND_JOBS=true)');
      return;
    }
    const url = process.env.DATABASE_URL;
    if (!url) return;

    this.boss = new PgBoss({
      connectionString: pgBossConnectionString(url),
      schema: 'pgboss',
      max: parseInt(process.env.JOBS_DB_POOL_MAX ?? '4', 10),
      application_name: 'raftnow-jobs',
    });
    this.boss.on('error', (err) => this.logger.error(`pg-boss error: ${err.message}`));
    await this.boss.start();

    for (const def of this.jobs.definitions()) {
      await this.boss.createQueue(def.name, {
        name: def.name,
        policy: 'stately',
        retryLimit: 3,
        retryDelay: 30,
        retryBackoff: true,
        expireInSeconds: 15 * 60,
      });
      await this.boss.schedule(def.name, def.cron, {}, { tz: 'UTC' });
      await this.boss.work(def.name, { batchSize: 1, pollingIntervalSeconds: 5 }, async () => {
        await this.jobs.runByName(def.name);
      });
    }
    this.started = true;
    // Materialise departures right away instead of waiting for the hourly tick.
    await this.boss.send('slots.generate', {});
    this.logger.log(`pg-boss started: ${this.jobs.definitions().length} scheduled jobs`);
  }

  /** Enqueue an immediate run (e.g. after an admin action). */
  async trigger(name: string) {
    if (!this.boss) return null;
    return this.boss.send(name, {});
  }

  async onApplicationShutdown() {
    if (this.boss) {
      await this.boss.stop({ graceful: true, timeout: 10_000 }).catch(() => undefined);
    }
  }
}
