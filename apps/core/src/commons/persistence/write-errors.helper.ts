/**
 * Tells whether a single conditional write was refused because its condition did not hold:
 * a concurrent change, or a missing item. Dynamoose surfaces it with the AWS SDK name or only in the message.
 * @param error the error thrown by the write.
 * @returns true when the condition failed.
 */
export function isConditionalCheckFailed(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "ConditionalCheckFailedException"
    || error.message.includes("ConditionalCheckFailed")
    || error.message.includes("conditional request failed");
}

/**
 * Tells whether a transaction was cancelled, typically because one of its conditions did not hold.
 * @param error the error thrown by the transaction.
 * @returns true when the transaction was cancelled.
 */
export function isTransactionCanceled(error: unknown): boolean {
  return error instanceof Error && error.name === "TransactionCanceledException";
}
