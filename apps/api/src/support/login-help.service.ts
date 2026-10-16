import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ActorTypes,
  AppException,
  ErrorCodes,
  SUPPORT_CATEGORIES,
  normaliseMobile,
  type BranchOption,
  type LoginHelpBody,
} from '@iace/contracts';
import { toDateColumn } from '../common/time/institute-day';
import { PrismaService } from '../prisma/prisma.service';
import { redisKeys } from '../redis/redis.keys';
import { RedisService } from '../redis/redis.service';
import { sameName } from './claim';

const PER_MOBILE_PER_DAY = 3;
const PER_IP_PER_DAY = 10;
const DAY_SEC = 86_400;
const MATCH_CANDIDATES = 5;

/** A signed-out student's help request: linked to a student only on an exact match, answered the same either way. */
@Injectable()
export class LoginHelpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async submit(input: LoginHelpBody, ip: string): Promise<{ received: true }> {
    const mobile = normaliseMobile(input.registeredMobile);
    await this.count(redisKeys.loginHelpByIp(ip), PER_IP_PER_DAY);
    await this.count(redisKeys.loginHelpByMobile(mobile), PER_MOBILE_PER_DAY);
    const studentId = await this.match(input, mobile);
    await this.prisma.supportTicket.create({
      data: {
        studentId,
        category: SUPPORT_CATEGORIES.LOGIN_OR_ACCOUNT,
        claim: input as Prisma.InputJsonObject,
        contactEmail: input.contactEmail,
        messages: { create: { authorType: ActorTypes.STUDENT, body: input.body } },
      },
    });
    return { received: true };
  }

  branches(): Promise<BranchOption[]> {
    return this.prisma.branch.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  private async match(input: LoginHelpBody, mobile: string): Promise<string | null> {
    const candidates = await this.prisma.student.findMany({
      where: {
        deletedAt: null,
        profile: { dob: toDateColumn(input.dob) },
        OR: [{ mobile }, { mobileHistory: { some: { mobile } } }],
      },
      select: { id: true, fullName: true },
      take: MATCH_CANDIDATES,
    });
    const matched = candidates.filter((c) => sameName(c.fullName, input.fullName));
    return matched.length === 1 ? (matched[0]?.id ?? null) : null;
  }

  private async count(key: string, cap: number): Promise<void> {
    const used = await this.redis.client.incr(key);
    if ((await this.redis.client.ttl(key)) < 0) await this.redis.client.expire(key, DAY_SEC);
    if (used > cap) throw new AppException(ErrorCodes.RATE_LIMITED);
  }
}
