/**
 * Publication state of a template.
 * Only a published template can generate a document, and only one is published
 * at a time for a given scope: publishing a new one withdraws the previous.
 *
 * Editing a template never touches the documents already generated: a signed
 * contract keeps the text that was in force when it was accepted.
 */
export enum TemplateStatus {
  /** Being written, not usable yet. */
  Draft = 'DRAFT',
  /** In force: this is the one documents are generated from. */
  Published = 'PUBLISHED',
  /** Replaced or retired, kept for the documents that reference it. */
  Withdrawn = 'WITHDRAWN',
}
