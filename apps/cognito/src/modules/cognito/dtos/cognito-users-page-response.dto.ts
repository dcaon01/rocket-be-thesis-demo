import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CollaboratorResponseDto } from './collaborator-response.dto';

/** One page of the user listing, read from the collaborators projection. */
export class CognitoUsersPageResponseDto {
  /** Users of the page. */
  @ApiProperty({
    description: 'Users of the page.',
    type: [CollaboratorResponseDto],
    required: true,
  })
  items: CollaboratorResponseDto[];

  /** Cursor of the next page, absent on the last one. */
  @ApiPropertyOptional({
    description: 'Cursor of the next page, absent on the last one.',
  })
  nextCursor?: string;
}
