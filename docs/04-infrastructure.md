# IACE platform — infrastructure

What runs this platform on AWS, what each piece costs, and why it is that size rather than a
larger one. `docs/01-architecture.md` §6 names the services; this file is the sizing, the money
and the runbook.

Every price is US dollars per month in **ap-south-1 (Mumbai)**, pulled from the AWS Price List API
on 22 September 2026, at 730 hours. Figures that came from a measurement say where it was taken.

---

## 1. What it costs

| Aspect            | What                                                         | Monthly   |
| ----------------- | ------------------------------------------------------------ | --------- |
| Compute           | ECS Fargate on ARM, three services                           | $47–51    |
| Ingress           | One Application Load Balancer                                | $27       |
| Frontend delivery | S3 + CloudFront, pay-as-you-go                               | ~$1       |
| Database          | RDS PostgreSQL 17, `db.t4g.small`, 20 GB gp3                 | $33       |
| Cache and queues  | Valkey on EC2 `t4g.small`, 20 GB gp3                         | $10       |
| Networking        | NAT instance `t4g.nano`, S3 gateway endpoint                 | $6.42     |
| Logs and alarms   | CloudWatch, ~10 alarms, ALB access logs                      | $1.70     |
| Media             | S3 storage and requests                                      | <$1       |
| Secrets, DNS, ECR | SSM Parameter Store, Route 53, container registry            | $1.80     |
| Non-production    | One staging environment sharing prod's ALB, VPC and database | $10       |
| **Total**         |                                                              | **~$142** |

A one-year no-upfront Compute Savings Plan and an RDS reservation take the always-on part from
$83.29 to $64.88, so **~$123**. Buy neither at launch (§13).

**What this table leaves out, and why it is still about right:**

- **GST is 18% on top.** ap-south-1 is billed through AWS India, so the invoice is ~$167, not $142.
  With the institute's GSTIN on the account it is input credit rather than cost — register it at
  signup, or the 18% is real money.
- **Internet egress from the load balancer is free at this scale.** Measured on 23 September 2026
  against the real services: a 100-question bilingual sitting pulls 41 KB for the paper, 3 KB
  for the score card and 56 KB for the solution report, gzipped — **100 KB a sitting**, so a
  6,000-candidate event is 0.6 GB and thirty events a month are ~18 GB, inside the free 100 GB.
  English alone is 46 KB a sitting; all three languages, 108 KB.
- **Snapshots** of the Valkey and NAT volumes are $0.05/GB-month, incremental — about $1 if taken
  daily and kept a week.
- **Route 53 queries** are $0.40 a million, and **Basic support is free**. Developer support is $29
  a month or 3% of spend, which this account does not need.
- **One-offs:** the pre-launch load rehearsal's temporary RDS instance (§12) and the migration off
  ThinkExam.

Outside AWS: Sentry (free tier), Grafana Cloud (free tier), the SMS aggregator and WhatsApp
per message, and the domain.

## 2. The shape

One VPC. Two availability zones exist only because an ALB requires two subnets; **every running
thing sits in one of them**, so inter-AZ traffic is zero and the failure domain matches the
single-AZ database and cache.

- **Public subnet:** the load balancer and the NAT instance. Nothing else has a public address.
- **Private subnet:** the three ECS services, RDS, the Valkey box.
- **Private to AWS:** an S3 gateway endpoint, so media and container image layers never cross NAT.

A student's browser resolves the domain at Route 53, loads the two SPAs and question images from
CloudFront, and sends every API call to the load balancer, which routes by path to the exam or the
core service. The worker takes no HTTP at all.

## 3. Compute — three services, one image

`API_ROLE` decides what a container registers (`apps/api/src/config/api-role.ts`). One image
serves all three; unset means all of them, which is what local development runs.

| Service    | Size            | Count                            | Serves                                                                |
| ---------- | --------------- | -------------------------------- | --------------------------------------------------------------------- |
| **exam**   | 1 vCPU / 2 GB   | min 1, max 2; event window below | `AttemptsController`, `MeLeaderboardController`                       |
| **core**   | 0.5 vCPU / 1 GB | min 1, max 3                     | auth, `me`, saved, results, every `admin/*` route, imports            |
| **worker** | 0.5 vCPU / 1 GB | first on-demand, extras on Spot  | no routes but health and metrics; all eight processors and schedulers |

