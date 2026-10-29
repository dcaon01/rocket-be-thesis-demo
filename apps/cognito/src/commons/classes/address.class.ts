import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class AddressDto {
  @ApiProperty({
    required: false,
  })
  @IsOptional()
  @IsString()
  streetName?: string;

  @ApiProperty({
    required: false,
  })
  @IsOptional()
  @IsString()
  streetNumber?: string;

  @ApiProperty({
    required: false,
  })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiProperty({
    required: false,
  })
  @IsOptional()
  @IsString()
  cap?: string;

  @ApiProperty({
    required: false,
  })
  @IsOptional()
  @IsString()
  province?: string;

  @ApiProperty({
    required: false,
  })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiProperty({
    required: false,
  })
  @IsOptional()
  @IsString()
  country?: string;
}