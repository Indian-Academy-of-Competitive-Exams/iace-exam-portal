# IACE platform — infrastructure

What runs this platform on AWS, what each piece costs, and why it is that size rather than a
larger one. `docs/01-architecture.md` §6 names the services; this file is the sizing, the money
and the runbook.

Every price is US dollars per month in **ap-south-1 (Mumbai)**, pulled from the AWS Price List API
on 22 September 2026, at 730 hours, and **not re-pulled since** — check the Pricing Calculator
before committing money. Figures that came from a measurement say where it was taken.

**The load this is sized for is `CLAUDE.md`'s, and nowhere else's: ~3K concurrent normally, 6K
handled, 8K with minor additions, 10K inside these limits.** Every derived figure below is worked
against **8,000 candidates an event, 30 events a month**. When that line in `CLAUDE.md` moves, the
arithmetic here moves with it.

**How to read a number here.** A figure carries the date it was taken and the command that took it,
or it is an estimate rather than evidence. §16 lists the ones that have not been re-measured
against current code — do not build on those without running them again first.

**The shape is two boxes, from 26 September 2026.** The API containers sit on one and the data
stores on another, sharing one Valkey and one Postgres between staging and production. That is
partly thrift while production does not exist, and partly measurement: a bench with Postgres on
loopback flatters itself, and production will always have the database on another host.

**The front door changed on 25 September 2026.** This file described an Application Load Balancer
in front of ECS Fargate. It now describes **Caddy on EC2**, because an ALB is what makes Fargate
practical — tasks register themselves in a target group as they scale — and without one the pair
stops making sense. Whether production goes back to Fargate is **open**, and §3 says what decides
it.

---

## 1. What it costs

**Two boxes, both environments on them.** The API box is per environment; the data box is shared
until production needs it not to be.

| Box                   | What                                                  | Monthly    |
| --------------------- | ----------------------------------------------------- | ---------- |
| **A — API, prod**     | EC2 `t4g.large`: Caddy, exam, core, worker            | $32.70     |
|                       | EBS gp3 30 GB + Elastic IP                            | $6.39      |
| **A′ — API, staging** | EC2 `t4g.medium`, the same three containers           | $16.35     |
|                       | EBS gp3 30 GB + Elastic IP                            | $6.39      |
| **B — data, shared**  | EC2 `t4g.small`: Valkey + Postgres, no public ingress | $8.18      |
|                       | EBS gp3 30 GB + Elastic IP (egress only)              | $6.39      |
| Frontend and media    | S3 + CloudFront, both environments                    | ~$2        |
| Logs and alarms       | CloudWatch, ~10 alarms, two free Budgets              | $1.70      |
| Secrets, DNS, ECR     | SSM, Route 53, container registry                     | $1.20      |
| **Total**             |                                                       | **$81.30** |

**The invoice is ~$96** — ap-south-1 bills through AWS India at 18% GST on top. It is input credit
against the institute's GSTIN, but only if the GSTIN is on the account, so that is a signup step
rather than a footnote.

**What this is not yet.** Box B runs Postgres as a container, which is throwaway-grade: no
point-in-time restore, no automated backups, no storage autoscaling. That is deliberate while the
data is seeded. **Before real marks exist, Postgres moves to RDS `db.t4g.small` (+$33.28)** and
Box B keeps only Valkey — and doing that migration on disposable data is the rehearsal for doing
it when it matters.

For comparison, the ALB + Fargate shape this file used to describe came to ~$142 for production
alone. The saving is the load balancer, the Fargate premium and the NAT instance; what it costs is
two boxes you own and a failure domain per box (§3, §4).

**Two AWS Budgets, and they are free.** One at the total above, one anomaly detector. Every alarm
in §9 watches something that is running; none watches something that should have stopped, and on a
first AWS account a rehearsal instance left up for three weeks costs more than the mistakes the
alarms catch.

