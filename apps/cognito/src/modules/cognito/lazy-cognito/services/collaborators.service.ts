import { BadRequestException, Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { InjectModel, Model } from "nestjs-dynamoose";
import { accountTypeOfRole } from "@rocket-be/scoping";
import { Page, paginate } from "../../../../commons/pagination/pagination.helper";
import { AccountType } from "../../enums/account-type.enum";
import { Role } from "../../enums/role.enum";
import { Collaborator, CollaboratorKey } from "../../schemas/collaborator.schema";

/** Filters of a page of the collaborators: the reseller is already the requester's one for a reseller. */
export type CollaboratorsPageFilters = {
  /** Code of the reseller the users belong to. */
  resellerCode?: string;
  /** Account type the users must have. */
  accountType?: AccountType;
  /** Profile the users must have. */
  group?: Role;
  /** Whether the users are enabled. */
  enabled?: boolean;
  /** Start of the first or last name. */
  name?: string;
  /** Start of the email. */
  email?: string;
};

/**
 * Service for the collaborators projection table.
 * The Cognito User Pool is the source of truth; this table is a queryable
 * projection kept aligned by CognitoManagementService with a synchronous
 * dual-write (pool first, then table) and rebuildable via reconcile().
 */
@Injectable()
export class CollaboratorsService {
  /** Logger instance for CollaboratorsService. */
  private readonly _logger = new Logger(CollaboratorsService.name);

  /**
   * Constructor for CollaboratorsService.
   * @param _collaboratorModel the model to manage collaborator records.
   */
  constructor(
    @InjectModel("Collaborator")
    private readonly _collaboratorModel: Model<Collaborator, CollaboratorKey>
  ) { }

  /**
   * Creates or overwrites the collaborator record for a user.
   * @param collaborator the collaborator record to persist.
   */
  async upsertCollaborator(collaborator: Collaborator): Promise<void> {
    // Strip undefined values: Dynamoose rejects explicit undefined/null on optional fields.
    const record = Object.fromEntries(
      Object.entries(collaborator).filter(([, value]) => value !== undefined && value !== null)
    ) as unknown as Collaborator;

    await this._collaboratorModel.create(record, { overwrite: true, return: 'item' });
    this._logger.log(`Collaborator record upserted for sub: ${collaborator.sub}`);
  }

  /**
   * Updates the collaborator record for a user.
   * If the record does not exist (users created before this table was introduced),
   * the update is skipped with a warning: reconcile() will realign the table.
   * @param sub the Cognito sub of the user.
   * @param updates the fields to update.
   * @param clearResellerCode whether to remove the resellerCode from the record.
   */
  async updateCollaborator(
    sub: string,
    updates: Partial<Omit<Collaborator, "sub">>,
    clearResellerCode = false
  ): Promise<void> {
    const existing = await this._collaboratorModel.get({ sub });
    if (!existing) {
      this._logger.warn(`Collaborator record for sub ${sub} not found, skipping table update - run reconcile to realign`);
      return;
    }

    const setUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => value !== undefined && value !== null)
    );

    const updateObject: Record<string, unknown> = {};
    if (Object.keys(setUpdates).length > 0) {
      updateObject.$SET = setUpdates;
    }
    if (clearResellerCode && existing.resellerCode !== undefined) {
      updateObject.$REMOVE = ["resellerCode"];
    }
    if (Object.keys(updateObject).length === 0) {
      return;
    }

    await this._collaboratorModel.update({ sub }, updateObject);
    this._logger.log(`Collaborator record updated for sub: ${sub}`);
  }

  /**
   * Deletes the collaborator record for a user. Idempotent.
   * @param sub the Cognito sub of the user.
   */
  async deleteCollaborator(sub: string): Promise<void> {
    await this._collaboratorModel.delete({ sub });
    this._logger.log(`Collaborator record deleted for sub: ${sub}`);
  }

  /**
   * Retrieves the collaborator record for a user.
   * @param sub the Cognito sub of the user.
   * @returns the collaborator record, or null if not found.
   */
  async getCollaborator(sub: string): Promise<Collaborator | null> {
    const collaborator = await this._collaboratorModel.get({ sub });
    return collaborator ?? null;
  }

  /**
   * Retrieves all the collaborators of a reseller using the GSI, optionally only the ones with a profile. A reseller
   * has few collaborators, so the profile is filtered in memory: Dynamoose cannot put a condition on a list.
   * @param resellerCode the code of the reseller.
   * @param group the profile the collaborators must have, every profile when absent.
   * @returns the list of collaborator records.
   */
  async getCollaboratorsByReseller(resellerCode: string, group?: Role): Promise<Collaborator[]> {
    try {
      this._logger.log(`Retrieving collaborators of reseller: ${resellerCode}${group ? `, profile: ${group}` : ""}`);
      const collaborators = await this._collaboratorModel
        .query("resellerCode")
        .eq(resellerCode)
        .using("resellerCodeIndex")
        .all()
        .exec();

      return group ? collaborators.filter(collaborator => collaborator.groups?.includes(group)) : [...collaborators];
    } catch (error) {
      this._logger.error(`Error retrieving collaborators of reseller: ${resellerCode}`, error);
      throw new InternalServerErrorException(`Failed to retrieve collaborators of reseller ${resellerCode}`);
    }
  }

  /**
   * Lists one page of the collaborators. A reseller reads `resellerCodeIndex`; otherwise the account type, asked or
   * implied by the profile, reads `accountTypeIndex`; with neither the table is scanned. The other filters are the
   * page predicate, case-insensitive prefixes for name and email.
   * @param filters the filters of the page.
   * @param limit the page size.
   * @param cursor the cursor of the page, absent for the first one.
   * @returns the page of collaborators.
   * @throws BadRequestException if the cursor is not valid.
   */
  async listCollaboratorsPage(filters: CollaboratorsPageFilters, limit: number, cursor?: string): Promise<Page<Collaborator>> {
    const { resellerCode, group, enabled, name, email } = filters;
    const accountType = filters.accountType ?? (group ? accountTypeOfRole(group) : undefined);

    try {
      const accept = (collaborator: Collaborator): boolean =>
        (!accountType || collaborator.accountType === accountType)
        && (!group || !!collaborator.groups?.includes(group))
        && (enabled === undefined || collaborator.enabled === enabled)
        && (this._startsWith(name, collaborator.name) || this._startsWith(name, collaborator.surname))
        && this._startsWith(email, collaborator.email);

      if (resellerCode) {
        return await paginate<Collaborator>(
          () => this._collaboratorModel.query("resellerCode").eq(resellerCode).using("resellerCodeIndex"),
          ["sub", "resellerCode"], limit, cursor, accept,
        );
      }
      if (accountType) {
        return await paginate<Collaborator>(
          () => this._collaboratorModel.query("accountType").eq(accountType).using("accountTypeIndex"),
          ["sub", "accountType"], limit, cursor, accept,
        );
      }
      // Neither a reseller nor an account type is asked, so every user is: scan is necessary here.
      return await paginate<Collaborator>(() => this._collaboratorModel.scan(), ["sub"], limit, cursor, accept);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this._logger.error("Error listing collaborators", error);
      throw new InternalServerErrorException("Failed to list collaborators");
    }
  }

  /**
   * Tells whether a value starts with the searched text, ignoring case.
   * @param search the searched text, empty or absent when there is no search.
   * @param value the value the search covers.
   * @returns true when there is no search or the value starts with it.
   */
  private _startsWith(search: string | undefined, value: string | undefined): boolean {
    const prefix = search?.trim().toLowerCase();
    return !prefix || !!value?.toLowerCase().startsWith(prefix);
  }

  /**
   * Rebuilds the projection table from the User Pool content (the source of truth):
   * upserts a record for every pool user and removes records whose sub no longer exists.
   * @param poolCollaborators the collaborator records derived from the User Pool.
   * @returns the number of upserted and removed records.
   */
  async reconcile(poolCollaborators: Collaborator[]): Promise<{ upserted: number; removed: number }> {
    try {
      this._logger.log(`Reconciling collaborators table with ${poolCollaborators.length} pool users`);

      const existingRecords = await this._collaboratorModel.scan().exec();
      const poolSubs = new Set(poolCollaborators.map(collaborator => collaborator.sub));

      for (const collaborator of poolCollaborators) {
        await this.upsertCollaborator(collaborator);
      }

      const staleRecords = existingRecords.filter(record => !poolSubs.has(record.sub));
      for (const stale of staleRecords) {
        await this._collaboratorModel.delete({ sub: stale.sub });
      }

      this._logger.log(`Reconcile completed: ${poolCollaborators.length} upserted, ${staleRecords.length} removed`);
      return { upserted: poolCollaborators.length, removed: staleRecords.length };
    } catch (error) {
      this._logger.error("Error reconciling collaborators table", error);
      throw new InternalServerErrorException("Failed to reconcile collaborators table");
    }
  }
}
