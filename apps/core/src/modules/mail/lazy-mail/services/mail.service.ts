import { Injectable, Logger } from '@nestjs/common';
import { CognitoIdentityProviderClient, ListUsersCommand, ListUsersInGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import { SendEmailCommand, SESv2Client, TestRenderEmailTemplateCommand } from '@aws-sdk/client-sesv2';
import { randomUUID } from 'crypto';
import * as Handlebars from 'handlebars';
import { integrationsEnabled } from '../../../../commons/integrations/integrations.helper';
import { AppException, ValidationException } from '../../../../errors/exception-types';
import { MailTemplate } from '../../enums/mail-template.enum';
import type { MailAttachment } from '../../interfaces/mail-attachment.interface';
import type { MailRecipient } from '../../interfaces/mail-recipient.interface';

/** Shape of a Cognito sub: a UUID, without the RFC version and variant bits that Cognito does not always respect. */
const COGNITO_SUB = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Service that sends Rocket's own emails, to resellers, Keus staff and the companies.
 * The content lives in rocket-infra as SES templates wrapped in the brand frame:
 * this service only names the template and passes its data, SES fills it.
 *
 * Recipients are collaborators, who live in the Cognito user pool, so the
 * service also resolves a collaborator's address from its Cognito `sub`.
 * With the integrations off (the demo) nothing is sent: each email is only logged.
 */
@Injectable()
export class MailService {
  /** Logger instance for MailService. */
  private readonly _logger = new Logger(MailService.name);

  /** SES client instance. */
  private readonly _ses: SESv2Client;

  /** Cognito client instance, used to resolve collaborators. */
  private readonly _cognito: CognitoIdentityProviderClient;

  /** Sender, with its display name: `Rocket <noreply@domain>`. */
  private readonly _from: string;

  /** Prefix of the SES template names, the environment's name prefix. */
  private readonly _templatePrefix: string;

  /** Identifier of the Cognito user pool of Rocket collaborators. */
  private readonly _userPoolId: string;

  /**
   * Constructor for MailService.
   * @throws AppException if the sender, the template prefix or the user pool is not configured.
   */
  constructor() {
    const region = process.env.AWS_REGION || 'eu-west-1';

    this._from = process.env.MAIL_FROM ?? '';
    this._templatePrefix = process.env.MAIL_TEMPLATE_PREFIX ?? '';
    this._userPoolId = process.env.COGNITO_USER_POOL_ID ?? '';
    if (!this._from || !this._templatePrefix || !this._userPoolId) {
      throw new AppException('MAIL_FROM, MAIL_TEMPLATE_PREFIX and COGNITO_USER_POOL_ID must be set to send emails.', 500);
    }

    if (process.env.NODE_ENV === 'development') {
      const credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      };
      this._ses = new SESv2Client({ region, credentials });
      this._cognito = new CognitoIdentityProviderClient({ region, credentials });
    } else {
      this._ses = new SESv2Client({ region });
      this._cognito = new CognitoIdentityProviderClient({ region });
    }

    this._logger.log('Mail service initialized successfully');
  }

  /**
   * Sends one templated email.
   * SES fills the template without escaping, so the values go out escaped for
   * the HTML part and, untouched, under `text` for the plain-text part.
   * @param template the SES template to fill.
   * @param to the recipient's address.
   * @param data the values of the template's placeholders.
   * @throws ValidationException if the data uses the reserved `text` key.
   * @throws AppException if SES refuses the email.
   */
  async send(template: MailTemplate, to: string, data: Record<string, unknown>): Promise<void> {
    // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
    if (!integrationsEnabled()) {
      this._logger.log(`Email ${template} to ${to} not sent: the demo sends no emails.`);
      return;
    }

    if ('text' in data) {
      throw new ValidationException('The key "text" is reserved for the raw values of an email.', []);
    }
    const templateName = `${this._templatePrefix}-${template}`;
    this._logger.log(`Sending email ${templateName} to ${to}`);

    try {
      await this._ses.send(new SendEmailCommand({
        FromEmailAddress: this._from,
        Destination: { ToAddresses: [to] },
        Content: {
          Template: {
            TemplateName: templateName,
            TemplateData: JSON.stringify({ ...(this._escapeHtml(data) as Record<string, unknown>), text: data }),
          },
        },
      }));
      this._logger.log(`Email ${templateName} sent to ${to}.`);
    } catch (error) {
      this._logger.error(`Error sending email ${templateName} to ${to}`, error);
      throw new AppException(`An error occurred while sending the email ${templateName}.`, 500);
    }
  }

  /**
   * Sends one templated email with attachments. SES templates take no attachments: SES renders the template with
   * the same data as `send`, and the rendered message goes out as the first part of a raw one with the attachments.
   * @param template the SES template to fill.
   * @param to the recipient's address.
   * @param data the values of the template's placeholders.
   * @param attachments the files to attach.
   * @throws ValidationException if the data uses the reserved `text` key, or the address breaks a header line.
   * @throws AppException if SES cannot render or refuses the email.
   */
  async sendWithAttachments(template: MailTemplate, to: string, data: Record<string, unknown>, attachments: MailAttachment[]): Promise<void> {
    // Demo mode (INTEGRATIONS_ENABLED=false), not part of the original Rocket.
    if (!integrationsEnabled()) {
      this._logger.log(`Email ${template} to ${to} not sent: the demo sends no emails.`);
      return;
    }

    if ('text' in data) {
      throw new ValidationException('The key "text" is reserved for the raw values of an email.', []);
    }
    // The address goes in a header of the raw message: a line break would add headers or recipients.
    if (/[\r\n]/.test(to)) {
      throw new ValidationException(`Invalid email address for a raw message: ${JSON.stringify(to)}.`, []);
    }
    const templateName = `${this._templatePrefix}-${template}`;
    this._logger.log(`Sending email ${templateName} with ${attachments.map(file => file.fileName).join(', ')} to ${to}`);

    try {
      const { RenderedTemplate } = await this._ses.send(new TestRenderEmailTemplateCommand({
        TemplateName: templateName,
        TemplateData: JSON.stringify({ ...(this._escapeHtml(data) as Record<string, unknown>), text: data }),
      }));
      if (!RenderedTemplate) {
        throw new AppException(`SES rendered nothing for the email ${templateName}.`, 500);
      }
      await this._ses.send(new SendEmailCommand({
        FromEmailAddress: this._from,
        Destination: { ToAddresses: [to] },
        Content: { Raw: { Data: Buffer.from(this._withAttachments(RenderedTemplate, to, attachments)) } },
      }));
      this._logger.log(`Email ${templateName} sent to ${to}.`);
    } catch (error) {
      this._logger.error(`Error sending email ${templateName} to ${to}`, error);
      throw new AppException(`An error occurred while sending the email ${templateName}.`, 500);
    }
  }

  /**
   * Wraps a message rendered by SES in a `multipart/mixed` one with attachments: the rendered body, with its own
   * content headers, becomes the first part, and each file one part after it.
   * @param rendered the MIME message SES rendered.
   * @param to the recipient's address.
   * @param attachments the files to attach.
   * @returns the raw message.
   */
  private _withAttachments(rendered: string, to: string, attachments: MailAttachment[]): string {
    const separator = rendered.match(/\r?\n\r?\n/);
    const headerBlock = separator ? rendered.slice(0, separator.index) : rendered;
    const body = separator ? rendered.slice((separator.index ?? 0) + separator[0].length) : '';
    // Folded headers continue on lines that start with blanks.
    const headers = headerBlock.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/);
    const header = (name: string): string | undefined =>
      headers.find(line => line.toLowerCase().startsWith(`${name.toLowerCase()}:`));
    const boundary = `mixed-${randomUUID()}`;
    const parts = attachments.flatMap(attachment => {
      const fileName = attachment.fileName.replace(/["\r\n]/g, '');
      const contentType = attachment.contentType.replace(/[\r\n]/g, '');
      const base64 = attachment.content.toString('base64').replace(/.{1,76}/g, line => `${line}\r\n`);
      return [
        `--${boundary}`,
        `Content-Type: ${contentType}; name="${fileName}"`,
        `Content-Disposition: attachment; filename="${fileName}"`,
        'Content-Transfer-Encoding: base64',
        '',
        base64,
      ];
    });

    return [
      `From: ${this._from}`,
      `To: ${to}`,
      header('Subject') ?? 'Subject: Rocket',
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      header('Content-Type') ?? 'Content-Type: text/plain; charset=UTF-8',
      ...(header('Content-Transfer-Encoding') ? [header('Content-Transfer-Encoding')] : []),
      '',
      body,
      ...parts,
      `--${boundary}--`,
      '',
    ].join('\r\n');
  }

  /**
   * Sends one templated email to each enabled collaborator of some Cognito groups.
   * @param template the SES template to fill.
   * @param groups the Cognito groups, i.e. the profiles.
   * @param data the values of the template's placeholders.
   * @param resellerCode the reseller the collaborators must belong to, if any.
   * @throws AppException if Cognito cannot be queried or SES refuses an email.
   */
  async sendToGroups(template: MailTemplate, groups: string[], data: Record<string, unknown>, resellerCode?: string): Promise<void> {
    const recipients = await this.findCollaboratorsInGroups(groups, resellerCode);
    for (const recipient of recipients) {
      await this.send(template, recipient.email, data);
    }
  }

  /**
   * Escapes every string in a template's data for HTML, through arrays and objects.
   * @param value the data, or a part of it.
   * @returns the same shape, with its strings escaped.
   */
  private _escapeHtml(value: unknown): unknown {
    if (typeof value === 'string') {
      return Handlebars.Utils.escapeExpression(value);
    }
    if (Array.isArray(value)) {
      return value.map(item => this._escapeHtml(item));
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this._escapeHtml(item)]));
    }
    return value;
  }

  /**
   * Finds a Rocket collaborator by its Cognito identifier.
   * @param sub the Cognito `sub` of the collaborator.
   * @returns the collaborator's address, reseller and name, or null if no user has that sub.
   * @throws ValidationException if the sub is not UUID-shaped.
   * @throws AppException if Cognito cannot be queried.
   */
  async findCollaborator(sub: string): Promise<MailRecipient | null> {
    // The sub goes inside a quoted Cognito filter: only the UUID shape can't alter it.
    if (!COGNITO_SUB.test(sub)) {
      throw new ValidationException(`Invalid Cognito sub: ${sub}.`, []);
    }
    try {
      const { Users } = await this._cognito.send(new ListUsersCommand({
        UserPoolId: this._userPoolId,
        Filter: `sub = "${sub}"`,
        Limit: 1,
      }));
      const attributes = Users?.[0]?.Attributes ?? [];
      const email = attributes.find(attribute => attribute.Name === 'email')?.Value;
      if (!email) {
        this._logger.warn(`No collaborator with an email found for sub: ${sub}`);
        return null;
      }
      const resellerCode = attributes.find(attribute => attribute.Name === 'custom:resellerCode')?.Value;
      const fullName = ['name', 'family_name']
        .map(name => attributes.find(attribute => attribute.Name === name)?.Value)
        .filter(Boolean)
        .join(' ');
      return { email, ...(resellerCode && { resellerCode }), ...(fullName && { fullName }) };
    } catch (error) {
      this._logger.error(`Error finding collaborator with sub: ${sub}`, error);
      throw new AppException(`An error occurred while finding the collaborator ${sub}.`, 500);
    }
  }

  /**
   * Finds the enabled collaborators of some Cognito groups, those of one reseller when a code is given.
   * @param groups the Cognito groups, i.e. the profiles.
   * @param resellerCode the reseller the collaborators must belong to, if any.
   * @returns the collaborators, each address once.
   * @throws AppException if Cognito cannot be queried.
   */
  async findCollaboratorsInGroups(groups: string[], resellerCode?: string): Promise<MailRecipient[]> {
    const recipients = new Map<string, MailRecipient>();
    try {
      for (const group of groups) {
        let nextToken: string | undefined;
        do {
          const page = await this._cognito.send(new ListUsersInGroupCommand({ UserPoolId: this._userPoolId, GroupName: group, NextToken: nextToken }));
          for (const user of page.Users ?? []) {
            const attributes = user.Attributes ?? [];
            const email = attributes.find(attribute => attribute.Name === 'email')?.Value;
            const code = attributes.find(attribute => attribute.Name === 'custom:resellerCode')?.Value;
            if (!user.Enabled || !email || (resellerCode && code !== resellerCode)) continue;
            recipients.set(email, { email, ...(code && { resellerCode: code }) });
          }
          nextToken = page.NextToken;
        } while (nextToken);
      }
      return [...recipients.values()];
    } catch (error) {
      this._logger.error(`Error finding the collaborators of groups ${groups.join(', ')}`, error);
      throw new AppException('An error occurred while finding the collaborators to notify.', 500);
    }
  }
}
