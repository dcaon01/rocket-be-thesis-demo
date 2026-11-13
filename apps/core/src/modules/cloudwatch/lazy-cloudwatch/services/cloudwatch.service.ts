import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { CloudWatchClient, GetMetricDataCommand, MetricDataQuery } from '@aws-sdk/client-cloudwatch';
import { AppException } from '../../../../errors/exception-types';
import { ApiGatewayRef, ApiLatency } from '../../interfaces/api-latency.interface';

/** Stage the HTTP APIs of the products are deployed on. */
const API_GATEWAY_STAGE = '$default';

/** Longest wait for a read of CloudWatch. */
const REQUEST_TIMEOUT_MS = 10_000;

/** Seconds in an hour: the period of a window older than 63 days must be a multiple of it. */
const HOUR_SECONDS = 3600;

/**
 * Reader of the metrics API Gateway writes on CloudWatch, for the latency of the products (UR-RK-225). The products
 * are in the account of Rocket, each in its own region, so a client is built per region and kept. Nothing in the
 * products has to change: an HTTP API writes `Count` and `Latency` by itself.
 */
@Injectable()
export class CloudwatchService {
  /** Logger instance for CloudwatchService. */
  private readonly _logger = new Logger(CloudwatchService.name);

  /** CloudWatch client of each region already read. */
  private readonly _clients = new Map<string, CloudWatchClient>();

  /**
   * Reads calls, median and 95th percentile of the latency of some HTTP APIs in a window, with one request per
   * region. The window is a single period, so CloudWatch computes the percentiles over all of it.
   * @param apis the APIs to read.
   * @param start the start of the window.
   * @param end the end of the window.
   * @returns the calls and the latency per API, keyed by `region#apiId`.
   * @throws AppException if CloudWatch cannot be read.
   */
  async getApiLatency(apis: ApiGatewayRef[], start: Date, end: Date): Promise<Map<string, ApiLatency>> {
    const period = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 1000 / HOUR_SECONDS)) * HOUR_SECONDS;
    const byRegion = new Map<string, ApiGatewayRef[]>();
    apis.forEach(api => byRegion.set(api.region, [...(byRegion.get(api.region) ?? []), api]));

    const latencies = new Map<string, ApiLatency>();
    await Promise.all([...byRegion].map(async ([region, regionApis]) => {
      const queries = regionApis.flatMap((api, index) => this._queriesOf(api, index, period));
      const values = await this._read(region, queries, start, end);

      regionApis.forEach((api, index) => latencies.set(`${region}#${api.apiId}`, {
        requests: values.get(`q${index}_count`) ?? 0,
        ...(values.has(`q${index}_p50`) && { p50Ms: values.get(`q${index}_p50`) }),
        ...(values.has(`q${index}_p95`) && { p95Ms: values.get(`q${index}_p95`) }),
      }));
    }));

    this._logger.log(`Read the latency of ${apis.length} APIs from ${start.toISOString()} to ${end.toISOString()}.`);
    return latencies;
  }

  /**
   * Builds the three queries of an API: calls, median and 95th percentile of the latency.
   * @param api the API.
   * @param index the position of the API in its request, which names its queries.
   * @param period the period of the window, in seconds.
   * @returns the queries.
   */
  private _queriesOf(api: ApiGatewayRef, index: number, period: number): MetricDataQuery[] {
    const metric = (metricName: string) => ({
      Namespace: 'AWS/ApiGateway',
      MetricName: metricName,
      Dimensions: [{ Name: 'ApiId', Value: api.apiId }, { Name: 'Stage', Value: API_GATEWAY_STAGE }],
    });

    return [
      { Id: `q${index}_count`, MetricStat: { Metric: metric('Count'), Period: period, Stat: 'Sum' } },
      { Id: `q${index}_p50`, MetricStat: { Metric: metric('Latency'), Period: period, Stat: 'p50' } },
      { Id: `q${index}_p95`, MetricStat: { Metric: metric('Latency'), Period: period, Stat: 'p95' } },
    ];
  }

  /**
   * Sends the queries of a region and keeps the single value of each.
   * @param region the region of the APIs.
   * @param queries the queries.
   * @param start the start of the window.
   * @param end the end of the window.
   * @returns the value of each query with data, by query identifier.
   * @throws AppException if CloudWatch cannot be read.
   */
  private async _read(region: string, queries: MetricDataQuery[], start: Date, end: Date): Promise<Map<string, number>> {
    try {
      const response = await this._clientOf(region).send(
        new GetMetricDataCommand({ MetricDataQueries: queries, StartTime: start, EndTime: end }),
        { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );

      const values = new Map<string, number>();
      (response.MetricDataResults ?? []).forEach(result => {
        if (result.Id && result.Values?.length) {
          values.set(result.Id, result.Values[0]);
        }
      });
      return values;
    } catch (error) {
      this._logger.warn(`CloudWatch read in ${region} failed`, error);
      throw new AppException('CloudWatch could not be read.', HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * Returns the client of a region, built on first use: with the credentials of the environment in development, with
   * the role of the Lambda otherwise.
   * @param region the region.
   * @returns the client.
   */
  private _clientOf(region: string): CloudWatchClient {
    let client = this._clients.get(region);
    if (!client) {
      client = process.env.NODE_ENV === 'development'
        ? new CloudWatchClient({
          region,
          credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID || '', secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '' },
        })
        : new CloudWatchClient({ region });
      this._clients.set(region, client);
    }

    return client;
  }
}
