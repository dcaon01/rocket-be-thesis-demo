import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { AppException } from '../../../../errors/exception-types';

/** Response of the render Lambda. */
interface RenderResponse {
  /** The rendered document, base64. */
  content?: string;
}

/**
 * Service that renders Rocket's HTML documents into PDF through the render Lambda (Python, WeasyPrint), which
 * reads the print CSS of the template (`@page`, margins) the way a browser prints it.
 *
 * The call is synchronous and the document travels in the payload both ways, so the Lambda keeps no state and
 * reads nothing from S3. A Lambda payload is capped at 6 MB each way, far above a contract.
 */
@Injectable()
export class RenderService {
  /** Logger instance for RenderService. */
  private readonly _logger = new Logger(RenderService.name);

  /** Lambda client instance. */
  private readonly _lambda: LambdaClient;

  /** Name of the render Lambda. */
  private readonly _functionName: string;

  /**
   * Constructor for RenderService.
   * @throws AppException if the name of the render Lambda is not configured.
   */
  constructor() {
    const region = process.env.AWS_REGION || 'eu-west-1';

    this._functionName = process.env.RENDER_FUNCTION_NAME ?? '';
    if (!this._functionName) {
      throw new AppException('RENDER_FUNCTION_NAME must be set to render documents.', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    if (process.env.NODE_ENV === 'development') {
      const credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      };
      this._lambda = new LambdaClient({ region, credentials });
    } else {
      this._lambda = new LambdaClient({ region });
    }

    this._logger.log('Render service initialized successfully');
  }

  /**
   * Renders an HTML document into PDF.
   * @param html the complete HTML document, with its styles.
   * @returns the PDF.
   * @throws AppException if the Lambda cannot be invoked or fails to render the document.
   */
  async renderPdf(html: string): Promise<Buffer> {
    let body: string;
    let functionError: string | undefined;
    try {
      const response = await this._lambda.send(new InvokeCommand({
        FunctionName: this._functionName,
        Payload: Buffer.from(JSON.stringify({ format: 'pdf', html })),
      }));
      body = response.Payload ? Buffer.from(response.Payload).toString('utf8') : '';
      functionError = response.FunctionError;
    } catch (error) {
      this._logger.error('Error invoking the render Lambda', error);
      throw new AppException('An error occurred while rendering the document into PDF.', HttpStatus.INTERNAL_SERVER_ERROR, error);
    }

    // A failure inside the Lambda still answers 200: it shows only in FunctionError, with the error in the payload.
    const content = functionError ? undefined : this._contentOf(body);
    if (!content) {
      this._logger.error(`The render Lambda returned no document: ${body}`);
      throw new AppException('An error occurred while rendering the document into PDF.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
    return Buffer.from(content, 'base64');
  }

  /**
   * Reads the rendered document from the response of the render Lambda.
   * @param body the response, as text.
   * @returns the document in base64, or undefined if the response is empty or not the expected JSON.
   */
  private _contentOf(body: string): string | undefined {
    try {
      return (JSON.parse(body) as RenderResponse).content;
    } catch {
      return undefined;
    }
  }
}
