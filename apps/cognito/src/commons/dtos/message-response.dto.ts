import { ApiProperty } from '@nestjs/swagger';

export class MessageResponseDto {
  @ApiProperty({
    description: 'Response message',
    example: 'Operation completed successfully'
  })
  message: string;

  @ApiProperty({
    description: 'Optional operation details',
    required: false,
    example: { userId: '123', operation: 'DELETE' }
  })
  details?: Record<string, string | number | boolean>;

  constructor(message: string, details?: Record<string, string | number | boolean>) {
    this.message = message;
    if (details) {
      this.details = details;
    }
  }
}