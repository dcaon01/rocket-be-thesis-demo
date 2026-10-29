import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { AwsDecodingService } from '../commons/aws/aws-decode-uri.service';

@Injectable()
export class AwsDecodeUriInterceptor implements NestInterceptor {
  constructor(private readonly _awsDecodingService: AwsDecodingService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<{
      params: Record<string, string>;
      query: Record<string, string>;
    }>();

    if (request.params) {
      for (const key in request.params) {
        request.params[key] = this._awsDecodingService.decodeAndReplace(
          request.params[key],
        );
      }
    }

    if (request.query) {
      for (const key in request.query) {
        request.query[key] = this._awsDecodingService.decodeAndReplace(
          request.query[key],
        );
      }
    }
    return next.handle();
  }
}