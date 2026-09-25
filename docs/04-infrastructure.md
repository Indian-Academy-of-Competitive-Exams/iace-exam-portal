# IACE platform — infrastructure

What runs this platform on AWS, what each piece costs, and why it is that size rather than a
larger one. `docs/01-architecture.md` §6 names the services; this file is the sizing, the money
and the runbook.

Every price is US dollars per month in **ap-south-1 (Mumbai)**, pulled from the AWS Price List API
on 22 September 2026, at 730 hours, and **not re-pulled since** — check the Pricing Calculator
before committing money. Figures that came from a measurement say where it was taken.

**The front door changed on 25 September 2026.** This file described an Application Load Balancer
in front of ECS Fargate. It now describes **Caddy on EC2**, because an ALB is what makes Fargate
practical — tasks register themselves in a target group as they scale — and without one the pair
stops making sense. Whether production goes back to Fargate is **open**, and §3 says what decides
it.

---

## 1. What it costs

**Production**

| Aspect            | What                                                 | Monthly    |
| ----------------- | ---------------------------------------------------- | ---------- |
| Compute           | EC2 `t4g.large`: Caddy, three API containers, Valkey | $32.70     |
| Storage           | EBS gp3 50 GB, plus snapshots                        | $7.06      |
| Address           | One Elastic IP                                       | $3.65      |
| Database          | RDS PostgreSQL 17, `db.t4g.small`, 20 GB gp3         | $33.28     |
| Frontend delivery | S3 + two CloudFront distributions                    | ~$1        |
| Media             | S3 storage and requests                              | ~$1        |
| Logs and alarms   | CloudWatch, ~10 alarms, two Budgets                  | $1.70      |
| Secrets, DNS, ECR | SSM Parameter Store, Route 53, container registry    | $1.20      |
| **Total**         |                                                      | **$81.59** |

**Staging** — its own box, §12.

| Aspect    | What                                                            | Monthly    |
| --------- | --------------------------------------------------------------- | ---------- |
| Compute   | EC2 `t4g.medium`: Caddy, three API containers, Valkey, Postgres | $16.35     |
| Storage   | EBS gp3 30 GB                                                   | $2.74      |
| Address   | One Elastic IP                                                  | $3.65      |
| SPAs      | S3 + two CloudFront distributions                               | $0.50      |
| **Total** |                                                                 | **$23.24** |

**Together $104.83, and the invoice is ~$124** — ap-south-1 bills through AWS India at 18% GST on
top. It is input credit against the institute's GSTIN, but only if the GSTIN is on the account, so
that is a signup step rather than a footnote.

For comparison, the ALB + Fargate shape this file used to describe came to ~$142 for production
alone. The saving is the load balancer, the Fargate premium and the NAT instance; what it costs is
a box you own and a single point of failure (§3).

**Two AWS Budgets, and they are free.** One at the total above, one anomaly detector. Every alarm
in §9 watches something that is running; none watches something that should have stopped, and on a
first AWS account a rehearsal instance left up for three weeks costs more than the mistakes the
alarms catch.

**Internet egress is inside the free tier.** Measured 25 September 2026: a 100-question bilingual
sitting pulls 41 KB of paper, 3 KB of score card and 56 KB of solution report gzipped — 100 KB, so
a 6,000-candidate event is 0.6 GB and thirty events a month are ~18 GB against the free 100 GB.
That margin is what `compression()` in `main.ts` buys; without it the same traffic is ~125 GB and
billable.

A one-year no-upfront commitment takes the always-on part from $66.44 to ~$52 (§13). Buy nothing
at launch.

Outside AWS: Sentry (free tier), Grafana Cloud (free tier), the SMS aggregator and WhatsApp
per message, and the domain.

## 2. The shape

One VPC. Two availability zones exist only because an **RDS subnet group requires two subnets in
two zones**; every running thing sits in one of them, so inter-AZ traffic is zero and the failure
domain matches the single-AZ database.

- **Public subnet:** the application box, with an Elastic IP. Its security group opens 80 and 443
  to the world and 22 to one address.
- **Private subnet:** RDS, reachable only from the box's security group.
- **No NAT.** The box is public, so nothing needs a gateway to reach SMS, push, Sentry or ECR —
  which removes the `t4g.nano` and its address the ALB shape needed.

A student's browser resolves the domain at Route 53, loads the two SPAs and question images from
CloudFront, and sends every API call to the box, where **Caddy** terminates TLS and routes by path
to the exam or the core container. The worker takes no HTTP at all.

## 3. Compute — three containers, one image

