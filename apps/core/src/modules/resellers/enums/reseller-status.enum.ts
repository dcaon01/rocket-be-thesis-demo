/**
 * Enum representing the possible statuses of a reseller.
 * An INACTIVE reseller no longer operates in the platform and its companies can
 * be transferred away; ARCHIVED removes it from the operational lists while
 * keeping its history. The status never changes because of an unpaid invoice:
 * the overdue flag is a separate, purely informative mark.
 */
export enum ResellerStatus {
  Active = 'ACTIVE',
  /**
   * @deprecated Use INACTIVE. Kept so existing records stay readable, since the
   * schema validates the enum on reads too.
   */
  Suspended = 'SUSPENDED',
  Inactive = 'INACTIVE',
  Archived = 'ARCHIVED',
}
