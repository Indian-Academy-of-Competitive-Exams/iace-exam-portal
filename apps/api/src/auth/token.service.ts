import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { accessTokenClaimsSchema, type AccessTokenClaims, type ActorType } from '@iace/contracts';
import { AppConfigService } from '../config/app-config.service';
import { durationToSeconds } from '../common/duration';

/** Refresh tokens carry only what's needed to find the Redis session. */
export interface RefreshTokenClaims {
  sub: string;
  actor: ActorType;
  sid: string;
}

/**
 * Access and refresh tokens are signed with SEPARATE secrets, so a leaked
 * access secret cannot be used to mint long-lived refresh tokens.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  get accessTtlSec(): number {
    return durationToSeconds(this.config.get('JWT_ACCESS_TTL'));
  }

  get refreshTtlSec(): number {
    return durationToSeconds(this.config.get('JWT_REFRESH_TTL'));
  }

  signAccess(claims: AccessTokenClaims): Promise<string> {
    return this.jwt.signAsync(claims, {
      secret: this.config.get('JWT_ACCESS_SECRET'),
      // Seconds, not the raw "15m" string: jsonwebtoken's typed `expiresIn`
      // only accepts its own literal union, and this is the same value the
      // Redis session TTL uses.
      expiresIn: this.accessTtlSec,
    });
  }

  signRefresh(claims: RefreshTokenClaims): Promise<string> {
    return this.jwt.signAsync(claims, {
      secret: this.config.get('JWT_REFRESH_SECRET'),
      expiresIn: this.refreshTtlSec,
    });
  }

  async verifyAccess(token: string): Promise<AccessTokenClaims> {
    const payload = await this.verify(token, this.config.get('JWT_ACCESS_SECRET'));
    const parsed = accessTokenClaimsSchema.safeParse(payload);
    if (!parsed.success) throw new UnauthorizedException('Malformed token');
    return parsed.data;
  }

  async verifyRefresh(token: string): Promise<RefreshTokenClaims> {
    const payload = await this.verify(token, this.config.get('JWT_REFRESH_SECRET'));
    const parsed = accessTokenClaimsSchema
      .pick({ sub: true, actor: true, sid: true })
      .safeParse(payload);
    if (!parsed.success) throw new UnauthorizedException('Malformed refresh token');
    return parsed.data;
  }

  private async verify(token: string, secret: string): Promise<unknown> {
    try {
      return await this.jwt.verifyAsync(token, { secret });
    } catch {
      // Expired and tampered are the same answer to the client, on purpose.
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