**Internet egress is inside the free tier.** Measured 25 September 2026: a 100-question bilingual
sitting pulls 41 KB of paper, 3 KB of score card and 56 KB of solution report gzipped — 100 KB, so
an 8,000-candidate event is 0.8 GB and thirty events a month are ~24 GB against the free 100 GB.
That margin is what `compression()` in `main.ts` buys; without it the same traffic is ~125 GB and
billable.

**Traffic between the boxes is free** — same VPC, same zone. It is not free of latency: §3.

A one-year no-upfront commitment takes the always-on part from $57.23 to ~$41 (§13). Buy nothing
at launch.

Outside AWS: Sentry (free tier), Grafana Cloud (free tier), the SMS aggregator and WhatsApp
per message, and the domain.

## 2. The shape

One VPC. Two availability zones exist only because an **RDS subnet group requires two subnets in
two zones** — nothing needs one today, and it will when Postgres moves. Every running thing sits in
one zone, so inter-AZ traffic is zero.

**Box A — the API.** Public subnet, Elastic IP. Caddy terminates TLS and routes by path to the exam
or the core container; the worker takes no HTTP at all. Security group: 80 and 443 from the world,
22 from one address. One of these per environment.

**Box B — the data.** Valkey and Postgres, both containers. **Its security group accepts 5432 and
6379 from Box A's security group and from nothing else** — not from the internet, not by CIDR, by
group, so a new API box inherits the rule by being in the right group. It carries a public address
only so it can pull images.

**No NAT.** Both boxes are public-subnet, so nothing needs a gateway to reach SMS, push, Sentry or
ECR — which removes the `t4g.nano` and its address that the ALB shape needed.

A student's browser resolves the domain at Route 53, loads the two SPAs and question images from
CloudFront, and sends every API call to Box A.

**Why the split, when one box would be cheaper.** Two reasons, and the second is the real one.
Postgres and Valkey stop competing with the API for the same two cores, which matters during an
event. And a benchmark with Postgres on loopback measures a topology production will never have —
RDS is always another host, so the number that transfers is the one taken across a network hop.

## 3. Compute — three containers, one image

`API_ROLE` decides what a container registers (`apps/api/src/config/api-role.ts`). One image serves
all three; unset means all of them, which is what local development runs. They run under Docker
Compose on **Box A and nothing else** — Valkey and Postgres are on Box B (§2), so the whole box is
the API's.

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

**Why exam gets the largest share.** CFS throttling: below a whole core the quota is spent early in
each 100 ms window and the process is frozen for the rest, which shows as a low CPU average beside
a terrible p99. The throughput figures that used to sit here are unverified and now in §16.

An 8,000-candidate event peaks around **350–500 requests a second** — autosaves at 320, plus the
paper loads at the opening and the submit spike at the end. What one vCPU actually serves against
that is the first thing to measure on the staging box.

**Scoring drains a hall in a minute or two.** Measured 25 September 2026 against the real database
with `scripts/bench-scoring.mjs`: 5,000 sittings of 100 questions reach `EVALUATED` in 4.75 seconds
at the processor's own concurrency of 8, p95 9.4 ms — **1.99 ms of Postgres CPU and 2.46 ms of Node
CPU each**, over 3.4 transactions, 61 tuples read and 28.5 written. The concurrency sweep on that
hardware: 2 → 488 a second, 4 → 798, 8 → 1,052, 16 → 1,254, 24 → 1,301, with p95 climbing from
4.7 ms to 26.6 ms across it. Eight sits at 81% of the ceiling with a quarter of the queueing.

Those are a 10-core M4 with Postgres **on loopback beside it**, which is the one thing about them
that will not reproduce. A Graviton2 core is roughly three to four times slower, and an
8,000-candidate hall is 1.6× the measured run, so read it as **25–32 s of database time and
2–3.5 minutes of worker time at 0.4 vCPU**, or under a minute on a whole core — worker-bound, and
the database is not the constraint.

**Expect the two-box numbers to be worse, and do not read that as a regression.** Loopback is
~50 µs; same-zone VPC is 0.1–0.3 ms, and scoring makes **nine round trips per attempt** (§6), so
+1–3 ms on a 7.4 ms p50 — 15–40%. That is the figure that transfers, because production always has
the database on another host.

