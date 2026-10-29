/** Purpose written in the metadata of the checkout that starts charging a contract, read back by the webhook. */
export const CONTRACT_CHECKOUT_PURPOSE = 'CONTRACT_CHECKOUT';

/** Purpose written in the metadata of a checkout that only collects the SEPA mandate of a reseller on one account. */
export const RESELLER_MANDATE_CHECKOUT_PURPOSE = 'RESELLER_MANDATE';

/** Purpose written in the metadata of the invoice that charges a reseller on the 4th of a month. */
export const RESELLER_CHARGE_PURPOSE = 'RESELLER_CHARGE';
