/**
 * What keeps a draft from going ahead on its products.
 * ORDER = another order of the company, out of the draft and not final, has one of its products;
 * CONTRACT = the company has a contract in force, terminating ones included, on one of its products.
 */
export enum OrderBlockerKind {
  Order = 'ORDER',
  Contract = 'CONTRACT',
}
