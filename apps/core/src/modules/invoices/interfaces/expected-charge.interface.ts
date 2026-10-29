import { SalesChannel } from "../../companies/enums/sales-channel.enum";
import { BilledPartyType } from "../enums/billed-party-type.enum";

/**
 * A payment Keus expects from a contract in force and no invoice records yet: the next periods of a direct
 * subscription, the periods billed to the reseller of an indirect contract, the seats beyond the financed ones at each
 * anniversary, the yearly fee of a reseller. Its amounts follow the invoice it will become. It comes from a contract
 * of a product (`contractId`) or from the contract of the fee of a reseller (`resellerContractId`), never both.
 */
export interface ExpectedCharge {
  /** Contract of a product the payment comes from. */
  contractId?: string;
  /** Contract of the fee of a reseller the payment comes from. */
  resellerContractId?: string;
  /** Code of the contract. */
  contractCode: string;
  /** Product of the contract, absent on the fee of a reseller. */
  productId?: string;
  /** Company of the contract, absent on the fee of a reseller. */
  companyId?: string;
  /** Name of the company, absent on the fee of a reseller. */
  companyName?: string;
  /** Channel of the sale. */
  channel: SalesChannel;
  /** Who will pay it: the company, or the reseller on the indirect channel. */
  billedPartyType: BilledPartyType;
  /** Identifier of who will pay it. */
  billedPartyId: string;
  /** Name of who will pay it. */
  billedPartyName: string;
  /** First day of the period it pays (ISO string). */
  periodStart: string;
  /** Length of the period, in months. */
  periodMonths: number;
  /** Day it falls due (ISO string): the start of the period, or the 4th of the next month for a reseller. */
  dueDate: string;
  /** What it pays. */
  description: string;
  /** Taxable amount in cents, net of VAT. */
  taxableCents: number;
  /** VAT in cents. */
  vatCents: number;
  /** Total in cents, VAT included. */
  amountCents: number;
  /** What the customer pays the reseller for the period, net of VAT, on the indirect channel. */
  customerCents?: number;
  /** Identifier the invoice of a proration will carry, to recognise it once recorded. */
  prorationId?: string;
}
