import { AccountType } from './account-type.enum';

/**
 * Back-office profile of a Rocket user, modeled as a Cognito group.
 * Profiles answer "what can this user do", while AccountType answers "whose
 * data can this user see": the two are orthogonal and always combine.
 *
 * The prefix encodes the side of the relationship and MUST stay coherent with
 * the account type: `keus_*` profiles only on COLLABORATOR accounts, and
 * `reseller_*` profiles only on RESELLER accounts. RolesGuard enforces the
 * coherence, because Cognito cannot guarantee it natively.
 *
 * Values are lowercase with underscores because they are Cognito group names,
 * like AccountType.
 */
export enum UserRole {
  /** Keus administrator: the only profile that configures the platform. */
  KeusAdmin = 'keus_admin',
  /** Keus sales: order requests, offers, companies, own resellers. */
  KeusSales = 'keus_sales',
  /** Keus back office: order confirmation, delivery, users, product data. */
  KeusBackoffice = 'keus_backoffice',
  /** Keus accounting: invoices, payment schedule, dunning, suspensions. */
  KeusAccounting = 'keus_accounting',
  /** Reseller owner: the whole perimeter of its own reseller. */
  ResellerOwner = 'reseller_owner',
  /** Reseller back office: every order and company of its own reseller. */
  ResellerBackoffice = 'reseller_backoffice',
  /** Reseller sales: only the orders and companies it owns. */
  ResellerSales = 'reseller_sales',
}

/** Profiles allowed on a COLLABORATOR account. */
export const KEUS_ROLES: readonly UserRole[] = [
  UserRole.KeusAdmin,
  UserRole.KeusSales,
  UserRole.KeusBackoffice,
  UserRole.KeusAccounting,
];

/** Profiles allowed on a RESELLER account. */
export const RESELLER_ROLES: readonly UserRole[] = [
  UserRole.ResellerOwner,
  UserRole.ResellerBackoffice,
  UserRole.ResellerSales,
];

/**
 * Tells which account type a profile belongs to.
 * @param role the profile to classify.
 * @returns the account type the profile belongs to, or undefined when the value is not a known profile.
 */
export function accountTypeOfRole(role: string): AccountType | undefined {
  if ((KEUS_ROLES as string[]).includes(role)) {
    return AccountType.COLLABORATOR;
  }
  if ((RESELLER_ROLES as string[]).includes(role)) {
    return AccountType.RESELLER;
  }
  return undefined;
}
