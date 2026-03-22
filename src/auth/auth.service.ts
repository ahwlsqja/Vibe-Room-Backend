import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from './jwt.strategy';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Upsert a User record from a GitHub OAuth profile.
   * Creates if new, updates username/email/avatar if existing.
   */
  async validateOrCreateUser(githubProfile: any) {
    const githubId = String(githubProfile.id);
    const username = githubProfile.username || githubProfile.displayName || 'unknown';
    const email = githubProfile.emails?.[0]?.value ?? null;
    const avatarUrl = githubProfile.photos?.[0]?.value ?? null;

    const user = await this.prisma.user.upsert({
      where: { githubId },
      update: { username, email, avatarUrl },
      create: { githubId, username, email, avatarUrl, deployCount: 0 },
    });

    this.logger.log(`User upsert: githubId=${githubId}, username=${username}, userId=${user.id}`);
    return user;
  }

  /**
   * Sign a JWT for an authenticated user.
   */
  login(user: { id: string; githubId: string; username: string }) {
    const payload: JwtPayload = {
      sub: user.id,
      githubId: user.githubId,
      username: user.username,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      user,
    };
  }
}