**Scaling is vertical, and the box is never the ceiling.** More containers up to what the vCPUs
allow, and a bigger event means a bigger box — a stop, a resize and a start, two minutes, billed
hourly. At `t4g.2xlarge` (8 vCPU) one box serves roughly 4,000 requests a second even on the
pessimistic multiplier, which is eight times the 10K ceiling `CLAUDE.md` sets. **One box will not
run out of capacity; it runs out of availability**, which is the reason to add a second, not CPU.

Point Caddy at the compose service name with a `dynamic a` upstream rather than a fixed host.
Docker's DNS returns every container of a scaled service, so `docker compose up -d --scale exam=4`
is the whole of scaling out and Caddy needs no config change.

**Event windows.** Only tests in an EVENT series are pre-warmed. On this shape pre-warming means
resizing the box before `opensAt` rather than raising an autoscaling minimum — deliberate, not
automatic, and it must be on the release calendar.

**Open: whether production returns to Fargate.** The staging box (§12) is where that gets decided,
with one number. Simulate an 8,000-candidate event at the intended production size and read the CPU:
under 50% and one box is plenty, so Fargate's autoscaling solves a problem that does not exist;
50–80% and you need headroom; over 80%, or more than one box, and two boxes need something in front
of them — which is an ALB, and once there is an ALB, Fargate is nearly free to adopt. Nothing in
this file forecloses it: the Dockerfile, the env and the three roles are identical either way.

## 4. Ingress

**Caddy, in a container on the same box.** It obtains and renews a Let's Encrypt certificate per
hostname by itself over the ACME HTTP challenge, which needs each name resolving to the box and
ports 80 and 443 open. No ALB, no ACM, no target groups.

`deploy/Caddyfile` is the real one and the source of record for the route list; its shape:

```
api.iace.co.in {
	@exam path <the exam role's leaf paths>
	reverse_proxy @exam exam:3000
	reverse_proxy core:3000
}
```

**The split is not prefix-clean, so the matcher cannot be either.** `GET /me/performance` is exam,
but `/me/performance/report`, `/me/performance/days` and `/me/performance/series` are core, so the
matcher names that exact path, never a `/me/performance*` wildcard. `GET
/me/attempts/:id/question-report` is core too, under the same `/me/attempts` prefix the exam routes
use, so the matcher lists leaf suffixes like `/me/attempts/*/state` rather than a blanket
`/me/attempts/*`.

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

At `3fca444` the student app's first load was 817 KB raw, 238 KB brotli, after the exam hall,
solutions and saved questions moved behind `React.lazy`. The SPAs have moved since — §16.

## 6. Database

**Today: PostgreSQL 17 as a container on Box B, one instance, a database per environment.**
`max_connections=200` — the image default of 100 is thin against two environments. Production's
role is unrestricted; **staging's carries `CONNECTION LIMIT 10`, `statement_timeout` 30 s and
`idle_in_transaction_session_timeout` 60 s**, so a staging runaway cannot take production's
connections or hold its CPU.

**Before real marks exist: RDS `db.t4g.small`**, single-AZ, 20 GB gp3 autoscaling to 100 GB, 7-day
point-in-time restore, $30.66 plus $2.62 for the storage. A container has none of that — no
backups, no PITR, no storage autoscaling — which is fine for seeded data and not fine for a
student's marks. **Doing that migration while the data is disposable is the rehearsal**, and it is
the one operational move nobody should be making for the first time under pressure.

Postgres 17 rather than 16 because RDS Extended Support costs $0.114 per vCPU-hour once a version
leaves standard support — more than the instance. 16 leaves on 28 February 2029, 17 on
28 February 2030. The container is on 17 so the move is a dump and a restore, not an upgrade.

**Connections decide the size, not load.** At `connection_limit=25` a container is generous; the
budget is exam 8, core 25, worker 25 = 58 for production, 10 for staging, and the rest spare. On
RDS that becomes 190 of the ~225 a 2 GB instance allows. It is written in `.env.example` beside the
pool guidance.

