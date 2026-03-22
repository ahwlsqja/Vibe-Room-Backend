import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JsonRpcProvider, Wallet, ContractFactory } from 'ethers';
import { PrismaService } from '../prisma/prisma.service';
import { CompileService } from './compile.service';
import { CompileResultDto } from './dto/compile-result.dto';

export interface DeployResult {
  contractName: string;
  address: string;
  txHash: string;
  deploymentId: string;
}

@Injectable()
export class DeployService {
  private readonly logger = new Logger(DeployService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
    private readonly compileService: CompileService,
  ) {}

  /**
   * Compile Solidity source and deploy to Monad testnet.
   *
   * Creates a Deployment record with status='pending' before attempting,
   * then updates to 'deployed' (with address, txHash) on success
   * or 'failed' (with errorMessage) on failure.
   *
   * @param source - Raw Solidity source code
   * @param userId - User ID for the deployment record (defaults to 'anonymous')
   * @returns DeployResult with address, txHash, and deploymentId
   * @throws ServiceUnavailableException if MONAD_PRIVATE_KEY is not configured
   * @throws BadRequestException if compilation fails (propagated from CompileService)
   */
  async deploy(source: string, userId?: string): Promise<DeployResult> {
    const privateKey = this.configService.get<string>('monad.privateKey');
    if (!privateKey) {
      throw new ServiceUnavailableException(
        'Server not configured for deployment',
      );
    }

    const resolvedUserId = userId ?? null;

    // Compile the source code
    const compiled: CompileResultDto = this.compileService.compile(source);

    this.logger.log(
      `Deploy attempt: contract=${compiled.contractName}, userId=${resolvedUserId}`,
    );

    // Create a pending deployment record
    const deployment = await this.prismaService.deployment.create({
      data: {
        userId: resolvedUserId,
        contractName: compiled.contractName,
        contractSource: source,
        status: 'pending',
      },
    });

    try {
      const rpcUrl = this.configService.get<string>('monad.rpcUrl');
      const provider = new JsonRpcProvider(rpcUrl);
      const wallet = new Wallet(privateKey, provider);

      const factory = new ContractFactory(compiled.abi, compiled.bytecode, wallet);
      const contract = await factory.deploy();

      await contract.waitForDeployment();
      const address = await contract.getAddress();
      const txHash = contract.deploymentTransaction()?.hash ?? '';

      // Update deployment record to 'deployed'
      await this.prismaService.deployment.update({
        where: { id: deployment.id },
        data: {
          status: 'deployed',
          address,
          txHash,
        },
      });

      this.logger.log(
        `Deploy success: contract=${compiled.contractName}, address=${address}, txHash=${txHash}`,
      );

      return {
        contractName: compiled.contractName,
        address,
        txHash,
        deploymentId: deployment.id,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Update deployment record to 'failed'
      await this.prismaService.deployment.update({
        where: { id: deployment.id },
        data: {
          status: 'failed',
          errorMessage,
        },
      });

      this.logger.error(
        `Deploy failed: contract=${compiled.contractName}, error=${errorMessage}`,
      );

      throw error;
    }
  }
}
