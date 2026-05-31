// src/common/pii/pii-access-log.service.ts

/**
 * Writes audit rows whenever PII is accessed. Designed to be injected
 * anywhere (PiiModule is @Global), so services that read / mutate PII
 * can call this without ceremony.
 *
 * Failure to log MUST NOT break the request. Compliance is important but
 * blocking a user/admin operation because the audit table is unhealthy is
 * the wrong trade-off — we log the failure and continue. If logging is
 * broken in production, the error path will fire loudly in the application
 * logs and an SRE can act on it; users see no impact.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * Distinct values the audit table cares about. Kept as a string union (not a
 * Prisma enum) so adding a new resource type doesn't require a DB migration.
 * The schema stores the underlying string.
 */
export type PiiResourceType =
  | 'PROFILE'
  | 'BANK_ACCOUNT'
  | 'USER'
  | 'STAFF'
  | 'KYC_DOCUMENT'
  | 'EXPORT';

export type PiiAction =
  | 'READ'
  | 'LIST'
  | 'UPDATE'
  | 'CREATE'
  | 'EXPORT'
  | 'ANONYMIZE';

export interface PiiAccessLogInput {
  /** User id of the actor performing the access. Null = system / scheduled job. */
  actorUserId: string | null;
  /** User id whose PII is being accessed. Required. */
  targetUserId: string;
  /** What kind of PII was touched. */
  resourceType: PiiResourceType;
  /** Specific resource id (e.g. bank account id), if applicable. */
  resourceId?: string;
  /** What was done. */
  action: PiiAction;
  /** Optional human-readable justification ("KYC review", "support ticket #X"). */
  reason?: string;
  /** Arbitrary additional context. Keep small — this is an audit row, not a blob. */
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class PiiAccessLogService {
  private readonly logger = new Logger(PiiAccessLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Write a single PII access row. Awaits the DB write but never throws —
   * caller is safe to `await piiAccessLog.log(...)` without try/catch.
   */
  async log(input: PiiAccessLogInput): Promise<void> {
    try {
      await this.prisma.piiAccessLog.create({
        data: {
          actorUserId: input.actorUserId,
          targetUserId: input.targetUserId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          action: input.action,
          reason: input.reason,
          metadata: (input.metadata as never) ?? undefined,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        },
      });
    } catch (err) {
      // Don't break the user request because the audit table failed.
      this.logger.error(
        `Failed to write PII access log (actor=${input.actorUserId ?? 'system'} ` +
          `target=${input.targetUserId} ${input.resourceType}.${input.action}): ` +
          `${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
