import { Prisma } from '@prisma/client';

/**
 * A closure applies to a departure at instant `at` when it is not revoked, has
 * started, has not ended (ends_at NULL = until reopened), and covers either the
 * departure's stretch or the whole river (stretch_id NULL).
 */
export function activeClosureWhere(stretchId: string, at: Date): Prisma.ClosureWhereInput {
  return {
    AND: [
      { revoked_at: null },
      { starts_at: { lte: at } },
      { OR: [{ ends_at: null }, { ends_at: { gt: at } }] },
      { OR: [{ stretch_id: stretchId }, { stretch_id: null }] },
    ],
  };
}

/** Closures (for any stretch) that are in force at `at`. */
export function closuresInForceWhere(at: Date): Prisma.ClosureWhereInput {
  return {
    AND: [{ revoked_at: null }, { starts_at: { lte: at } }, { OR: [{ ends_at: null }, { ends_at: { gt: at } }] }],
  };
}

/** Closures that will affect any part of the window [from, to). */
export function closuresOverlappingWhere(from: Date, to: Date): Prisma.ClosureWhereInput {
  return {
    AND: [{ revoked_at: null }, { starts_at: { lt: to } }, { OR: [{ ends_at: null }, { ends_at: { gt: from } }] }],
  };
}

export function closureCovers(c: { stretch_id: string | null; starts_at: Date; ends_at: Date | null; revoked_at: Date | null }, stretchId: string, at: Date): boolean {
  return (
    c.revoked_at === null &&
    c.starts_at <= at &&
    (c.ends_at === null || c.ends_at > at) &&
    (c.stretch_id === null || c.stretch_id === stretchId)
  );
}
