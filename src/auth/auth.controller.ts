import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { GithubAuthGuard } from './github-auth.guard';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Redirects to GitHub OAuth page.
   */
  @Get('github')
  @UseGuards(GithubAuthGuard)
  githubLogin() {
    // Guard handles redirect — this method body is never reached
  }

  /**
   * GitHub OAuth callback — receives authenticated user from Passport,
   * signs a JWT, and redirects to the frontend with the token as a query parameter.
   */
  @Get('github/callback')
  @UseGuards(GithubAuthGuard)
  async githubCallback(@Req() req: any, @Res() res: Response) {
    const { accessToken } = await this.authService.login(req.user);
    const frontendUrl =
      this.configService.get<string>('frontend.url') || 'http://localhost:3001';
    res.redirect(`${frontendUrl}?token=${accessToken}`);
  }

  /**
   * Returns the current authenticated user's profile.
   * Protected by JwtAuthGuard.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  getProfile(@Req() req: any) {
    const { id, githubId, username, avatarUrl, deployCount } = req.user;
    return { id, githubId, username, avatarUrl, deployCount };
  }
}
