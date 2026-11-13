/** A file attached to an email. */
export interface MailAttachment {
  /** Name of the file, as the recipient sees it. */
  fileName: string;
  /** Media type of the file. */
  contentType: string;
  /** Content of the file. */
  content: Buffer;
}
