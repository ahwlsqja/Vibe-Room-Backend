import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
  Logger,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserService } from './user.service';

@Controller('user')
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(private readonly userService: UserService) {}

  /**
   * GET /api/user/deployments?page=1&limit=20
   *
   * Returns paginated deployment history for the authenticated user.
   * Requires valid JWT — returns 401 without token.
   */
  @Get('deployments')
  @UseGuards(JwtAuthGuard)
  async getDeployments(
    @Req() req: any,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    const userId = req.user.id;
    this.logger.log(
      `getDeployments: userId=${userId}, page=${page}, limit=${limit}`,
    );
    const result = await this.userService.getDeployments(userId, page, limit);
    return result;
  }

  /**
   * GET /api/user/stats
   *
   * Returns aggregate deployment statistics for the authenticated user.
   * Requires valid JWT — returns 401 without token.
   */
  @Get('stats')
  @UseGuards(JwtAuthGuard)
  async getStats(@Req() req: any) {
    const userId = req.user.id;
    this.logger.log(`getStats: userId=${userId}`);
    const result = await this.userService.getStats(userId);
    return result;
  }
}
