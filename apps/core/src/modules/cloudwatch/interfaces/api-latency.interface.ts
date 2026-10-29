/** An HTTP API of API Gateway, as its `execute-api` address names it. */
export interface ApiGatewayRef {
  /** Identifier of the API. */
  apiId: string;
  /** Region of the API. */
  region: string;
}

/** Calls and latency of an HTTP API in a window, from the metrics API Gateway writes on CloudWatch. */
export interface ApiLatency {
  /** Calls the API received in the window. */
  requests: number;
  /** Median latency of the calls, in milliseconds; absent when the API had no calls. */
  p50Ms?: number;
  /** 95th percentile of the latency of the calls, in milliseconds; absent when the API had no calls. */
  p95Ms?: number;
}
