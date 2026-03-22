import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JsonRpcProvider } from 'ethers';
import { PrismaService } from '../prisma/prisma.service';
import { DeployStatusDto } from './dto/deploy-status.dto';

export const MAX_FREE_DEPLOYMENTS = 3;

@Injectable()
export class PaymasterService {
  private readonly logger = new Logger(PaymasterService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Get the current deploy status for a user — how many free deploys used,
   * how many remain, and whether relay is still available.
   */
  async getDeployStatus(userId: string): Promise<DeployStatusDto> {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      this.logger.warn(`User not found for deploy status check: ${userId}`);
      throw new NotFoundException(`User not found: ${userId}`);
    }

    const used = user.deployCount;
    const remaining = Math.max(0, MAX_FREE_DEPLOYMENTS - used);
    const canUseRelay = used < MAX_FREE_DEPLOYMENTS;

    this.logger.log(
      `Deploy status for user ${userId}: used=${used}, remaining=${remaining}, canUseRelay=${canUseRelay}`,
    );

    return {
      used,
      max: MAX_FREE_DEPLOYMENTS,
      remaining,
      canUseRelay,
    };
  }

  /**
   * Check whether the user is still eligible for free relay (under the deploy limit).
   */
  async canUseRelay(userId: string): Promise<boolean> {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      this.logger.warn(`User not found for relay check: ${userId}`);
      return false;
    }

    const eligible = user.deployCount < MAX_FREE_DEPLOYMENTS;
    this.logger.log(
      `Relay eligibility for user ${userId}: ${eligible} (deployCount=${user.deployCount})`,
    );
    return eligible;
  }

  /**
   * Increment the user's deploy count by 1. Returns the new count.
   */
  async incrementDeployCount(userId: string): Promise<number> {
    const updated = await this.prismaService.user.update({
      where: { id: userId },
      data: { deployCount: { increment: 1 } },
    });

    this.logger.log(
      `Incremented deploy count for user ${userId}: new count=${updated.deployCount}`,
    );

    return updated.deployCount;
  }

  /**
   * Broadcast a pre-signed transaction to the Monad testnet via ethers.js.
   * Returns the transaction hash on success.
   */
  async broadcastSignedTransaction(
    signedTxHex: string,
  ): Promise<{ txHash: string }> {
    const rpcUrl = this.configService.get<string>('monad.rpcUrl');
    this.logger.log(`Broadcasting signed transaction to ${rpcUrl}`);

    try {
      const provider = new JsonRpcProvider(rpcUrl);
      const response = await provider.broadcastTransaction(signedTxHex);

      this.logger.log(
        `Transaction broadcast successful: txHash=${response.hash}`,
      );

      return { txHash: response.hash };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Transaction broadcast failed: ${errorMessage}`,
      );
      throw new BadRequestException(
        `Failed to broadcast transaction: ${errorMessage}`,
      );
    }
  }
}
