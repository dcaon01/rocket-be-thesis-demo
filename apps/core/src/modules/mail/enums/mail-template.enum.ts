/**
 * Emails the core sends through SES.
 * Each value is the name of an SES template defined in rocket-infra
 * (`be/templates/email/`), published as `<MAIL_TEMPLATE_PREFIX>-<value>`.
 * Resellers, Keus staff and the companies receive them: Rocket writes to the companies about their orders and
 * contracts (`company-*`), while the products write about their own logic and the trials.
 */
export enum MailTemplate {
  /** To the reseller whose order the back office confirmed. */
  OrderConfirmed = 'order-confirmed',
  /** To the Keus back office and admins: the signed offer has been uploaded, and the order waits for the confirmation. */
  OrderAccepted = 'order-accepted',
  /** To the reseller: its order, with the signed offer, has passed to Keus for the confirmation. */
  OrderSubmitted = 'order-submitted',
  /** To the Keus back office and admins: a confirmed order is past its delivery date with lines still to provision. */
  OrderOverdue = 'order-overdue',
  /** To the reseller whose order line has been provisioned: the product sent the credentials to its customer. */
  LineProvisioned = 'line-provisioned',
  /** To the Keus back office and admins: an order asks for its customizations to be priced. */
  QuoteRequested = 'quote-requested',
  /** To the seller and the authors of the customizations: the back office saved the quotation of the order. */
  QuotationSaved = 'quotation-saved',
  /** To the Keus back office and admins: a reseller asks to approve its offer. */
  ApprovalRequested = 'approval-requested',
  /** To the reseller: Keus approved its offer. */
  ApprovalGranted = 'approval-granted',
  /** To the reseller: Keus refused to approve its offer, with the reason. */
  ApprovalRefused = 'approval-refused',
  /** To the Keus administration: a charge failed, at every attempt. */
  PaymentFailed = 'payment-failed',
  /** To the Keus administration: a customer disputed a SEPA debit with its bank, or the dispute closed. */
  PaymentDisputed = 'payment-disputed',
  /** To the Keus administration: a charge was refunded on Stripe, and the credit note goes on Sibill. */
  PaymentRefunded = 'payment-refunded',
  /** To the Keus administration: a SEPA mandate is no longer active, so the next debits will fail. */
  MandateRevoked = 'mandate-revoked',
  /** To the reseller: an invoice Keus issued to it is still unpaid (fifth and tenth day). */
  PaymentReminder = 'payment-reminder',
  /** To the Keus administration: a reminder of an unpaid invoice has gone out. */
  PaymentReminderAdmin = 'payment-reminder-admin',
  /** To the Keus administration: the company has been told the date its accesses will be suspended. */
  SuspensionNoticeAdmin = 'suspension-notice-admin',
  /** To the Keus administration: the accesses of a contract have been suspended. */
  AccessSuspended = 'access-suspended',
  /** To the Keus administration: the accesses of a contract have been restored. */
  AccessRestored = 'access-restored',
  /** To the reseller: the seats of a contract it sold grew, with the prorated amount and the new renewal amount. */
  SeatVariation = 'seat-variation',
  /** To the reseller: a contract it sold is about to renew, with date and amount. */
  RenewalNotice = 'renewal-notice',
  /** To the reseller: the due dates of its customers of the day and the ones five and ten days late, still open. */
  CustomerDues = 'customer-dues',
  /** To the reseller: the pro forma of an invoice of Keus charged on the 4th, attached as a PDF. */
  ResellerProForma = 'reseller-pro-forma',
  /** To the reseller: the date Rocket will be blocked for an unpaid invoice (fourteenth day). */
  ResellerSuspensionNotice = 'reseller-suspension-notice',
  /** To the reseller: Rocket is blocked for an unpaid invoice. */
  ResellerAccessSuspended = 'reseller-access-suspended',
  /** To the reseller: Rocket works again. */
  ResellerAccessRestored = 'reseller-access-restored',
  /** To the Keus administration: the reseller has been told the date Rocket will be blocked. */
  ResellerSuspensionNoticeAdmin = 'reseller-suspension-notice-admin',
  /** To the Keus administration: Rocket has been blocked for a reseller. */
  ResellerAccessSuspendedAdmin = 'reseller-access-suspended-admin',
  /** To the Keus administration: Rocket works again for a reseller. */
  ResellerAccessRestoredAdmin = 'reseller-access-restored-admin',
  /** To the company: the payment of its contract is not set up yet (fifth, tenth and fourteenth day). */
  CompanyPaymentSetupReminder = 'company-payment-setup-reminder',
  /** To the company: an invoice is still unpaid (fifth and tenth day). */
  CompanyPaymentReminder = 'company-payment-reminder',
  /** To the company: the date its accesses will be suspended for an unpaid invoice (fourteenth day). */
  CompanySuspensionNotice = 'company-suspension-notice',
  /** To the company: its accesses have been suspended. */
  CompanyAccessSuspended = 'company-access-suspended',
  /** To the company: its accesses have been restored. */
  CompanyAccessRestored = 'company-access-restored',
  /** To the company: its seats grew, with the prorated amount and the new renewal amount. */
  CompanySeatVariation = 'company-seat-variation',
  /** To the company: its contract is about to renew, with date and amount. */
  CompanyRenewalNotice = 'company-renewal-notice',
  /** To the company and whoever accepted: the accepted contract, attached. */
  CompanyContractAccepted = 'company-contract-accepted',
}
