import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Request } from 'express';
import { AppException, ErrorCodes } from '@iace/contracts';
import { TokenService } from '../token.service';
import { SessionService } from '../session.service';
import { IS_PUBLIC_KEY, type AuthenticatedUser } from '../../common/security';

/** Applied globally (see AppModule's APP_GUARD); routes opt out with @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) throw new AppException(ErrorCodes.UNAUTHENTICATED, 'Missing access token');

    const claims = await this.tokens.verifyAccess(token);

    if (!(await this.sessions.exists(claims.actor, claims.sub, claims.sid))) {
      throw new AppException(ErrorCodes.UNAUTHENTICATED, 'Session has ended — sign in again');
    }

    request.user = {
      id: claims.sub,
      actor: claims.actor,
      sessionId: claims.sid,
      isSuperAdmin: claims.isSuperAdmin ?? false,
      // Absent on a student token and on any admin token minted before this
      // claim existed; both mean active.
      isActive: claims.isActive ?? true,
      permissions: claims.permissions ?? {},
    };
    return true;
  }
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : null;
}
