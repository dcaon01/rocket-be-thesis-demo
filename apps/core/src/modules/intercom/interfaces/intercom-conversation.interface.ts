/**
 * The fields of an Intercom conversation the support metrics read. Timestamps are Unix seconds, durations seconds;
 * a statistic is null until it happens (no reply, never closed).
 */
export interface IntercomConversation {
  /** Identifier of the conversation. */
  id: string;
  /** When the conversation was opened. */
  created_at: number;
  /** How the conversation started: `customer_initiated` when the customer wrote first. */
  source?: { delivered_as?: string } | null;
  /** Ticket the conversation became, if a teammate turned it into one. */
  ticket?: unknown;
  /** Conversation attributes; the brand the conversation came through is in `Brand`, by name. */
  custom_attributes?: Record<string, unknown>;
  /** Timing statistics of the conversation. */
  statistics?: {
    /** Seconds from the opening to the first reply of a teammate. */
    time_to_admin_reply?: number | null;
    /** Seconds from the opening to the first close. */
    time_to_first_close?: number | null;
    /** When the conversation was first closed. */
    first_close_at?: number | null;
  } | null;
}

/** A page of the conversation search, with the cursor of the next one. */
export interface IntercomConversationPage {
  /** Conversations of the page. */
  conversations: IntercomConversation[];
  /** Pagination, with `next.starting_after` while more pages exist. */
  pages?: { next?: { starting_after?: string } | null } | null;
}

/** A brand of the Intercom workspace. */
export interface IntercomBrand {
  /** Identifier of the brand. */
  id: string;
  /** Name of the brand, as the conversations carry it. */
  name: string;
}
