import { Injectable } from '@nestjs/common';

@Injectable()
export class AwsDecodingService {
  /**
   * Decodes a string and replaces all occurrences of '&' with '%'
   * in non-development environments.
   *
   * @param inputString - The string to decode and replace
   * @returns The decoded and replaced string
   */
  public decodeAndReplace(inputString: string): string {
    // Only modify the string if not in development environment
    if (process.env.NODE_ENV !== 'development') {
      inputString = inputString.replace(/&/g, '%');
    }
    return decodeURIComponent(inputString);
  }
}