**What a sitting costs, measured 25 September 2026** with `scripts/bench-scoring.mjs` — the scoring
pass only, which is the half that was re-measured after the rollup refactor:

|                       |                                                                    |
| --------------------- | ------------------------------------------------------------------ |
| Database CPU, scoring | 1.99 ms at concurrency 8; 1.16 ms at concurrency 2                 |
| Statements            | 9 round trips, 3.4 transactions                                    |
| Rows written          | 28.5 inserted, 1.7 updated — the inserts are `SavedQuestion` (§15) |

An 8,000-candidate event is about **16 seconds of database CPU for scoring**. Start, autosave flush
and submit have not been re-measured since the answer sheet and rollup changes; the per-sitting
disk and WAL figures that used to sit here were taken before `SavedQuestion` moved onto the scoring
transaction and are void — 28 rows a sitting cannot fit the 3.75 KB they claimed. §16.

Storage is still not expected to be a cost driver, but **nobody has a current number for growth**,
and the `SavedQuestion` volume is what would change it.

## 7. Cache and queues

**Valkey as a container on Box B**, append-only file flushed every second, `maxmemory` 1.2 GB,
`maxmemory-policy noeviction`. Shared by both environments.

`noeviction` is not a preference: BullMQ requires it, and this holds live sittings, so an eviction
policy would silently drop a candidate's answers. The API refuses to boot in production against
anything else.

- **ElastiCache Serverless cannot be used at all** — it has no parameter groups, so the policy
  cannot be set, and BullMQ's own documentation rules it out.
- A node-based `cache.t4g.small` is $23.94 and comes back **empty** after a node failure; no
  current ElastiCache engine writes to disk.

**Two environments on one Valkey are separated by the database index, and nothing else.**
`redis.keys.ts` namespaces keys by FEATURE, not by environment, and BullMQ has no prefix
configured — so without this both would share `bull:scoring:*`, a production worker could pick up a
staging job, and a `FLUSHDB` on staging would take production's sessions with it. ioredis reads the
index off the URL and both `redis.service.ts` and `queue.module.ts` build their client from it:

```
production  REDIS_URL=redis://<box-b>:6379/0
staging     REDIS_URL=redis://<box-b>:6379/1
```

**What that does not separate is memory.** `maxmemory` is instance-wide, and under `noeviction` a
staging runaway that fills it makes PRODUCTION writes fail. That is the trigger to give production
its own Valkey, and it is the reason the shared box is a phase rather than a design.

A 100-question sitting was measured at 10.2 KB of JSON, 12.1 KB in Redis, and a save moves about
three times the state (read, then compare-and-set with both values). Those per-sitting figures
predate the recent work and are unverified (§16); scaled to 8,000 candidates they would put an
event at roughly 64–120 Mbps and ~57 GB, with peak memory 0.7–1.1 GB, dominated by the 15-minute
catalog cache. Box B is `t4g.small` (2 GB) while the data is seeded and wants `t4g.medium` before
production carries 8,000 live sittings.

**Traffic between the boxes is free** — same VPC, same zone — but it is not free of latency, and
§3 says what that costs the scoring drain.

## 8. Networking

**No NAT, and nothing to run.** Both boxes sit in the public subnet with an address of their own, so
outbound — SMS, WhatsApp, push, Sentry, log shipping, ECR, image pulls — needs no gateway. The ALB
shape needed a `t4g.nano` NAT instance at $6.42 because its compute was private; this one does not.

What replaces it is **security groups, not subnets**. Box A takes 80 and 443 from the world and 22
from one address. Box B takes 5432 and 6379 **from Box A's security group** and nothing else — by
group rather than by CIDR, so a replacement or a second API box inherits the rule by membership.
Box B's own address is egress-only in practice: nothing on the internet has a rule to reach it.