ARM (Graviton) at $0.02383 per vCPU-hour and $0.00261 per GB-hour — about half the x86 rate.

**Why the exam service is 1 vCPU.** Measured over real HTTP: at 0.5 vCPU the autosave path peaked
at 545 requests a second with a p99 of ~400 ms, because CFS throttling kicks in; at 1 vCPU it
reached 2,076 a second with a p99 of 4–30 ms.

**Why the worker is 0.5 vCPU, and what a hall costs it.** Measured on 23 September 2026, draining
real sittings through `ScoringProcessor` against the real database: 5,000 sittings of 100 questions
reach `EVALUATED` in 4.0 seconds, 1,240 a second, p95 7.7 ms. Per sitting that is **0.9 ms of Postgres CPU and 2.7 ms of
Node CPU**, four transactions, two inserts and two updates. The scoring work is the WORKER's, not
the database's — 4.5 CPU-seconds against 13.

Sweeping the processor's concurrency on that hardware: 1 → 289 a second, 2 → 568, 4 → 861,
8 → 1,240, 16 → 1,346, 32 → 1,200. Sixteen is the knee and thirty-two is past it, so the eight in
`QUEUE_POLICY` sits at about 92% of the ceiling with a third of the queueing.

Those are a 10-core M4 with Postgres in Docker beside it. A Graviton core is roughly two to three
times slower, so read the hall as ~26–40 CPU-seconds of worker and ~9–14 of database: **one
0.5-vCPU worker drains 5,000 submits in a minute or so, two halve it, and `db.t4g.small`'s 2 vCPU
are never the constraint.** Not measured: BullMQ's own per-job Redis round trips, the submit
request itself, and the rollup fold that runs after.

**Scaling.** Target-tracking on CPU for exam and core, queue depth for the worker. Autoscaling
overrides a manually set desired count, so a pre-warm raises the **minimum**, never the count.

**Event windows.** Only tests in an EVENT series are pre-warmed: from 20 minutes before `opensAt`
until scoring finishes plus ~30 minutes of results viewing, the exam minimum goes to
`ceil(candidates / 2,500)` and the maximum to that plus two.

## 4. Ingress

One ALB: $0.0239 an hour plus $0.008 per LCU-hour, two public IPv4 addresses at $3.65 each,
about **$27** all in. Health checks every 10 seconds, deregistration delay 30 seconds — which is
also why the API needs no SIGTERM grace of its own.

The API answers on its own subdomain, straight to the load balancer. It is deliberately **not**
behind CloudFront: autosaves alone are 15–30M requests a month during events, which would add
$10–30 in request fees and buy nothing, since the preflight is already cached for two hours.

**Anything in front of the API must pass `x-client` and `x-device-name` through** (`docs/01` §6).

## 5. Frontend delivery

The two SPAs live in one private S3 bucket behind two CloudFront distributions, on
pay-as-you-go: the always-free tier is 1 TB of transfer, 10M requests and 2M function invocations
a month, which this platform stays inside. The flat-rate plans are refused deliberately — the Free
plan allows 1M requests per distribution, and the student app passes that in a busy month.

Rules that make it work:

- `/assets/*` is content-hashed: cache for a year, `immutable`.
- `index.html`, `sw.js` and the manifest: `no-cache`.
- **Old asset files are never deleted.** A tab opened before a deploy still asks for the previous
  chunk names; keeping them costs about a cent a year.
- Page routes reach `index.html` through a CloudFront Function, not the 404-to-index rule, so a
  genuinely missing file is still a 404 rather than HTML pretending to be JavaScript.
- Compression and HTTP/3 are CloudFront's; the build ships neither.

Measured: the student app's first load is 817 KB raw, **238 KB brotli**, after the exam hall,
solutions and saved questions moved behind `React.lazy` (`3fca444`).

## 6. Database

**RDS PostgreSQL 17, `db.t4g.small`, single-AZ, 20 GB gp3 autoscaling to 100 GB, 7-day
point-in-time restore.** $30.66 for the instance, $2.62 for the storage.

Postgres 17 rather than 16 because RDS Extended Support costs $0.114 per vCPU-hour once a version
leaves standard support — more than this instance. 16 leaves on 28 February 2029, 17 on
28 February 2030.

