import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * OptionalJwtAuthGuard — like JwtAuthGuard but never throws.
 *
 * If a valid JWT is present, req.user is populated with the authenticated User.
 * If no token or an invalid token is supplied, req.user is null and the request
 * proceeds unauthenticated. This preserves backward-compat for anonymous deploys
 * while enabling userId tracking when the caller is logged in.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(_err: any, user: any) {
    return user || null;
  }
}
