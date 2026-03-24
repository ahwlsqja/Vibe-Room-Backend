import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsIn,
} from 'class-validator';

export class PublishRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50000)
  source!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description!: string;

  @IsOptional()
  @IsString()
  @IsIn(['DeFi', 'NFT', 'Utility', 'Monad-Optimized'])
  category?: string;
}