**Connections decide the size, not load.** At `connection_limit=25` a container is generous; the
budget is exam 8 × 5, core 25 × 3, worker 25 × 3 = 190 of the ~225 a 2 GB instance allows, plus 10
for staging and 3 reserved. It is written in `.env.example` beside the pool guidance.

Measured on the current schema, per 100-question sitting:

|              |                                                                     |
| ------------ | ------------------------------------------------------------------- |
| Disk         | 3.75 KB (sheet 2.05, attempt 0.76, rollups 0.33, notification 0.61) |
| WAL          | 14 KB                                                               |
| Database CPU | ~3.6 ms — 0.13 start, 0.35 per flush, 0.41 submit, 0.9 scoring (§3) |

A 6,000-candidate event is about 22 seconds of database CPU. At 250K sittings a month that is
~11 GB a year, so storage is not a cost driver and reads — standings, catalog, results — are the
only real load.

## 7. Cache and queues

**Valkey on one EC2 `t4g.small`**, append-only file flushed every second, `maxmemory` 1.2 GB,
`maxmemory-policy noeviction`. $8.18 for the instance, $1.82 for 20 GB gp3.

`noeviction` is not a preference: BullMQ requires it, and this server holds live sittings, so an
eviction policy would silently drop a candidate's answers. The API refuses to boot in production
against anything else.

- **ElastiCache Serverless cannot be used at all** — it has no parameter groups, so the policy
  cannot be set, and BullMQ's own documentation rules it out.
- A node-based `cache.t4g.small` is $23.94 and comes back **empty** after a node failure; no
  current ElastiCache engine writes to disk.

Measured: a 100-question sitting holds 10.2 KB of JSON, 12.1 KB in Redis. A save moves about three
times the state (read, then compare-and-set with both values), so an event runs at 48–90 Mbps and
~43 GB. Peak memory is 0.5–0.8 GB, dominated by the 15-minute catalog cache at ~23 KB per 100
visible tests per student. **Same-zone placement, not a code change, is what keeps that traffic
free.**

## 8. Networking

A **NAT instance** (`t4g.nano`, $2.04 + $0.73 disk + $3.65 for its address) rather than a NAT
gateway ($40.88 + $3.65 + $0.056/GB). Outbound is only SMS, WhatsApp, push, Sentry, log shipping
and ECR authentication; image layers come through the free S3 gateway endpoint.

If the NAT instance dies, exams keep running — inbound is the ALB, autosaves are Valkey, scoring is
Postgres. What stops is **OTP SMS, so new sign-ins**, plus push and Sentry. EC2 automatic recovery
restarts it; the escape hatch is a NAT gateway and one route-table change.

Inter-AZ traffic is $0.01/GB each way and is zero here by placement. Internet egress is $0.1093/GB
after the 100 GB monthly free tier.

## 9. Logs, metrics and alarms

The API has 35 log statements and **none on the request path**, so CloudWatch ingest stays inside
the free 5 GB. Container logs are kept 14 days; ALB access logs go to S3 with a 30-day lifecycle.

About ten alarms at $0.10 each: ALB 5xx and unhealthy targets, ECS running count per service, RDS
CPU, storage and connections, EC2 status checks for the Valkey and NAT boxes, plus one custom
metric ($0.30) for Valkey memory.

**Two AWS Budgets, which are free** — one at the §1 total and one cost-anomaly detector. On a first
AWS account the thing that actually costs money is a mistake nobody notices for three weeks: a NAT
gateway left behind, an autoscaling minimum never lowered after an event, a load rehearsal instance
still running. An alarm on the bill catches all three and none of the alarms above would.

`/metrics` already publishes what an event needs watching — latency and error rate, submits, queue
depth and oldest wait, job failures, Redis memory and evictions, live sittings not yet in Postgres,
database connections. **Grafana Cloud's free tier** scrapes it through an agent beside Valkey;
Amazon Managed Prometheus and Grafana would be $14–19 for the same picture.

Off deliberately: Container Insights (priced per metric, duplicates free ECS metrics) and VPC flow
logs (one zone, nothing to see).

## 10. Media

One private bucket, reached by CloudFront with **signed URLs** — not presigned S3 URLs. The
difference is not privacy but caching: a per-student signed S3 URL means 6,000 students download
the same diagram 6,000 times from S3, at $0.1093/GB, which is $28–48 a month at event scale.
Through CloudFront the edge caches it once and the transfer is inside the free tier.

