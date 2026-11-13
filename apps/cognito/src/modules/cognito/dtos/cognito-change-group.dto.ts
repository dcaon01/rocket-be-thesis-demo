import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum } from 'class-validator';
import { Role } from '../enums/role.enum';

/**
 * Data Transfer Object for changing a user's Cognito groups.
 * This DTO is used to update the user's roles/groups in AWS Cognito.
 */
export class CognitoChangeGroupDto {
  /**
   * The new profile of the user, as a one-item list: profiles are not cumulative.
   */
  @ApiProperty({
    description: 'The new profile of the user, as a one-item list: profiles are not cumulative',
    enum: Role,
    isArray: true,
    example: [Role.KeusAdmin],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'A profile is required' })
  @ArrayMaxSize(1, { message: 'A user holds a single profile' })
  @IsEnum(Role, {
    each: true,
    message: 'Each group must be a valid Cognito group',
  })
  groups: Role[];
}