import { IsString, IsNotEmpty, Matches } from 'class-validator';

export class VerifyRequestDto {
  @IsString()
  @IsNotEmpty()
  source!: string;

  @IsString()
  @IsNotEmpty()
  contractName!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[0-9a-fA-F]{40}$/, {
    message: 'address must be a valid 0x-prefixed Ethereum address',
  })
  address!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[0-9a-fA-F]{64}$/, {
    message: 'txHash must be a valid 0x-prefixed transaction hash',
  })
  txHash!: string;
}
