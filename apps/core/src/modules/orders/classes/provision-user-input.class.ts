import { PickType } from "@nestjs/swagger";
import { CreateUserDto } from "../../users/dtos/create-user.dto";

/**
 * A user of an order line, as the back office fills it in to provision the line.
 * The fields, their validation and their documentation are those of `CreateUserDto`;
 * product, tenant and names come from the line. The first user of the line is the
 * referent of the tenant, who accepts the contract at first access.
 */
export class ProvisionUserInput extends PickType(CreateUserDto, ["email", "roles", "name", "surname", "data"] as const) {}
