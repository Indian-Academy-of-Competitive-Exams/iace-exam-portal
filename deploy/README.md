# Deploying

Three boxes and an RDS instance — **EC2 and Docker Compose, settled, with no Fargate behind it**
(`docs/04-infrastructure.md` §3). That file is the why, the sizing and the money; this is the how.

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
- **Security groups, and no inbound SSH at all.** Box A: 80 and 443 from the world, and nothing
  else. Box B: 6379 and 6380 **from Box A's security group**, by group rather than CIDR, so a
  replacement box inherits the rule. RDS: 5432 from the same group.
- **Shell in with SSM Session Manager, not a key pair.** Add `AmazonSSMManagedInstanceCore` to the
  instance profile and `aws ssm start-session --target i-…` opens a shell with no inbound rule, no
  key to lose and a transcript. A port-22 rule pinned to "my address" holds only until that address
  rotates, and what happens then at 11pm is that the rule gets widened, not fixed.
- **Require IMDSv2 at launch** —
  `--metadata-options HttpTokens=required,HttpPutResponseHopLimit=2`. Without it one SSRF in the
  API reaches `169.254.169.254` and leaves with the instance role; with it the attacker needs a PUT
  first, which an SSRF usually cannot make. The hop limit is 2 because the caller is in a
  container, one hop further out than the host.
- **The API box needs 4 GB to build.** `pnpm install` plus the Prisma client wants it. Launch
  `t4g.medium`, and drop to `small` later once images come from ECR.

## The environment file

One file per environment, and it is the only place a credential lives on the box.

```bash
cp deploy/.env.example deploy/.env     # fill it in; openssl rand -base64 48 for each secret
sudo chown root:root deploy/.env && sudo chmod 600 deploy/.env
```

**Push it to SSM the moment it is right, and again every time it changes** — from a machine with
admin credentials, **not from the box**. The instance profile carries `ssm:GetParameter` and
deliberately not `ssm:PutParameter`: a box pulls its secrets and must not be able to overwrite
them, or an attacker on it could poison what every replacement pulls afterwards. That copy is the
difference between a three-minute recovery and rebuilding secrets by hand at the worst possible
moment:

```bash
aws ssm put-parameter --name /examprep/staging/env --type SecureString --tier Advanced --overwrite --value file://deploy/.env
```

An IAM user under the MFA guard needs an MFA session for that push (`aws sts get-session-token
--serial-number … --token-code …`, exported into the shell). Plain access keys pass the guard on a
direct call, but SSM encrypts the value by calling KMS on your behalf, and that call arrives marked
as made without MFA, so it is refused as `kms:GenerateDataKey … explicit deny`.

On a new box, one command brings the environment with it:

```bash
aws ssm get-parameter --name /examprep/staging/env --with-decryption --query Parameter.Value --output text > deploy/.env
```

A Standard-tier parameter caps at **4 KB**, and a filled-in file is past that even with its
comments stripped, so it is pushed to the Advanced tier ($0.05 a month), which caps at **8 KB**.
`pnpm env:check` compares the file's keys with `deploy/.env.example` before you push it. Nothing reads SSM at runtime — the API validates `process.env` and
nothing else, so the box boots whether or not AWS answers.

**No S3 key pair on a real box.** Leave `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` unset and
attach an instance profile carrying the media bucket, `ssm:GetParameter` on `/examprep/<env>/*` with
`kms:Decrypt`, CloudWatch Logs write, and ECR read. `docs/04-infrastructure.md` §11 is the why.

## Box B — Valkey

```bash
cp deploy/valkey/.env.example deploy/valkey/.env   # both passwords, then chown root + chmod 600
docker compose -f deploy/valkey/compose.yml up -d valkey-staging
```

Compose reads `deploy/valkey/.env` from beside the compose file with no flag, so a password never
reaches shell history. Both services are defined; bring up only the one you need.

**Three locks, and the third is the one that survives a mistake.** The security group; `PRIVATE_IP`
publishing the port on the VPC address rather than every interface; and `requirepass`. Each
environment's password goes into that environment's `REDIS_URL` on Box A as
`redis://:PASSWORD@10.0.1.20:6380`. Push this file to SSM as well, at `/examprep/valkey/env`.

## Box A — the API

```bash
docker compose -f deploy/compose.yml --env-file deploy/.env up -d --build
```

Migrations run as their own container and exit before the API starts; `docker compose ps` should
show `migrate` exited and everything else healthy.

**Seeding.** Migrations create the schema and no rows. Follow `docs/local-setup.md` §6 against RDS
— the first super admin is a SQL insert by design, and **without it nobody can sign in**.

## Telemetry — the alloy container

One container carries both signals off the box: every container's stdout into Loki, and the API's
`/metrics` into Prometheus. It comes up with everything else; the `LOKI_*` and `PROM_*` values in
`deploy/.env` are all it needs. Confirm it is shipping before you need it to be:

```bash
docker compose -f deploy/compose.yml --env-file deploy/.env logs --tail 30 alloy
```

Then in Grafana, `{env="staging"}` should return lines within a few seconds. The log labels are
`service_name` (the compose service: `exam`, `core`, `worker`, `caddy`, `migrate`), `level`, and
`env`. Everything per-request stays in the line and comes out at query time:

