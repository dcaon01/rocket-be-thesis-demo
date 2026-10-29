import { PickType } from "@nestjs/swagger";
import { CreateTenantDto } from "../../tenants/dtos/create-tenant.dto";

/**
 * The tenant of an order line, as the back office fills it in to provision the line.
 * The fields, their validation and their documentation are those of `CreateTenantDto`;
 * product, order and seats come from the line. The data follow the tenant structure of
 * the product, without the fields the product generates.
 */
export class ProvisionTenantInput extends PickType(CreateTenantDto, ["name", "description", "data"] as const) {}
