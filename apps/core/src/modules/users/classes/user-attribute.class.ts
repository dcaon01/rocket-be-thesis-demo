import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * User attribute for Cognito custom attributes.
 * Used to pass additional custom attributes when creating a user.
 */
export class UserAttributeDto {
  /**
   * The name of the attribute.
   * For custom attributes, must be prefixed with 'custom:'.
   * @example 'custom:department'
   */
  @ApiProperty({
    description: 'Attribute name (use custom: prefix for custom attributes)',
    example: 'custom:department'
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  /**
   * The value of the attribute.
   * @example 'Engineering'
   */
  @ApiProperty({
    description: 'Attribute value',
    example: 'Engineering'
  })
  @IsString()
  @IsNotEmpty()
  value: string;
}