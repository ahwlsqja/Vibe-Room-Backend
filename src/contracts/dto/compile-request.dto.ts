import { IsString, IsNotEmpty } from 'class-validator';

export class CompileRequestDto {
  @IsString()
  @IsNotEmpty()
  source!: string;
}
