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
import { PaymasterService } from '../paymaster/paymaster.service';

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
    private readonly paymasterService: PaymasterService,
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

      // Build default constructor arguments from ABI
      const constructorArgs = this.buildDefaultConstructorArgs(compiled.abi);
      this.logger.log(
        `Deploying ${compiled.contractName} with ${constructorArgs.length} constructor arg(s)`,
      );
      const contract = await factory.deploy(...constructorArgs);

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

      // Increment free deploy count if authenticated user
      if (resolvedUserId) {
        try {
          await this.paymasterService.incrementDeployCount(resolvedUserId);
        } catch (err) {
          this.logger.warn(`Failed to increment deploy count for userId=${resolvedUserId}: ${err}`);
        }
      }

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

  /**
   * Build default constructor arguments from ABI.
   * Generates sensible defaults for each Solidity type so that
   * template contracts with constructor params can be deployed
   * without user-supplied values.
   */
  private buildDefaultConstructorArgs(abi: any[]): any[] {
    const ctor = abi.find((item: any) => item.type === 'constructor');
    if (!ctor || !ctor.inputs || ctor.inputs.length === 0) {
      return [];
    }

    return ctor.inputs.map((input: any) => this.defaultForType(input.type, input.name));
  }

  private defaultForType(type: string, name?: string): any {
    // Check for common naming conventions to provide better defaults
    const lowerName = (name || '').toLowerCase();

    if (type === 'string') {
      if (lowerName.includes('name')) return 'MyToken';
      if (lowerName.includes('symbol')) return 'MTK';
      return 'default';
    }

    if (type === 'bool') return false;

    if (type === 'address') return '0x0000000000000000000000000000000000000001';

    if (type === 'bytes32') return '0x' + '00'.repeat(32);

    if (type.startsWith('bytes')) return '0x00';

    // uint / int types
    if (type.startsWith('uint') || type.startsWith('int')) {
      // Smart defaults for common parameter names
      if (lowerName.includes('fee') || lowerName.includes('bps')) return 250; // 2.5%
      if (lowerName.includes('supply') || lowerName.includes('total')) return BigInt('1000000000000000000000000'); // 1M * 1e18
      if (lowerName.includes('decimal')) return 18;
      if (lowerName.includes('limit') || lowerName.includes('max')) return 1000;
      if (lowerName.includes('duration') || lowerName.includes('period')) return 86400; // 1 day
      if (lowerName.includes('rate') || lowerName.includes('reward')) return 100;
      return 0;
    }

    // Arrays
    if (type.endsWith('[]')) return [];

    // Tuples and unknown
    return 0;
  }
}
