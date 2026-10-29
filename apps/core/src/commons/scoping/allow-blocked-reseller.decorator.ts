import { SetMetadata } from "@nestjs/common";

/** Metadata key marking the handlers a blocked reseller can still call. */
export const ALLOW_BLOCKED_RESELLER = "allowBlockedReseller";

/**
 * Lets the users of a blocked reseller call a handler: the ones that read the block and lift it, i.e. the access
 * state, the checkouts of the fee and of the mandates, and the reseller looked up by code. Every other handler
 * refuses them (`ResellerAccessInterceptor`).
 * Usage: @AllowBlockedReseller() on the handler.
 * @returns the decorator.
 */
export const AllowBlockedReseller = (): MethodDecorator => SetMetadata(ALLOW_BLOCKED_RESELLER, true);