**Between the boxes is free and fast, but not free of latency.** Same VPC and same zone, so no
inter-AZ charge (that would be $0.01/GB each way) and no data-transfer charge at all. The cost is
0.1–0.3 ms per round trip against loopback's 50 µs, which §3 works through for the scoring drain.

Internet egress is $0.1093/GB after the 100 GB monthly free tier, and §1 measures what this
platform actually sends.

## 9. Logs, metrics and alarms

The API has 35 log statements and **none on the request path**, so CloudWatch ingest stays inside
the free 5 GB. Containers log through Docker's `awslogs` driver, kept 14 days. **Caddy's access log
replaces the ALB's** — a JSON line per request to a file, shipped the same way; there is no S3
lifecycle to configure because there is no load balancer writing to a bucket.

About ten alarms at $0.10 each. **The list changed with the front door**, and an alarm on a metric
that no longer exists is worse than no alarm:

| Watch                          | Where it comes from                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| 5xx rate, request latency      | `iace_http_request_duration_seconds` on `/metrics`, or Caddy's own Prometheus endpoint     |
| A container down               | EC2 status checks on Box A and Box B, plus the Docker restart count                        |
| **`CPUSurplusCreditsCharged`** | The burst surcharge, and the largest gap between the expected and worst-case invoice (§13) |
| CPU, storage, connections      | Box B, and RDS's own metrics once Postgres moves                                           |
| Valkey memory and evictions    | One custom metric, $0.30                                                                   |
| **CloudFront bytes out**       | The one line that can move the bill by an order of magnitude (§15)                         |

**No ALB 5xx, no unhealthy-target count, no ECS running count** — those metrics do not exist on this
shape. Anything that used to depend on them is now the app's own `/metrics` or an EC2 status check.

`/metrics` already publishes what an event needs watching — latency and error rate, submits, queue
depth and oldest wait, job failures, Redis memory and evictions, live sittings not yet in Postgres,
database connections. **Grafana Cloud's free tier** scrapes it; Amazon Managed Prometheus and
Grafana would be $14–19 for the same picture.

Off deliberately: Container Insights and VPC flow logs (one zone, nothing to see).

## 10. Media

One private bucket, reached by CloudFront over an origin access control, and a question image is
served on a **stable unsigned URL** — `MEDIA_BASE_URL` plus the key. Not a presigned S3 URL, and
not a CloudFront signed one either.

The reason is caching, not privacy. A signature is per-request, so the URL differs per student,
and 8,000 students download the same diagram 8,000 times from S3 at $0.1093/GB — $37–64 a month at
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
- **Route 53**, $0.50 a month: a free ALIAS to CloudFront for the SPAs, and an A record per
  environment to its API box's Elastic IP. **Caddy gets the API certificate itself** (§4), so ACM
  is needed only in us-east-1 for CloudFront, where it is free. The Elastic IP is also the failover
  mechanism — remapping it to a replacement instance takes seconds and needs no DNS propagation.
- **ECR** at $0.10/GB-month with a lifecycle keeping the last ten images, under $0.20.
- GitHub Actions pushes through an OIDC role, so no AWS keys live in GitHub either.

## 12. Non-production

**Its own API box, production's data box.** One EC2 `t4g.medium` running Caddy and the same three
containers, pointing at Box B — which is the whole of the difference from production, and it is
deliberate: staging exists to rehearse production's shape, not a smaller one.

- **Postgres:** its own database on Box B, with `CONNECTION LIMIT 10` on the role (§6).
- **Valkey:** **database index 1**, production on 0. Read §7 before changing this — without it the
  two share a queue keyspace.
- **`NODE_ENV=development`, `OTP_SENDER=console`.** An admin signs in with an emailed OTP and a
  student with an SMS one, and the DLT registration behind that SMS does not exist yet; in
  development the API returns the code as `devCode` on the request response, so a tester signs in
  with no provider at all. `CORS_ORIGINS` is still enforced — `corsOrigin` uses the list whenever
  it is non-empty, whatever the mode.

Heaps are 384 MB per container rather than production's 1536/768/768: one tester needs no more.

