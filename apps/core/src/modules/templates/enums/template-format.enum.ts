/** Format of a template, derived from its type and channel at creation. */
export enum TemplateFormat {
  /** Inline HTML body filled with Handlebars: contract, direct-channel offer. */
  Html = 'HTML',
  /** DOCX source on S3 filled with docxtemplater: indirect-channel offer. */
  Docx = 'DOCX',
}
