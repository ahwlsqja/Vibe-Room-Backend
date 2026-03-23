import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-github2';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  private readonly logger = new Logger(GithubStrategy.name);

  constructor(
    configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      clientID: configService.get<string>('github.clientId') || 'placeholder-client-id',
      clientSecret: configService.get<string>('github.clientSecret') || 'placeholder-client-secret',
      callbackURL: configService.get<string>('CALLBACK_URL') || 'https://vibe-room-backend-production.up.railway.app/api/auth/github/callback',
      scope: ['user:email'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
  ) {
    this.logger.log(`GitHub OAuth callback for user: ${profile.username}`);
    const user = await this.authService.validateOrCreateUser(profile);
    // accessToken intentionally discarded — not stored or logged
    return user;
  }
}