Admin imports and student documents keep S3 presigned URLs; their volume is trivial.

Diagrams are re-encoded to WebP in the admin's browser before upload (`75868e0`): measured
2,045 KB → 229 KB at 1600 px, with files under 200 KB and GIFs left alone.

Lifecycle: imports expire at 90 days, audit archives move to Glacier at 90, incomplete uploads
abort at 7.

## 11. Secrets, DNS and the registry

- **SSM Parameter Store, standard SecureString** for every secret — free, versioned, read by ECS at
  task start. Secrets Manager would be $0.40 each for rotation nothing here uses. The KMS key is the
  AWS-managed one; a customer-managed key is $1 for no gain.
- **No S3 keys exist in production.** The task role signs, and `S3_ACCESS_KEY_ID` /
  `S3_SECRET_ACCESS_KEY` are optional (`847db3e`); MinIO still needs the pair locally.
- **Route 53**, $0.50 a month, with ALIAS records to CloudFront and the ALB, which are free.
  ACM certificates are free: one in Mumbai for the ALB, one in us-east-1 for CloudFront.
- **ECR** at $0.10/GB-month with a lifecycle keeping the last ten images, under $0.20.
- GitHub Actions pushes through an OIDC role, so no AWS keys live in GitHub either.

## 12. Non-production

One staging environment, same shape as production, ~$10 a month:

- Three ECS services on **Fargate Spot**, 0.5 vCPU / 1 GB each.
- A **host rule on the production load balancer**, not a second one.
- Its own database **on the production RDS instance**, with `CONNECTION LIMIT 10` on the role,
  `statement_timeout` 30 s and `idle_in_transaction_session_timeout` 60 s, so a staging runaway
  cannot take production's connections or hold its CPU.
- A second Valkey **process** on the production box, its own port and its own `maxmemory`.
- Its own bucket, its own SSM parameters, the shared NAT and registry.

**Seeded and generated data only — never a restore of production.** Real students' names, mobile
numbers and marks do not belong in a lower-security environment.

The pre-launch load rehearsal (4–5K candidates) runs against a temporary instance restored from a
snapshot, not the shared one.

## 13. Commitments

Nothing at launch. After 4–8 weeks of real events the baseline is known; commit to 70–80% of it so
growth and bursts stay on demand.

|                                  | On demand | 1-year, no upfront |
| -------------------------------- | --------- | ------------------ |
| Fargate baseline (2 vCPU + 4 GB) | $42.41    | $33.42             |
| Valkey `t4g.small`               | $8.18     | $5.91              |
| NAT `t4g.nano`                   | $2.04     | $1.46              |
| RDS `db.t4g.small`               | $30.66    | $24.09             |

Compute Savings Plans cover EC2, Fargate and Lambda in any region and family, so resizing stays
covered; an RDS reservation is tied to its instance family. Savings Plans do **not** apply to Spot,
so staging and the worker's extra tasks are already as cheap as they get.

## 14. How a release goes out

1. Build both targets from `apps/api/Dockerfile`: `runtime` (600 MB, 108 MB pulled) and `migrate`
   (731 MB, 163 MB pulled). The Prisma CLI is only in the migration image.
2. Push to ECR through the OIDC role.
3. Run the **migrate** image as a one-off task. It runs `prisma migrate deploy` and exits.
4. Update the three services to the new `runtime` image. Each container is `tini`-led, so SIGTERM
   closes Nest and the container exits (`b2029d4`); the ALB's 30-second deregistration drains it.
5. Old `/assets` files stay in the bucket. Invalidate only `index.html`, `sw.js` and the manifest.

Never during an event window, and never a migration that moves data without the rehearsal
`docs/superpowers/task-constraints.md` prescribes.

## 15. Deferred

- **The service worker never prunes its cache** (`iace-shell-v1` is a fixed name), so a student's
  device keeps up to ~1.5 MB per deploy they load. The fix is stamping the build id into `sw.js`.
- **Redis as a hash per sitting** instead of one JSON document — measured 7.2 KB against 20.5 KB
  under the old shape, and roughly 10× less traffic. Revisit above ~100 Mbps sustained.
- **Archiving old answer sheets** and pruning read notifications, when the database passes ~200 GB.
- **A Compose profile running the three roles behind a reverse proxy** — the local prod shape.
