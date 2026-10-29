export enum EntityTypeEnum {
  User = "USER",
  Tenant = "TENANT",
  Trial = "TRIAL",
  TrialBundle = "TRIAL_BUNDLE",
  Tier = "TIER",
  Contract = "CONTRACT",
  ResellerContract = "RESELLER_CONTRACT",
  Message = "MESSAGE",
  /** Rocket-internal: the charge of the resellers on the 4th of a month, never sent to a product. */
  ResellerCharge = "RESELLER_CHARGE",
  /** Rocket-internal: a step of the dunning of an unpaid invoice, never sent to a product. */
  InvoiceDunning = "INVOICE_DUNNING",
  /** Rocket-internal: a scheduled retry of a pending operation, never sent to a product. */
  PendingOperation = "PENDING_OPERATION",
  /** Rocket-internal: the periodic sweep that sends again the pending operations left behind, never sent to a product. */
  PendingOperationSweep = "PENDING_OPERATION_SWEEP",
  /** Rocket-internal: the daily reminder of the due dates of the customers of the resellers, never sent to a product. */
  CustomerDuesDigest = "CUSTOMER_DUES_DIGEST",
  /** Rocket-internal: the daily check of the confirmed orders past their delivery date, never sent to a product. */
  OrderOverdueCheck = "ORDER_OVERDUE_CHECK",
  /** Rocket-internal: the daily refresh of the metrics of the current month, never sent to a product. */
  MetricsRefresh = "METRICS_REFRESH",
  /** Rocket-internal: the check of the health address of the products every 15 minutes, never sent to a product. */
  HealthCheck = "HEALTH_CHECK",
}