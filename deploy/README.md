# Deploying

Three boxes and an RDS instance. `docs/04-infrastructure.md` is the why, the sizing and the money;
this is the how.

```
Box A / A′   Caddy + exam + core + worker     deploy/compose.yml
Box B        Valkey, a process per environment deploy/valkey/compose.yml
RDS          Postgres 17, a database each      —
S3 + CloudFront  the two SPAs                  deploy/publish-spas.sh
```

## Before anything

- **One A record per environment**, pointing at that API box's Elastic IP. Caddy asks Let's
  Encrypt over the HTTP challenge, so the name must resolve and 80 and 443 must be open before you
  start. The SPAs need none — CloudFront brings its own certificate.
- **Security groups.** Box A: 80 and 443 from the world, 22 from one address. Box B: 6379 and 6380
  **from Box A's security group**, by group rather than CIDR, so a replacement box inherits the
  rule. RDS: 5432 from the same group.
- **The API box needs 4 GB to build.** `pnpm install` plus the Prisma client wants it. Launch
  `t4g.medium`, and drop to `small` later once images come from ECR.

## Box B — Valkey

```bash
PRIVATE_IP=10.0.1.20 docker compose -f deploy/valkey/compose.yml up -d valkey-staging
```

Both services are defined; bring up only the one you need. `PRIVATE_IP` binds the port to the VPC
address rather than every interface — the security group is the real lock, this is the second one.

## Box A — the API

```bash
cp deploy/.env.example deploy/.env      # fill it in; openssl rand -base64 48 for each secret
docker compose -f deploy/compose.yml --env-file deploy/.env up -d --build
```

Migrations run as their own container and exit before the API starts; `docker compose ps` should
show `migrate` exited and everything else healthy.

**Seeding.** Migrations create the schema and no rows. Follow `docs/local-setup.md` §6 against RDS
— the first super admin is a SQL insert by design, and **without it nobody can sign in**.

## The SPAs

```bash
./deploy/publish-spas.sh https://api.staging.iace.co.in iace-staging-spas E1234 E5678
```

Assets first, shell second, three invalidation paths. Read the script before the first run; it
explains why each of those matters.

## Redeploying

```bash
git pull && docker compose -f deploy/compose.yml --env-file deploy/.env up -d --build
```

**There is no draining** — `up -d` recreates with a gap, which is the cost of not having a load
balancer. To avoid it, scale a role to two and recreate them one at a time: Caddy's upstreams are
`dynamic a`, so it picks up and drops containers as they come and go.

```bash
docker compose -f deploy/compose.yml --env-file deploy/.env up -d --scale exam=2
```

## When it does not come up

- `docker compose ... logs api` — the API refuses to boot on an unsized pool, an empty CORS list, a
  published `dev_only_` secret or a Valkey that can evict, and each refusal names the variable. It
  also **warns** if a container's heap is wrong for its memory limit, naming the role.
- `docker compose ... logs caddy` — a certificate that will not issue is almost always DNS that has
  not propagated, or port 80 closed.
- Exit **143** is a clean shutdown. Exit **137** is SIGKILL: either the grace period expired or the
  OOM killer, and `docker inspect`'s `OOMKilled` flag tells them apart.

## Verified 26 September 2026

The whole stack was brought up against a local Postgres and Valkey standing in for RDS and Box B:
all three images build, migrations run and exit before the API starts, every container reports
healthy, and Caddy routes correctly — `/me/leaderboard` and `/me/attempts/*/paper` to exam,
`/auth/me` and `/admin/*` to core. `--scale exam=2` was picked up by `dynamic a` inside the
10-second refresh with no config change, and the worker stayed at one.

Not verified: real Let's Encrypt issuance, which needs a resolving name, and anything against RDS
or a real Box B.
