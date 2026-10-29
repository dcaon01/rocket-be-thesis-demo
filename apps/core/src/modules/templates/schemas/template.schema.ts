import { Schema } from "dynamoose";
import { SalesChannel } from "../../companies/enums/sales-channel.enum";
import { TemplateFormat } from "../enums/template-format.enum";
import { TemplateStatus } from "../enums/template-status.enum";
import { TemplateType } from "../enums/template-type.enum";

/**
 * Template Schema.
 * Key `type` + `id`; `scopeKey` is the scope (OFFER → channel, else `GLOBAL`).
 */
export const TemplateSchema = new Schema({
  /** Type of document the template produces. */
  type: {
    type: String,
    hashKey: true,
    enum: Object.values(TemplateType),
    required: true,
  },
  /** Identifier of the template. */
  id: {
    type: String,
    rangeKey: true,
    required: true,
  },
  /** Human-readable name of the template. */
  name: {
    type: String,
    required: true,
  },
  /** Scope of the template, fixed at creation. */
  scopeKey: {
    type: String,
    required: true,
    index: {
      name: "scopeIndex",
      type: "local",
      project: true,
    },
  },
  /** Scope of the template while it is published, absent otherwise: the index holds only templates in force. */
  publishedScopeKey: {
    type: String,
    required: false,
    index: {
      name: "publishedIndex",
      type: "local",
      project: true,
    },
  },
  /** Sales channel the template applies to. Only on offer templates. */
  channel: {
    type: String,
    enum: Object.values(SalesChannel),
    required: false,
  },
  /** Format of the template, derived from type and channel. */
  format: {
    type: String,
    enum: Object.values(TemplateFormat),
    required: true,
  },
  /** Publication state. */
  status: {
    type: String,
    enum: Object.values(TemplateStatus),
    required: true,
    default: TemplateStatus.Draft,
    index: {
      name: "statusIndex",
      type: "local",
      project: true,
    },
  },
  /** S3 key of the DOCX source. Only on DOCX templates. */
  sourceS3Key: {
    type: String,
    required: false,
  },
  /** Inline HTML body. Only on HTML templates. */
  body: {
    type: String,
    required: false,
  },
  /** Placeholders the template uses, computed by the server. */
  placeholders: {
    type: Array,
    schema: [String],
    required: false,
  },
  /** ISO timestamp of the publication. */
  publishedAt: {
    type: String,
    required: false,
  },
  /** ISO timestamp of the withdrawal. */
  withdrawnAt: {
    type: String,
    required: false,
  },
},
{
  timestamps: true,
});

/**
 * Template Key Interface.
 */
export interface TemplateKey {
  /** Type of document the template produces. */
  type: TemplateType;
  /** Identifier of the template. */
  id: string;
}

/**
 * Template Interface.
 */
export interface Template extends TemplateKey {
  /** Human-readable name of the template. */
  name: string;
  /** Scope of the template, fixed at creation. */
  scopeKey: string;
  /** Scope of the template while it is published, absent otherwise. */
  publishedScopeKey?: string;
  /** Sales channel the template applies to. */
  channel?: SalesChannel;
  /** Format of the template, derived from type and channel. */
  format: TemplateFormat;
  /** Publication state. */
  status: TemplateStatus;
  /** S3 key of the DOCX source. */
  sourceS3Key?: string;
  /** Inline HTML body. */
  body?: string;
  /** Placeholders the template uses, computed by the server. */
  placeholders?: string[];
  /** ISO timestamp of the publication. */
  publishedAt?: string;
  /** ISO timestamp of the withdrawal. */
  withdrawnAt?: string;
}
