import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class DeployRequestDto {
  @IsString()
  @IsNotEmpty()
  source!: string;

  @IsString()
  @IsOptional()
  contractName?: string;
}
