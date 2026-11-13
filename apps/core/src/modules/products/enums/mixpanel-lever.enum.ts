/**
 * Levers (leve) on which Rocket evaluates the adoption of a product by each tenant (UR-RK-223): every product has
 * as many rules per lever as needed.
 */
export enum MixpanelLever {
  /** The tenant understood how the product works: judged on the first days after the credentials. */
  Activation = 'ATTIVAZIONE',
  /** The product entered the daily work of the tenant: judged from the third week on. */
  Operational = 'OPERATIVI',
  /** The tenant sees the advantage the product brings: judged from the third week on. */
  Value = 'VALORE',
  /** The tenant stopped using the product: judged on every tenant. */
  Risk = 'RISCHIO',
}