`API_ROLE` decides what a container registers (`apps/api/src/config/api-role.ts`). One image serves
all three; unset means all of them, which is what local development runs. They run under Docker
Compose on one EC2 box, with `cpus` and `mem_limit` per container — the same CFS quota ECS would
apply, set by Docker instead.

| Service    | Share               | Count                       | Serves                                                                |
| ---------- | ------------------- | --------------------------- | --------------------------------------------------------------------- |
| **exam**   | 0.8 vCPU, heap 1536 | scales with the box         | `AttemptsController`, `MeLeaderboardController`                       |
| **core**   | 0.6 vCPU, heap 768  | scales with the box         | auth, `me`, saved, results, every `admin/*` route, imports            |
| **worker** | 0.4 vCPU, heap 768  | **exactly one, never more** | no routes but health and metrics; all eight processors and schedulers |

**The worker is a singleton, and that is a constraint rather than a choice.** The flush runs every
60 s and the sweep every 120 s, and `concurrency: 1` in `QUEUE_POLICY` is the _only_ thing stopping
tick N overlapping tick N+1 — it works inside one process and nowhere else. Two worker containers
put two sweeps over the same keys, which is exactly what the comment beside that setting warns
about, and no distributed lock exists behind it. Scoring itself is idempotent and would scale
safely; if it ever needs to, the answer is a fourth role that registers only the scoring processor,
not a second worker.

**Node is single-threaded, so container count is how you use the box.** One `API_ROLE=all`
container on a 2-vCPU box uses half of it, permanently. Three is the minimum that both uses the
machine and keeps the schedulers in one place.

**Why exam gets the largest share.** Measured over real HTTP: at 0.5 vCPU the autosave path peaked
at 545 requests a second with a p99 of ~400 ms, because CFS throttling kicks in; at 1 vCPU it
reached 2,076 a second with a p99 of 4–30 ms. An event peaks around 250–350 requests a second, so
that is roughly six times the headroom.

**Scoring drains a hall in about a minute.** Measured 25 September 2026 against the real database
with `scripts/bench-scoring.mjs`: 5,000 sittings of 100 questions reach `EVALUATED` in 4.75 seconds
at the processor's own concurrency of 8, p95 9.4 ms — **1.99 ms of Postgres CPU and 2.46 ms of Node
CPU each**, over 3.4 transactions, 61 tuples read and 28.5 written. The concurrency sweep on that
hardware: 2 → 488 a second, 4 → 798, 8 → 1,052, 16 → 1,254, 24 → 1,301, with p95 climbing from
4.7 ms to 26.6 ms across it. Eight sits at 81% of the ceiling with a quarter of the queueing.

Those are a 10-core M4 with Postgres in Docker beside it. A Graviton2 core is roughly three to four
times slower, so read the hall as **15–20 s of RDS time and 75–125 s of worker time at 0.4 vCPU** —
worker-bound, and the database is not the constraint. Nobody is blocked while it drains.

**Scaling.** More containers, up to what the box's vCPUs allow; a bigger event means a bigger box,
which on EC2 is a stop, a resize and a start. Hourly billing makes that cheap: a load test on a
four-times-larger instance for an afternoon costs cents.

**Event windows.** Only tests in an EVENT series are pre-warmed. On this shape pre-warming means
resizing the box before `opensAt` rather than raising an autoscaling minimum — deliberate, not
automatic, and it must be on the release calendar.

**Open: whether production returns to Fargate.** The staging box (§12) is where that gets decided,
with one number. Simulate a 6,000-candidate event at the intended production size and read the CPU:
under 50% and one box is plenty, so Fargate's autoscaling solves a problem that does not exist;
50–80% and you need headroom; over 80%, or more than one box, and two boxes need something in front
of them — which is an ALB, and once there is an ALB, Fargate is nearly free to adopt. Nothing in
this file forecloses it: the Dockerfile, the env and the three roles are identical either way.

## 4. Ingress

**Caddy, in a container on the same box.** It obtains and renews a Let's Encrypt certificate per
hostname by itself over the ACME HTTP challenge, which needs each name resolving to the box and
ports 80 and 443 open. No ALB, no ACM, no target groups.

```
api.iace.co.in { reverse_proxy /attempts/* exam:3000
                 reverse_proxy core:3000 }
```

**What this gives up, stated plainly:** an ALB is multi-node and self-healing; one Caddy on one box
is not. A reboot is an outage, and at 10–30 events a month that has to be scheduled around. The
escape hatch is Route 53 health-checked failover to a second box, or the ALB.

