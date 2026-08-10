/**
 * Database seed.
 *
 * Phase 0 seeds exactly one thing: the bootstrap super admin. Admins cannot
 * self-register (email + OTP, no signup), so without this row there is no way
 * to sign in to the admin app at all.
 *
 * Everything else — Page rows, subjects, the SSC CGL Tier 1 base config — is
 * deliberately left out until the feature that owns it exists. Super admins
 * bypass page checks, so the seeded account can reach every screen already.
 *
 * Idempotent: safe to run as many times as you like.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = (process.env.SEED_SUPER_ADMIN_EMAIL ?? '').trim().toLowerCase();
  if (!email) {
    throw new Error('SEED_SUPER_ADMIN_EMAIL is not set — copy .env.example to .env first.');
  }

  const admin = await prisma.admin.upsert({
    where: { email },
    create: {
      email,
      fullName: process.env.SEED_SUPER_ADMIN_NAME ?? 'Super Admin',
      isSuperAdmin: true,
    },
    // Never downgrade an existing account on a re-run; just make sure the
    // bootstrap admin can still get in.
    update: { isSuperAdmin: true, isActive: true },
  });

  console.log(`Super admin ready: ${admin.email} (${admin.id})`);
  console.log('Sign in at the admin app with this email — the OTP prints in the API log.');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
