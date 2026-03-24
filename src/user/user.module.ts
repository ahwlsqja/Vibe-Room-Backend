import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';

/**
 * UserModule — provides the dashboard API endpoints:
 *   GET /api/user/deployments  — paginated deployment history
 *   GET /api/user/stats        — aggregate statistics
 *
 * PrismaModule is @Global so no explicit import needed.
 * JwtAuthGuard + JwtStrategy are exported from AuthModule and available globally
 * because PassportModule registers the jwt strategy at the module level.
 */
@Module({
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