**Only one DNS record per environment.** CloudFront hands out `*.cloudfront.net` with a valid
certificate and S3 presigned URLs use `*.s3.ap-south-1.amazonaws.com`, so only the API needs a name
Caddy can get a certificate for. Media is presigned S3 here, not CloudFront signed URLs — those are
not built (§15).

**Seeded and generated data only — never a restore of production.** Real students' names, mobile
numbers and marks do not belong in a lower-security environment, and while the two share a Valkey
and a Postgres instance that rule is doing more work than usual.

**This box is also the load-testing rig**, and the split from Box B is what makes it worth trusting
— the API box's CPU is the API's alone, and the database is across a network hop, which is the
topology production will have. EC2 bills hourly, so resize to the production candidate for an
afternoon, run the event, resize back: four hours of an instance four times larger costs about a
third of a dollar. That is what settles §3's open question, and it is worth running against two
instance families — one burstable, one not — in the same session.

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
  thirty 8,000-candidate events, so **4.4 MB of images per sitting**. Above that it is $0.109/GB —
  23 MB a sitting would be ~$450 a month. Nobody has measured what a real paper carries; `MAX_WIDTH` and `QUALITY` in
  `shrink-image.ts` are the knobs if it comes back high.
- **Batching the scoring job.** Measured 25 September 2026: nine round trips per attempt, whose
  statements total ~0.7 ms against 1.99 ms of database CPU — so most of the database's work is
  parse, plan and transaction overhead rather than execution. Scoring N attempts per job collapses
  that to roughly six statements per batch. `foldMistakes` already takes an array.
- **Whether `SavedQuestion` needs a row per wrong answer.** It is 28 inserts per attempt, 140,000
  per event, and it scales with how hard the paper is. `AttemptSheet.verdicts` already records
  which questions were wrong, so the list is derivable; materialising it is a hot-path write and
  permanent growth.
- **Redis as a hash per sitting** instead of one JSON document, which would cut both the memory and
  the traffic a save moves. The figures that used to sit here were taken under the answer shape
  before `AttemptSheet` and are gone. Revisit above ~100 Mbps sustained.
- **Archiving old answer sheets** and pruning read notifications, when the database passes ~200 GB.

## 16. Figures that have not been re-measured

**Nothing in this section is evidence.** It is here so a reader knows the number exists and knows
not to build on it. Each line says what to run to replace it with something real.

| Figure                                                                               | Where it came from                                                                          | To replace it                                                                  |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Exam HTTP throughput — 545 req/s at 0.5 vCPU, 2,076 at 1 vCPU, p99 400 ms vs 4–30 ms | Undated, over real HTTP, on a revision before the answer sheet and the rollup refactor      | A load generator against the staging box's exam container, at its `cpus` limit |
| Start, autosave flush and submit database CPU — 0.13, 0.35, 0.41 ms                  | Same era, and submit has changed twice since                                                | Extend `scripts/bench-scoring.mjs` past scoring                                |
| Per-sitting disk and WAL — 3.75 KB and 14 KB                                         | Taken before `SavedQuestion` moved onto the scoring transaction, which alone writes 28 rows | `pg_total_relation_size` deltas across a seeded event                          |
| Redis per sitting — 10.2 KB JSON, 12.1 KB stored                                     | Undated                                                                                     | `MEMORY USAGE` on a live sitting key                                           |
| SPA first load — 817 KB raw, 238 KB brotli                                           | True at `3fca444`; the SPAs have moved                                                      | `pnpm --filter @iace/test build` and read the output                           |
| Graviton is 3–4× slower than the measuring machine                                   | An assertion, never benchmarked — and every "on AWS" figure here rests on it                | Run `scripts/bench-scoring.mjs` on the staging box once                        |
| Every AWS price                                                                      | Price List API, 22 September 2026, not re-pulled                                            | The Pricing Calculator, before committing money                                |

**The last two matter most.** The Graviton multiplier sits underneath every projection in this
file, and it is replaced by one command on the first box that exists.
