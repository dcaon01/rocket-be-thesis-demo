/** How often a recurring item of a reseller falls due. */
export enum ChargeCadence {
  Monthly = 'MONTHLY',
  Quarterly = 'QUARTERLY',
  Annual = 'ANNUAL',
}

/** Months between two due dates of each cadence. */
export const CADENCE_MONTHS: Record<ChargeCadence, number> = {
  [ChargeCadence.Monthly]: 1,
  [ChargeCadence.Quarterly]: 3,
  [ChargeCadence.Annual]: 12,
};