**Let's Encrypt will not issue for `*.amazonaws.com`** — those names are on the Public Suffix List
and blocked. So an AWS-provided EC2 hostname cannot have HTTPS, which matters because the student
app is a PWA and a service worker requires it. Every environment needs a real name. CloudFront's
own `*.cloudfront.net` is the exception and comes with a valid certificate, which is why staging's
SPAs need no DNS at all.

**The API is deliberately not behind CloudFront:** autosaves alone are 15–30M requests a month
during events, which would add $10–30 in request fees and buy nothing, since the preflight is
already cached for two hours.

**Anything in front of the API must pass `x-client` and `x-device-name` through** (`docs/01` §6),
and `TRUST_PROXY_HOPS` must count the real hops or every rate limit counts one address.

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

|              |                                                                      |
| ------------ | -------------------------------------------------------------------- |
| Disk         | 3.75 KB (sheet 2.05, attempt 0.76, rollups 0.33, notification 0.61)  |
| WAL          | 14 KB                                                                |
| Database CPU | ~4.7 ms — 0.13 start, 0.35 per flush, 0.41 submit, 1.99 scoring (§3) |

A 6,000-candidate event is about 28 seconds of database CPU. At 250K sittings a month that is
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

`/metrics` already publishes what an event needs watching — latency and error rate, submits, queue
depth and oldest wait, job failures, Redis memory and evictions, live sittings not yet in Postgres,
database connections. **Grafana Cloud's free tier** scrapes it through an agent beside Valkey;
Amazon Managed Prometheus and Grafana would be $14–19 for the same picture.

Off deliberately: Container Insights (priced per metric, duplicates free ECS metrics) and VPC flow
logs (one zone, nothing to see).

## 10. Media

One private bucket, reached by CloudFront over an origin access control, and a question image is
served on a **stable unsigned URL** — `MEDIA_BASE_URL` plus the key. Not a presigned S3 URL, and
not a CloudFront signed one either.

The reason is caching, not privacy. A signature is per-request, so the URL differs per student,
and 6,000 students download the same diagram 6,000 times from S3 at $0.1093/GB — $28–48 a month at
event scale, plus a browser cache that never hits. Unsigned, the edge fetches once and the transfer
is inside the free tier.

Nothing is given away by dropping the signature. The key is a uuid, the bucket does not list, and
the image is quoted by a paper whose question text is already served unsigned to the same student.
A 6-hour presigned URL was a bearer token for content the holder could screenshot anyway. What
protects a paper is that the server will not serve it before `startedAt` — not the shape of an
image url. If a threat ever demands more, the answer is CloudFront **signed cookies** (one cookie a
sitting, urls still stable, caching intact), never a signature in the url.

Uploads carry `Cache-Control: public, max-age=31536000, immutable`, which a fresh uuid per upload
earns. Locally `minio-init` opens `questions/images` for anonymous download, so the one code path
holds.

Admin imports and student documents keep S3 presigned URLs — genuinely per-person, trivial volume.

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

**Its own box: one EC2 `t4g.medium`, ~$23 a month.** It is production's shape at a tester's size —
Caddy in front, the same three containers, one worker — with two differences that matter.

- **Postgres runs as a container on the box**, not RDS. The data is disposable, so the $18 buys
  nothing yet. Set `max_connections=200`: the image default of 100 is thin against three containers
  at `connection_limit=25`. When production exists, staging's database **moves onto the production
  RDS instance** with `CONNECTION LIMIT 10` on the role, `statement_timeout` 30 s and
  `idle_in_transaction_session_timeout` 60 s — and **that migration is the rehearsal**, on
  throwaway data, before the same move matters.
- **`NODE_ENV=development`, `OTP_SENDER=console`.** An admin signs in with an emailed OTP and a
  student with an SMS one, and the DLT registration behind that SMS does not exist yet; in
  development the API returns the code as `devCode` on the request response, so a tester signs in
  with no provider at all. `CORS_ORIGINS` is still enforced — `corsOrigin` uses the list whenever
  it is non-empty, whatever the mode.

Heaps are 384 MB per container rather than production's 1536/768/768: one tester needs no more, and
three containers plus Postgres plus Valkey is ~3.25 GB of the 4.

**Only one DNS record.** CloudFront hands out `*.cloudfront.net` with a valid certificate and S3
presigned URLs use `*.s3.ap-south-1.amazonaws.com`, so only the API needs a name Caddy can get a
certificate for. Media is presigned S3 here, not CloudFront signed URLs — those are not built (§15).

**Seeded and generated data only — never a restore of production.** Real students' names, mobile
numbers and marks do not belong in a lower-security environment.

