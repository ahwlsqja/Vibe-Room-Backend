import { IsString, IsNotEmpty } from 'class-validator';

export class RelaySignedDto {
  @IsString()
  @IsNotEmpty()
  signedTransaction!: string;
}
