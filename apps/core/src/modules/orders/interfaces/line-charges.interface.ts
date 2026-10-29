/** What a contract charges for its order line: the discounts of the line and the customization quoted on its product. */
export interface LineCharges {
  /** Whether the company pays the line itself: direct channel and no finance company. */
  chargedToCompany: boolean;
  /** Discount on the activation, in percent. */
  activationDiscountPercent: number;
  /** Discount on the recurring fee, in percent. */
  recurringDiscountPercent: number;
  /** Activation billed by Keus, in cents, discount included. */
  activationCents?: number;
  /** Recurring fee billed by Keus per billing period of the plan, in cents, discount included. */
  recurringCents?: number;
  /** Assistance, at full price. */
  assistance?: {
    /** Amount, in cents. */
    amountCents: number;
    /** Label shown on the documents. */
    label?: string;
  };
  /** Financing of the order, when a finance company pays it. */
  financing?: {
    /** Finance company. */
    financier: string;
    /** Identifier of the financing application. */
    reference?: string;
    /** Years of fee the finance company pays upfront. */
    years?: number;
    /** Seats the finance company pays: those sold on the line; the company pays the ones beyond. */
    seats?: number;
    /** Fee per billing period of the seats priced beyond the financed ones, in cents, when seats are priced. */
    extraSeatsCents?: number;
  };
  /**
   * What the customer pays the reseller, on the indirect channel: the list price less the discount the reseller gave,
   * where Keus bills the list price less the margin.
   */
  customer?: {
    /** Activation, in cents, discount included. */
    activationCents?: number;
    /** Recurring fee per billing period of the plan, in cents, discount included. */
    recurringCents?: number;
    /** One-off amount of the customization, in cents. */
    customizationOneOffCents?: number;
    /** Increase of the recurring fee for the customization per billing period, in cents. */
    customizationRecurringIncreaseCents?: number;
  };
  /** Customization quoted on the product of the line, with its amounts already discounted. */
  customization?: {
    /** One-off amount, in cents. */
    oneOffCents?: number;
    /** Increase of the recurring fee per billing period, in cents. */
    recurringIncreaseCents?: number;
  };
}
