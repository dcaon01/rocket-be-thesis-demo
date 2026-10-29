/** Kind of sales material, fixed at creation: every kind is a file except the external link. */
export enum MaterialType {
  /** Product catalogue. */
  Catalog = 'CATALOG',
  /** Price list. */
  PriceList = 'PRICE_LIST',
  /** Commercial presentation. */
  Presentation = 'PRESENTATION',
  /** Connector of a product, a ZIP the resellers download to install it. */
  Connector = 'CONNECTOR',
  /** Link to an external page, with no file. */
  ExternalLink = 'EXTERNAL_LINK',
}