```
{service_name="exam", level="error"} |= "bug=" | pattern "<_>bug=<bug> <_>"
```

**Metrics are discovered, not listed.** Alloy keeps the `exam`, `core` and `worker` containers off
the same Docker API, scrapes `:3000/metrics` on each every 15s with `METRICS_TOKEN`, and labels the
series `role` and `instance`. `up{role="exam"}` is the one to check first — it is `1` per container,
so `up == 0` is a container the scrape cannot reach and `count(up)` is how many replicas are
running. `--scale exam=4` needs no edit anywhere, the same way Caddy's `dynamic a` upstreams do not.

`PROM_USERNAME` is **not** `LOKI_USERNAME` — Grafana Cloud numbers each signal separately, and
pasting one into the other fails with a 401 that reads like a bad token.

**Alloy is root on this box.** It reads the Docker API to learn which containers exist and what
compose calls them, and `:ro` on a socket mount protects the file rather than the API behind it —
anything that can reach that socket can start a privileged container. That is the price of
`service_name` being a name instead of a 64-character id. The alternative is mounting
`/var/lib/docker/containers:ro` and tailing the files directly, which needs no socket and gives
you those ids.

**The `json-file` caps stay.** Alloy going down must cost visibility and never the disk, so each
container still keeps its own 10 MB × 3 locally and `docker logs` still works.

**Caddy's access log is stdout**, not a file in a volume — one stream, one shipper, one cap.
Before Alloy existed it was a file precisely because nothing would have carried it off the box.

## The SPAs

```bash
./deploy/publish-spas.sh https://api.staging.examprep.iace.co.in examprep-staging-spas E1234 E5678
```

Assets first, shell second, three invalidation paths. Read the script before the first run; it
explains why each of those matters.

## Keeping the disk inside 20 GB

```bash
sudo ./deploy/prune-disk.sh
```

**Keeps the newest two builds of each app image and drops the rest**, plus stopped containers,
build cache and dead networks. Counting builds rather than days because early on a release goes
out several times an afternoon — two is the last one and the one before it, a rollback that needs
no network. `KEEP=4 sudo ./deploy/prune-disk.sh` to hold more.

**Every deploy runs it as its last step**, so the disk never drifts. The cron below is the backstop
for build cache and stopped containers that accumulate between releases:

```
0 3 * * 0 /opt/examprep/deploy/prune-disk.sh >> /var/log/prune-disk.log 2>&1
```

**Why a count and not an age.** Seven days of retention bounds nothing: at three releases an
afternoon that is twenty-one image pairs, and at ~1.3 GB each the 20 GB is gone in three or four
days — and what breaks is not the prune but the next release, possibly at the `migrate` step with
the API already stopped. Two is bounded by construction. Nothing is lost by it either: **the
images on the box are a cache, the archive is ECR**, whose lifecycle policy keeps the last ten. A
rollback past the local two is `API_TAG=<sha>` and a pull.

**Never add `--volumes` to a prune.** They hold Caddy's issued certificates and Box B's
append-only file. Let's Encrypt rate-limits five certificates per hostname per week, so one
careless `docker system prune --volumes` can lock you out of your own domain for seven days.

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

## Two Docker plugins Amazon Linux does not ship

`dnf install docker` gives you neither Compose v2 nor buildx, and the box needs both: Compose to
read `compose.yml`, and buildx because `apps/api/Dockerfile` uses `RUN --mount=type=cache`, which
is BuildKit-only — so `DOCKER_BUILDKIT=0` fails on the Dockerfile rather than working around it.

```bash
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -sSL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-aarch64 -o /usr/local/lib/docker/cli-plugins/docker-compose
V=$(curl -s https://api.github.com/repos/docker/buildx/releases/latest | grep -o '"tag_name": *"[^"]*"' | cut -d'"' -f4)
sudo curl -sSL "https://github.com/docker/buildx/releases/download/$V/buildx-$V.linux-arm64" -o /usr/local/lib/docker/cli-plugins/docker-buildx
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-*
docker compose version && docker buildx version
```

`aarch64`/`arm64` — these are Graviton boxes, and the x86 binary downloads fine then fails with
"cannot execute binary file". Box B runs no build, so it needs Compose alone.

## Before the first release: one extension

`prisma migrate deploy` creates `pg_trgm`, and on RDS that needs `rds_superuser`, which the
application role does not have. Create it once as the master user, before the stack ever comes up:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

Afterwards the migration's `IF NOT EXISTS` is a no-op. Without it, `migrate` fails on a permission
error and the API containers never start, because they wait on it exiting zero.

## When it does not come up

- `docker compose ... logs api` — the API refuses to boot on an unsized pool, an empty CORS list, a
  published `dev_only_` secret or a Valkey that can evict, and each refusal names the variable. It
  also **warns** if a container's heap is wrong for its memory limit, naming the role.
- `docker compose ... logs caddy` — a certificate that will not issue is almost always DNS that has
  not propagated, or port 80 closed.
- `git` run over SSM says **"detected dubious ownership"** and prints nothing useful. SSM runs
  commands as root and the checkout belongs to `ssm-user`, so git refuses — to stderr, which makes
  it look like an empty repository rather than a refusal. Use
  `sudo -u ssm-user git -C /opt/examprep …`, and read stderr before believing a blank answer.
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
