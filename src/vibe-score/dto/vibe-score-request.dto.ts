import { IsString, IsNotEmpty } from 'class-validator';

export class VibeScoreRequestDto {
  @IsString()
  @IsNotEmpty()
  source!: string;
}
