import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  DeploymentRecord,
  UserDeploymentsResponse,
} from './dto/user-deployments.dto';
import { UserStatsResponse } from './dto/user-stats.dto';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get paginated deployment history for a user.
   */
  async getDeployments(
    userId: string,
    page: number,
    limit: number,
  ): Promise<UserDeploymentsResponse> {
    const skip = (page - 1) * limit;

    const [deployments, total] = await Promise.all([
      this.prisma.deployment.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          contractName: true,
          contractSource: true,
          address: true,
          txHash: true,
          status: true,
          createdAt: true,
        },
      }),
      this.prisma.deployment.count({ where: { userId } }),
    ]);

    this.logger.log(
      `getDeployments: userId=${userId}, page=${page}, limit=${limit}, returned=${deployments.length}, total=${total}`,
    );

    return { deployments, total, page, limit };
  }

  /**
   * Get aggregate deployment statistics for a user.
   */
  async getStats(userId: string): Promise<UserStatsResponse> {
    const [totalDeployments, successfulDeployments, vibeScoreAgg] =
      await Promise.all([
        this.prisma.deployment.count({ where: { userId } }),
        this.prisma.deployment.count({
          where: { userId, status: 'deployed' },
        }),
        this.prisma.vibeScore.aggregate({
          where: { userId },
          _avg: { score: true },
        }),
      ]);

    const averageVibeScore = vibeScoreAgg._avg.score ?? null;

    this.logger.log(
      `getStats: userId=${userId}, total=${totalDeployments}, success=${successfulDeployments}, avgVibe=${averageVibeScore}`,
    );

    return { totalDeployments, successfulDeployments, averageVibeScore };
  }
}
