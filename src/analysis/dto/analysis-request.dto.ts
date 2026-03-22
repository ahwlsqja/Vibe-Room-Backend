import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class AnalysisRequestDto {
  @IsObject()
  @IsNotEmpty()
  error!: Record<string, unknown>;

  @IsString()
  @IsNotEmpty()
  contractSource!: string;

  @IsString()
  @IsOptional()
  errorCode?: string;
}
