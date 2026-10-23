import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { withTxRetry } from '../db/retry';

export type TxClient = Prisma.TransactionClient;

const TX_MAX_WAIT_MS = parseInt(process.env.DB_TX_MAX_WAIT_MS ?? '15000', 10);
const TX_TIMEOUT_MS = parseInt(process.env.DB_TX_TIMEOUT_MS ?? '15000', 10);

@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'warn' | 'error'>
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { level: 'warn', emit: 'event' },
        { level: 'error', emit: 'event' },
      ],
    });
  }

  async onModuleInit() {
    // Query parameters are deliberately never logged (they can contain PII).
    this.$on('warn', (e) => this.logger.warn(e.message));
    this.$on('error', (e) => this.logger.error(e.message));
    await this.$connect();
    this.logger.log('Prisma connected to PostgreSQL');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Prisma disconnected from PostgreSQL');
  }

  /**
   * READ COMMITTED transaction intended for row-lock based critical sections
   * (SELECT ... FOR UPDATE on the slot / booking rows).
   *
   * Why not SERIALIZABLE: under SERIALIZABLE, a transaction that waited on a row
   * lock fails with 40001 as soon as the lock holder commits a change to that
   * row, so concurrent customers get errors even while seats remain. Under READ
   * COMMITTED, the waiter re-reads the latest committed row after acquiring the
   * lock, which is exactly the semantics needed for inventory. Overbooking is
   * prevented by the lock plus the database CHECK constraints.
   *
   * Transient conflicts (deadlock / serialization) are retried — the aborted
   * attempt made no changes.
   */
  async withLockingTransaction<T>(callback: (tx: TxClient) => Promise<T>): Promise<T> {
    return withTxRetry(() =>
      this.$transaction(callback, {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: TX_MAX_WAIT_MS,
        timeout: TX_TIMEOUT_MS,
      }),
    );
  }

  /**
   * Execute a callback inside a serializable transaction (retried on conflict).
   * Use only where predicate-level isolation is genuinely needed.
   */
  async withSerializableTransaction<T>(callback: (tx: TxClient) => Promise<T>): Promise<T> {
    return withTxRetry(() =>
      this.$transaction(callback, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: TX_MAX_WAIT_MS,
        timeout: TX_TIMEOUT_MS,
      }),
    );
  }

  /** Read-committed transaction for ordinary multi-statement writes. */
  async withTransaction<T>(callback: (tx: TxClient) => Promise<T>): Promise<T> {
    return withTxRetry(() =>
      this.$transaction(callback, {
        maxWait: TX_MAX_WAIT_MS,
        timeout: TX_TIMEOUT_MS,
      }),
    );
  }
}
