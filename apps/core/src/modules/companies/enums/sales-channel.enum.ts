/**
 * Sales channel a company or an order belongs to.
 * DIRECT when Keus sells, RESELLER when a reseller does. It decides who the
 * invoice is addressed to and who receives the communications: on the indirect
 * channel Keus never bills the end company, the reseller does, outside Rocket.
 */
export enum SalesChannel {
  Direct = 'DIRECT',
  Reseller = 'RESELLER',
}