**This box is also the load-testing rig.** EC2 bills hourly, so resize it to the production
candidate for an afternoon, run the event, resize back: four hours of an instance four times larger
costs about a third of a dollar. That is what settles §3's open question, and it is worth running
against two instance families — one burstable, one not — in the same session.

## 13. Commitments

Nothing at launch. After 4–8 weeks of real events the baseline is known; commit to 70–80% of it so
growth and bursts stay on demand.

|                            | On demand | 1-year, no upfront |
| -------------------------- | --------- | ------------------ |
| EC2 `t4g.large` (prod)     | $32.70    | ~$23.50            |
| EC2 `t4g.medium` (staging) | $16.35    | ~$11.75            |
| RDS `db.t4g.small`         | $30.66    | $24.09             |

A Compute Savings Plan covers EC2 in any region and family, so resizing the box stays covered; an
RDS reservation is tied to its instance family, so do not buy one until §3's open question is
settled and the database size is not going to move.

**`t4g` is burstable, and unlimited mode is the default.** Past the 20%-per-vCPU baseline you pay a
surcharge rather than being throttled — about $0.04 per surplus vCPU-hour, so a box pegged for a
month is ~$47 on top. That is the right trade for an exam (a bill beats an outage), but it needs an
alarm on `CPUSurplusCreditsCharged`, and it is the single largest gap between the expected and the
worst-case invoice.

## 14. How a release goes out

1. Build both targets from `apps/api/Dockerfile`: `runtime` (600 MB, 108 MB pulled) and `migrate`
   (731 MB, 163 MB pulled). The Prisma CLI is only in the migration image.
2. Build the SPAs. **`VITE_API_URL` is substituted at compile time**, so an environment is a build,
   not a variable — a staging artifact cannot be promoted to production.
3. Upload the SPAs: hashed assets **first**, with `max-age=31536000, immutable`; then `index.html`,
   `sw.js` and the manifest with `no-cache`. The other order serves a shell pointing at chunks that
   are not there yet. Invalidate those three paths only — `/*` evicts the whole asset cache for
   nothing, and 1,000 invalidation paths a month are free.
4. **Old `/assets` files are never deleted.** A tab opened before the deploy still lazy-loads a
   chunk by its old name; keeping them costs about a cent a year.
5. Run the **migrate** image to completion. It runs `prisma migrate deploy` and exits, and the API
   containers do not start until it has.
6. Recreate the API containers. Each is `tini`-led, so SIGTERM closes Nest and the container exits
   (`b2029d4`). **There is no draining on this shape** — `docker compose up -d` recreates with a
   gap, which is the cost of not having a load balancer.

A new service worker installs but **does not activate until every tab of the old one closes** —
there is no `skipWaiting`, deliberately, because a bundle swapped under a sitting in progress is
worse than a stale tab. Deploying and students seeing the new build are different moments.

Never during an event window, and never a migration that moves data without the rehearsal
`docs/superpowers/task-constraints.md` prescribes.

## 15. Deferred

- **The service worker never prunes its cache** (`iace-shell-v1` is a fixed name), so a student's
  device keeps up to ~1.5 MB per deploy they load. The `activate` handler already drops every cache
  whose name is not the current one — it never fires because the name never changes. Stamp the
  build id into `sw.js` and it cleans itself up.
- **CloudFront signed URLs for question images.** Until then media is presigned S3, so each student
  fetches the same diagram from the origin. **This is also the only line that can move the invoice
  by an order of magnitude**: the free tier is 1 TB, which is ~5.8 MB of images per sitting across
  thirty 6,000-candidate events. Above that it is $0.109/GB — 23 MB a sitting would be ~$340 a
  month. Nobody has measured what a real paper carries; `MAX_WIDTH` and `QUALITY` in
  `shrink-image.ts` are the knobs if it comes back high.
- **Batching the scoring job.** Measured 25 September 2026: nine round trips per attempt, whose
  statements total ~0.7 ms against 1.99 ms of database CPU — so most of the database's work is
  parse, plan and transaction overhead rather than execution. Scoring N attempts per job collapses
  that to roughly six statements per batch. `foldMistakes` already takes an array.
- **Whether `SavedQuestion` needs a row per wrong answer.** It is 28 inserts per attempt, 140,000
  per event, and it scales with how hard the paper is. `AttemptSheet.verdicts` already records
  which questions were wrong, so the list is derivable; materialising it is a hot-path write and
  permanent growth.
- **Redis as a hash per sitting** instead of one JSON document — measured 7.2 KB against 20.5 KB
  under the old shape, and roughly 10× less traffic. Revisit above ~100 Mbps sustained.
- **Archiving old answer sheets** and pruning read notifications, when the database passes ~200 GB.
