# IACE platform — infrastructure

What runs this platform on AWS, what each piece costs, and why it is that size rather than a
larger one. `docs/01-architecture.md` §6 names the services; this file is the sizing, the money
and the runbook.

Every price is US dollars per month in **ap-south-1 (Mumbai)** at 730 hours, from the AWS Price
List bulk files, **re-pulled 28 September 2026 against list version 20260925 and unchanged** —
every instance, volume, address, database and transfer rate below came back identical to the
22 September pull. Figures that came from a measurement say where it was taken.

**To re-pull them**, no credentials needed, the bulk files are public:

```
https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-south-1/index.json
                                                       AmazonRDS/current/ap-south-1/index.json
                                                       AmazonS3/current/ap-south-1/index.json
                                                       AmazonVPC/current/ap-south-1/index.json
                                                       AmazonCloudFront/current/index.json
                                                       AmazonRoute53/current/index.json
```

The EC2 one is **313 MB** and has to be streamed rather than parsed whole. And the trap: the
**public IPv4 charge is not in the EC2 file** — it is `APS3-PublicIPv4:InUseAddress` under
**AmazonVPC**, which is why it looks missing when you go hunting for it.

**The load this is sized for is `CLAUDE.md`'s, and nowhere else's: ~3K concurrent normally, 6K
handled, 8K with minor additions, 10K inside these limits.** Every derived figure below is worked
against **8,000 candidates an event, 30 events a month**. When that line in `CLAUDE.md` moves, the
arithmetic here moves with it.

**How to read a number here.** A figure carries the date it was taken and the command that took it,
or it is an estimate rather than evidence. §16 lists the ones that have not been re-measured
against current code — do not build on those without running them again first.

**The shape is an API box per environment, one shared Valkey box, and one shared RDS instance,
from 26 September 2026.** Splitting the data stores off the API box is partly recovery — the API
box becomes disposable and live sittings survive replacing it — and partly measurement: a bench
with Postgres on loopback measures a topology production will never have.

**The compute is settled and Fargate is not coming back, decided 29 September 2026.** Until
25 September this file described an Application Load Balancer in front of ECS Fargate. It now
describes **Docker Compose on EC2 behind Caddy**, in staging and in production, and that is a
decision rather than a stage: an ALB is what makes Fargate practical — tasks register themselves in
a target group as they scale — so the two go together or not at all, and at this platform's ceiling
one box serves eight times the load `CLAUDE.md` asks for. §3 carries the arithmetic. Nothing in
this file is shaped to keep a migration back open.

---

## 1. What it costs

**Three boxes and an RDS instance, sized for the stage the platform is at rather than the one it is
heading for.** Everything here resizes in two minutes and bills hourly, so none of it is a decision
to agonise over — §13 says when each one moves.

**Today — staging only. Production does not exist yet.**

|                       | What                                            | Monthly    |
| --------------------- | ----------------------------------------------- | ---------- |
| Box A′ — staging API  | EC2 `t4g.medium`: Caddy, exam, core, worker     | $16.35     |
|                       | EBS gp3 30 GB + Elastic IP                      | $6.39      |
| Box B — Valkey        | EC2 `t4g.micro`, one process, no public ingress | $4.09      |
|                       | EBS gp3 10 GB + public IPv4 (egress only)       | $4.56      |
| Database              | RDS `db.t4g.micro`, 20 GB gp3, 7-day PITR       | $17.95     |
| Frontend and media    | S3 + three CloudFront distributions             | ~$1        |
| DNS, registry, alarms | Route 53, ECR, CloudWatch, two free Budgets     | $2.40      |
| **Total**             |                                                 | **$52.74** |

**With production alongside it.**

|                              | What                                     | Monthly     |
| ---------------------------- | ---------------------------------------- | ----------- |
| Box A — production API       | EC2 `t4g.large` + EBS 30 GB + Elastic IP | $39.09      |
| Box A′ — staging API         | EC2 `t4g.small` once builds move to ECR  | $14.57      |
| Box B — Valkey ×2            | EC2 `t4g.medium`, 20 GB, a process each  | $21.82      |
| Database                     | RDS `db.t4g.small`, two databases        | $33.28      |
| Frontend, media, DNS, alarms |                                          | $3.40       |
| **Total**                    |                                          | **$112.16** |

**Add 18% GST to both** — ap-south-1 bills through AWS India, so ~$62 today and ~$132 with
production. It is input credit against the institute's GSTIN, but only if the GSTIN is on the
account, so that is a signup step rather than a footnote.

**Why staging starts on `t4g.medium` and ends on `small`.** Day one you build on the box, and
`pnpm install` plus two Vite builds want 2–4 GB. Once images are built elsewhere and pulled from
ECR, 2 GB runs the three containers with room. Size for the hardest thing you do that day, then
resize down — forty cents for the privilege.

For comparison, the shape this file used to describe — an ALB in front of Fargate — came to ~$142
for production alone. The saving is the load balancer, the Fargate premium and the NAT instance;
what it costs is boxes you own and a failure domain per box (§3, §4). It is recorded as a price,
not as an option.

**Two AWS Budgets, and they are free.** One at the total above, one anomaly detector. Every alarm
in §9 watches something that is running; none watches something that should have stopped, and on a
first AWS account a rehearsal instance left up for three weeks costs more than the mistakes the
alarms catch.

**Internet egress is inside the free tier.** Measured 25 September 2026: a 100-question bilingual
sitting pulls 41 KB of paper and 56 KB of solution report gzipped. Its score card, re-measured 29
September once it carried every report tab's figures and no question, is 1 KB gzipped (2.7 KB raw)
whatever the paper's length — under 100 KB in all, so an 8,000-candidate event is 0.8 GB and
thirty events a month are ~24 GB against the free 100 GB. That margin is what `compression()` in
`main.ts` buys; without it the same traffic is ~125 GB and billable.

**Traffic between the boxes is free** — same VPC, same zone. It is not free of latency: §3.

Outside AWS: Sentry (free tier), Grafana Cloud (free tier), the SMS aggregator and WhatsApp
per message, and the domain.

## 2. The shape

One VPC. Two availability zones exist only because an **RDS subnet group requires two subnets in
two zones** — nothing needs one today, and it will when Postgres moves. Every running thing sits in
one zone, so inter-AZ traffic is zero.

**Box A — the API.** Public subnet, Elastic IP. Caddy terminates TLS and routes by path to the exam
or the core container; the worker takes no HTTP at all. Security group: 80 and 443 from the world,
22 from one address. One of these per environment.

**Box B — Valkey.** One container per environment, different ports (§7). **Its security group
accepts 6379 and 6380 from the API boxes' security group and from nothing else** — not from the
internet, not by CIDR, by group, so a replacement or a second API box inherits the rule by
membership. It carries a public address only so it can pull images.

**RDS** sits in the private subnet, reachable from the API boxes' security group on 5432.

**No NAT.** Both boxes are public-subnet, so nothing needs a gateway to reach SMS, push, Sentry or
ECR — which removes the `t4g.nano` and its address the ALB shape would have needed.

A student's browser resolves the domain at Route 53, loads the two SPAs and question images from
CloudFront, and sends every API call to Box A.

**Why Valkey has a box of its own, when it would fit beside the API.** Not memory, though it buys
about one extra exam container of headroom. **Recovery.** With Valkey elsewhere, the API box is
disposable: resize it, replace it, roll it, and every live sitting continues — a dead box is a
three-minute fix, launch from the AMI and remap the Elastic IP. With Valkey on it, that same
recovery drops sitting state on the floor.

It is an honest trade, not a free win: two boxes is two things that can fail, so an incident
becomes _more_ likely. What it buys is that recovery from one is fast and safe, and for a platform
whose bad hour cannot be repeated, that is the half that matters.

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

**The exam role runs under a budget, and the others do not.** Every route it serves belongs to a
live sitting and none of them is slow on purpose, so its Prisma connection carries a 6 s
`statement_timeout` and a request that has not answered in 8 s is refused with a 503
(`apps/api/src/common/request-budget.ts`). Both sit under the paper's own give-up — a submit at 10 s,
a save at 15 s — so a candidate gets a refusal their screen already retries rather than a request
nobody ends, and a query that ran long is cancelled by Postgres instead of holding a pool slot the
next candidate needs. It is keyed on the role being exactly `exam`: `all` and `worker` run the
scoring sweeps, whose transactions take minutes by design.

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

**A catalog edit during a start window is safe.** Any test or series write bumps one counter, and
each API process rebuilds its held series once — one read per container, not one per student.

**Settled: production is EC2, and a second box is bought for availability rather than capacity.**
The question this section used to leave open — whether production returns to Fargate — is closed,
and the paragraph above closes it: one box at `t4g.2xlarge` serves roughly eight times the ceiling
`CLAUDE.md` sets, so autoscaling would be solving a problem this platform does not have, and the
scheduler, the ALB and the per-task premium would all be bought for it. What the staging box (§12)
still measures is the SIZE of the production box, not its shape — simulate an 8,000-candidate event
at the intended size and read the CPU: under 50% and it is right, 50–80% and the next size up is,
over 80% and the event needs a scheduled resize (§13). When a second box is eventually wanted, the
reason is that one Caddy on one box is a single point of failure, and the answer is a warm standby
behind a Route 53 health check (§4).

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

**The split is not prefix-clean, so the matcher cannot be either.** Every `/me/performance` route
is core, but `/me/attempts` holds both: `GET /me/attempts/:id/scorecard`, `/solutions` and
`/question-report` are core, under the same prefix as the exam role's `/paper`, `/state` and
`/submit`, so the matcher lists leaf suffixes like `/me/attempts/*/state` rather than a blanket
`/me/attempts/*`.

**What this gives up, stated plainly:** a load balancer is multi-node and self-healing; one Caddy on
one box is not. A reboot is an outage, and at 10–30 events a month that has to be scheduled around.
**The one escape hatch this file keeps open is a warm standby behind a Route 53 health check** —
a second box running the same compose file, a health check at $0.50 a month, and the Elastic IP or
the record moved to it. That is the thing to build if an outage ever costs more than it costs; it
is not a load balancer, and it does not bring a scheduler with it.

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

**RDS PostgreSQL 17 from the start, one instance, a database per environment.** Not a container:
a container has no backups, no point-in-time restore and no storage autoscaling, and the one
operational move nobody should make for the first time under pressure is the one that holds marks.

|                   | Instance                      | Storage            | Cost           |
| ----------------- | ----------------------------- | ------------------ | -------------- |
| Now, staging only | `db.t4g.micro` — 2 vCPU, 1 GB | 20 GB gp3          | $15.33 + $2.62 |
| Production        | `db.t4g.small` — 2 vCPU, 2 GB | 20 GB gp3 → 100 GB | $30.66 + $2.62 |

7-day point-in-time restore on both, **including staging** — it is inside the instance price up to
the allocated storage, and restoring staging from a PITR once is how the procedure gets rehearsed
before it matters.

**Connections decide the size, not load, and on `micro` they decide it early.** RDS derives
`max_connections` from memory: about **112 on a 1 GB instance**, ~225 on 2 GB. The budget is exam 8,
core 25, worker 25 = 58 for production plus 10 for staging = 68. That fits on `micro` with 44
spare — but a second exam container is the thing that exhausts it, not traffic. `.env.example`
carries the arithmetic beside the pool guidance.

Postgres 17 rather than 16 because RDS Extended Support costs $0.114 per vCPU-hour once a version
leaves standard support — more than the instance. 16 leaves on 28 February 2029, 17 on
28 February 2030.

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

**Valkey on Box B, one container per environment** — different ports, different `maxmemory`, one
small box. `appendonly yes` flushed every second, `maxmemory-policy noeviction`.

```
production  :6379   maxmemory 1.2 GB   requirepass
staging     :6380   maxmemory 256 MB   requirepass
```

**A password per process, and it is the third lock rather than the first.** Box B carries a
routable address so it can pull its image, its security group is what keeps the internet off it,
and `PRIVATE_IP` publishes the ports on the VPC address rather than every interface (§8).
`requirepass` is the one that still holds when either of those is edited wrong — and what sits
behind them is every live sitting, every session and every OTP, on the most-scanned port there is.
A password each rather than one shared, so a staging leak cannot open production's keyspace.
The API carries its half in `REDIS_URL` as `redis://:PASSWORD@host:port`, which ioredis parses
itself, so no code changed for it. **`valkey-cli` does not read that URL**, so the healthcheck
takes `REDISCLI_AUTH` from the container's environment — otherwise every container reports
unhealthy on `NOAUTH`, and the password would be a process argument.

**A process each, not one process with two database indexes.** The index would separate the
keyspaces — which matters, because `redis.keys.ts` namespaces keys by FEATURE and BullMQ has no
prefix configured, so a shared instance would put both environments in `bull:scoring:*` and let a
production worker take a staging job. But `maxmemory` is per PROCESS, and under `noeviction` an
instance that fills makes writes FAIL. One process each separates the memory as well as the keys,
so a staging runaway cannot stop production saving a candidate's answers.

`noeviction` is not a preference: BullMQ requires it, and this holds live sittings, so an eviction
policy would silently drop answers. The API refuses to boot in production against anything else.
**Set `maxmemory` explicitly at every size** — unset, Valkey grows until the kernel kills it, and an
OOM-killed Valkey mid-event loses up to a second of answers.

- **ElastiCache Serverless cannot be used at all** — no parameter groups, so the policy cannot be
  set, and BullMQ's own documentation rules it out.
- **The live sitting assumes one node.** The flusher's `MGET` and its settle script span
  `attempt:state:*` and `attempt:dirty` with no hash tags, so Cluster mode would refuse them.
- A node-based `cache.t4g.small` is $23.94 and comes back **empty** after a node failure; no
  current ElastiCache engine writes to disk.

**Box B's size, and what moves it.** CPU never does — Valkey is single-threaded and an event is
about 960 ops/s against a core that does 100,000+. Memory does, and the thing that decides it is
not the dataset but the **AOF rewrite fork**: Valkey rewrites its log by forking, and copy-on-write
can push RSS toward double the dataset while writes are landing.

| Stage                                 | Box B              | Disk  | Why                                                                 |
| ------------------------------------- | ------------------ | ----- | ------------------------------------------------------------------- |
| Now, one tester                       | `t4g.micro`, 1 GB  | 10 GB | Valkey ~300 MB + OS ~350 MB                                         |
| Before the first full-scale load test | `t4g.small`, 2 GB  | 10 GB | 8,000 sittings is a ~100 MB dataset; the rewrite fork can double it |
| Production at 8,000 live sittings     | `t4g.medium`, 4 GB | 20 GB | Both processes, both with headroom                                  |

**The disk is sized by the AOF, not the OS.** Valkey lets the log grow to roughly twice the dataset
before rewriting, and the rewrite writes a second file alongside the first — so plan for about
three times the dataset plus ~3 GB of OS. Ten gigabytes carries staging and a load test; production
holding 1.2 GB of live sittings wants twenty. gp3 gives 3,000 IOPS and 125 MB/s at **any** size, so
a small volume costs nothing in speed — only headroom.

That ~100 MB is sitting state — the catalog keeps one key in Valkey — and the per-sitting figures
behind it (10.2 KB of JSON, 12.1 KB stored) predate the recent work and are unverified (§16).
Scaled to 8,000 candidates they would put an event at roughly 64–120 Mbps and ~57 GB of traffic.

**Traffic between the boxes is free** — same VPC, same zone — but it is not free of latency, and
§3 says what that costs the scoring drain.

## 8. Networking

**No NAT, and nothing to run.** Both boxes sit in the public subnet with an address of their own, so
outbound — SMS, WhatsApp, push, Sentry, log shipping, ECR, image pulls — needs no gateway. The
shape this file used to describe needed a `t4g.nano` NAT instance at $6.42 because its compute was
private; this one does not.

What replaces it is **security groups, not subnets**. A public subnet is only a route table with a
route to an internet gateway: three separate things have to line up before a packet arrives — an
address on the interface, a security group rule, and a NACL — and the subnet is the least of them.
Box A takes 80 and 443 from the world and **nothing else inbound**. Box B takes 6379 and 6380, and
RDS takes 5432, **from Box A's security group** — by group rather than by CIDR, so a replacement or
a second API box inherits the rule by membership. Box B's own address is egress-only in practice:
nothing on the internet has a rule to reach it.

**Docker cannot open a hole in a security group.** Published ports do bypass the host's own
iptables INPUT chain, because the DNAT happens in PREROUTING before filtering — which is why `ufw`
rules famously do not apply to containers. A security group is enforced at the network interface,
outside the instance, so it is a real boundary here rather than a paper one.

**There is no inbound SSH, and that is deliberate.** A port-22 rule pinned to one address holds
only until that address rotates, and what happens then is that somebody widens it at 11pm rather
than fixing it. `arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore` on the instance profile
opens a shell through Session Manager with no inbound rule, no key pair to lose and a transcript,
and it is free.

**IMDSv2 is required at launch** —
`--metadata-options HttpTokens=required,HttpPutResponseHopLimit=2`. A
public-subnet box running Node is one SSRF away from handing over its instance role; IMDSv2 makes
the attacker fetch a token with a PUT first, which an SSRF usually cannot do. The hop limit is 2
rather than the default 1 because the caller is inside a container, one hop further out — at 1 the
SDK in the container cannot reach the metadata service at all.

**Why not a private subnet, since the question comes up.** Box A has to accept 443 from the world,
so serving that from a private subnet needs a load balancer in a public subnet — the thing §4
removed — plus a NAT for egress: the same ports open to the same internet, $16–25 a month more,
and another thing to run. Box B needs egress to pull its image, and every way of giving it that
costs more than its $3.65 address: a NAT instance is $6.42 plus an address of its own, a NAT
gateway ~$32, and ECR and logs interface endpoints ~$22.

**Between the boxes is free and fast, but not free of latency.** Same VPC and same zone, so no
inter-AZ charge (that would be $0.01/GB each way) and no data-transfer charge at all. The cost is
0.1–0.3 ms per round trip against loopback's 50 µs, which §3 works through for the scoring drain.

Internet egress is $0.1093/GB after the 100 GB monthly free tier, and §1 measures what this
platform actually sends.

## 9. Logs, metrics and alarms

The API has no log statement on the **success** path, so CloudWatch ingest stays inside the free
5 GB. A failure is the exception: `AllExceptionsFilter` logs a 4xx as one line, and a 5xx with its
stack **and the request body**, which is the only record of what the caller actually sent.

**A body in a log or a Sentry event goes through `apps/api/src/common/redact.ts` first**, and there
is one of it. `instrument.ts` sets `sendDefaultPii: false` precisely so a mobile number or a PIN
cannot leave inside a stack frame, so a body attached by hand is scrubbed by key word and capped at
2 KB, six levels and twenty array items. Nothing logs a successful response body: at 6K students
autosaving, the exam role alone would write tens of GB an event.

Containers log to Docker's `json-file` driver, **capped in `deploy/compose.yml` at 10 MB × 3 per
container** — the default never rotates, and Box A has 30 GB to lose. An environment that ships to
CloudWatch overrides the driver to `awslogs` there, 14-day retention; nothing in the repo assumes
it, so a box boots and logs whether or not AWS answers. **Caddy's access log is the access log** —
a JSON line per request to a file, rolled by Caddy itself at 100 MiB, with no bucket and no S3
lifecycle to configure because nothing writes access logs to a bucket.

About ten alarms at $0.10 each. **The list changed with the front door**, and an alarm on a metric
that no longer exists is worse than no alarm:

| Watch                          | Where it comes from                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| 5xx rate, request latency      | `iace_http_request_duration_seconds` on `/metrics`, or Caddy's own Prometheus endpoint     |
| A container down               | EC2 status checks on Box A and Box B, plus the Docker restart count                        |
| **`CPUSurplusCreditsCharged`** | The burst surcharge, and the largest gap between the expected and worst-case invoice (§13) |
| CPU, storage, connections      | RDS's own metrics; EC2 status checks on Box B                                              |
| Valkey memory and evictions    | One custom metric, $0.30                                                                   |
| **CloudFront bytes out**       | The one line that can move the bill by an order of magnitude (§15)                         |

**There is no ALB 5xx, no unhealthy-target count and no ECS running count to alarm on, and there
will not be** — those metrics belong to a shape this platform does not run. Everything that would
have depended on them is the app's own `/metrics` or an EC2 status check.

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

## 11. Environment, secrets, DNS and the registry

**The environment file is the unit, not the variable.** One file per environment, at
`deploy/.env` on its box, owned by root and `chmod 600`. Compose reads it twice and for two
different reasons: `--env-file` resolves the `${...}` substitutions in `compose.yml`, and each
service's `env_file` hands the same file to the container as its process environment.

**Nothing in the API fetches configuration at boot.** There is no task definition and no secret
pulled at start: `apps/api/src/config/env.schema.ts` validates `process.env` and nothing else,
which is exactly why the same file behaves identically on a laptop and on a box. Anything that
made the API read AWS to start would also make it unable to start when AWS is the thing that is
broken.

**Three files, and only one of them is real.**

| File                  | Tracked                          | What it is                                                                                            |
| --------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `.env.example`        | yes                              | Every variable the schema knows, with `dev_only_` secrets — local development, and the reference list |
| `deploy/.env.example` | yes                              | The deployed subset, carrying the arithmetic beside the pool size and the heaps                       |
| `deploy/.env`         | **never** — `.gitignore` line 32 | The real one on Box A. It exists on the box and in SSM, and nowhere else                              |
| `deploy/valkey/.env`  | **never**                        | Box B's, carrying `PRIVATE_IP` and a `requirepass` per process (§7)                                   |

**Per-role values are deliberately not in the file.** `API_ROLE`, `UV_THREADPOOL_SIZE`,
`NODE_OPTIONS`, `cpus` and `mem_limit` are set per service in `compose.yml`, because they differ by
role and the file cannot know which of the three containers is reading it. The file carries only
what all three share.

**The SPAs have no runtime environment at all.** `VITE_API_URL` is substituted at compile time
(§14), so for them an environment is a BUILD rather than a variable, and a staging artifact cannot
be promoted to production.

**SSM Parameter Store holds the master copy, and nothing reads it at runtime.** One SecureString
per environment at `/iace/<env>/env`, plus `/iace/valkey/env` for Box B, each holding a whole
file:

```bash
aws ssm put-parameter --name /iace/staging/env --type SecureString --overwrite --value file://deploy/.env
aws ssm get-parameter --name /iace/staging/env --with-decryption --query Parameter.Value --output text > deploy/.env
```

That one command is what makes §2's disposable box true: a replacement pulls its environment
instead of being reassembled by hand at the worst possible moment. **A Standard-tier parameter caps
at 4 KB**, which a fully commented file is close enough to trip — strip the comments before pushing,
or pay $0.05 a month for the Advanced tier. Standard SecureStrings are otherwise free, where
Secrets Manager is $0.40 each for a rotation nothing here uses, and the KMS key is the AWS-managed
one; a customer-managed key is $1 for no gain.

**The instance role is the one credential that never lands in the file.** The box carries an
instance profile, the AWS SDK finds it on its own, and `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`
stay unset in production (`847db3e`) — the API refuses a half-pair, and MinIO locally is the only
thing that needs the pair at all. That profile carries five things and no more: the media bucket,
`ssm:GetParameter` on `/iace/<env>/*` with `kms:Decrypt` on the AWS-managed key, CloudWatch Logs
write, ECR read, and `arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore` — which is what
replaces the port-22 rule (§8) rather than an extra privilege for its own sake.

**What production refuses to boot without**, each refusal naming its own variable rather than
surfacing as a mystery 500 an hour into a live test: `connection_limit` on `DATABASE_URL`, a
non-empty `CORS_ORIGINS`, a `METRICS_TOKEN`, `TRUST_PROXY_HOPS` above zero, a Valkey that cannot
evict, and any of `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` or `PIN_PEPPER` still carrying the
`dev_only_` prefix `.env.example` publishes. It additionally **warns** when the heap in
`NODE_OPTIONS` does not match the container's memory limit, naming the role that is wrong.

- **Route 53**, $0.50 a month: a free ALIAS to CloudFront for the SPAs, and an A record per
  environment to its API box's Elastic IP. **Caddy gets the API certificate itself** (§4), so ACM
  is needed only in us-east-1 for CloudFront, where it is free. The Elastic IP is also the failover
  mechanism — remapping it to a replacement instance takes seconds and needs no DNS propagation.
- **ECR** at $0.10/GB-month with a lifecycle keeping the last ten images, under $0.20.
- GitHub Actions pushes through an OIDC role, so no AWS keys live in GitHub either.

## 12. Non-production

**Its own API box, sharing production's Valkey box and RDS instance.** One EC2 `t4g.medium` running
Caddy and the same three containers — the same shape as production, at a tester's size, because
staging exists to rehearse production rather than a smaller thing.

- **Postgres:** its own database on the shared RDS instance, with `CONNECTION LIMIT 10`,
  `statement_timeout` 30 s and `idle_in_transaction_session_timeout` 60 s on the role, so a staging
  runaway cannot take production's connections or hold its CPU (§6).
- **Valkey:** its own process on Box B, port 6380, `maxmemory` 256 MB (§7).
- **`t4g.medium` while you build on the box; `t4g.small` once images come from ECR.** Three
  containers need ~850 MB at rest, but `pnpm install` and two Vite builds want 2–4 GB.
- **`NODE_ENV=development`, `OTP_SENDER=console`.** An admin signs in with an emailed OTP and a
  student with an SMS one, and the DLT registration behind that SMS does not exist yet; in
  development the API returns the code as `devCode` on the request response, so a tester signs in
  with no provider at all. `CORS_ORIGINS` is still enforced — `corsOrigin` uses the list whenever
  it is non-empty, whatever the mode.

Heaps are 384 MB per container rather than production's 1536/768/768: one tester needs no more.

**Only one DNS record per environment.** CloudFront hands out `*.cloudfront.net` with a valid
certificate, so only the API needs a name Caddy can get a certificate for. Media is the same
unsigned CloudFront URL as production (§10) — a third distribution per environment, which costs
nothing to have.

**Seeded and generated data only — never a restore of production.** Real students' names, mobile
numbers and marks do not belong in a lower-security environment, and while the two share a Valkey
and a Postgres instance that rule is doing more work than usual.

**This box is also the load-testing rig**, and the split from Box B is what makes it worth trusting
— the API box's CPU is the API's alone, and the database is across a network hop, which is the
topology production will have. EC2 bills hourly, so resize to the production candidate for an
afternoon, run the event, resize back: four hours of an instance four times larger costs about a
third of a dollar. That is what settles §3's open question, and it is worth running against two
instance families — one burstable, one not — in the same session.

## 13. When each piece grows, and commitments

Everything here resizes in two minutes — stop, change the instance type, start — and bills hourly.
So the rule is to run the smallest thing that works and move when a named trigger fires, not when
it feels prudent.

| Piece                  | Now                | Moves to                  | When                                                     |
| ---------------------- | ------------------ | ------------------------- | -------------------------------------------------------- |
| Box A′ — staging API   | `t4g.medium`       | `t4g.small`               | Images build in CI and come from ECR                     |
| Box A — production API | —                  | `t4g.large`               | Production exists                                        |
|                        |                    | `t4g.xlarge` for an event | Scheduled, on the event calendar — never reactively (§3) |
| Box B — Valkey         | `t4g.micro`, 10 GB | `t4g.small`               | Before the first full-scale load test                    |
|                        |                    | `t4g.medium`              | Production carries 8,000 live sittings                   |
| RDS                    | `db.t4g.micro`     | `db.t4g.small`            | A second exam container — **connections, not load** (§6) |

**Commit to nothing at launch.** After 4–8 weeks of real events the baseline is known; commit to
70–80% of it so growth and bursts stay on demand.

|                          | On demand | 1-year, no upfront |
| ------------------------ | --------- | ------------------ |
| EC2 `t4g.large` (Box A)  | $32.70    | ~$23.50            |
| EC2 `t4g.small` (Box A′) | $8.18     | ~$5.91             |
| EC2 `t4g.medium` (Box B) | $16.35    | ~$11.75            |
| RDS `db.t4g.small`       | $30.66    | $24.09             |

A Compute Savings Plan covers EC2 in any region and family, so resizing a box stays covered; an RDS
reservation is tied to its instance family, so do not buy one until §3's open question is settled
and the database size is not going to move.

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
3. Run the **migrate** image to completion. It runs `prisma migrate deploy` and exits, and the API
   containers do not start until it has.
4. Recreate the API containers. Each is `tini`-led, so SIGTERM closes Nest and the container exits
   (`b2029d4`). **There is no draining on this shape** — `docker compose up -d` recreates with a
   gap, which is the cost of not having a load balancer.
5. Upload the SPAs: hashed assets **first**, with `max-age=31536000, immutable`; then `index.html`,
   `sw.js` and the manifest with `no-cache`. The other order serves a shell pointing at chunks that
   are not there yet. Invalidate those three paths only — `/*` evicts the whole asset cache for
   nothing, and 1,000 invalidation paths a month are free.
6. **Old `/assets` files are never deleted.** A tab opened before the deploy still lazy-loads a
   chunk by its old name; keeping them costs about a cent a year.
7. **If `deploy/.env` changed, push it back to SSM in the same breath** (§11). A box and its master
   copy that disagree is a failure you only discover while replacing the box.

**The API goes before the SPAs.** An old tab stays on its old bundle until every tab closes, so the
API must take the previous client's requests anyway; the reverse is not true — a new bundle meeting
the old API can send a field the old API strips, and a submit's `last` batch was exactly that: the
sitting ended, the client was told it had, and the answers it carried were gone.

A new service worker installs but **does not activate until every tab of the old one closes** —
there is no `skipWaiting`, deliberately, because a bundle swapped under a sitting in progress is
worse than a stale tab. Deploying and students seeing the new build are different moments.

A release that bumps `STEM_HASH_VERSION` rehashes the bank in the worker as it boots, logging
`Rehashed N question stems`. Until that line, an import can miss a duplicate — hold imports until it.

Never during an event window, and never a migration that moves data without the rehearsal
`docs/superpowers/task-constraints.md` prescribes.

## 15. Deferred

- **The service worker never prunes its cache** (`iace-shell-v1` is a fixed name), so a student's
  device keeps up to ~1.5 MB per deploy they load. The `activate` handler already drops every cache
  whose name is not the current one — it never fires because the name never changes. Stamp the
  build id into `sw.js` and it cleans itself up.
- **Nobody has measured how many megabytes of images a real paper carries, and it is the only line
  that can move the invoice by an order of magnitude.** CloudFront's free tier is 1 TB, which
  across thirty 8,000-candidate events is **4.4 MB of images per sitting**. Above that it is
  $0.109/GB, so 23 MB a sitting would be ~$450 a month. The unsigned urls in §10 are what keep the
  edge cache working, so the bill scales with distinct images rather than with students — but the
  number is still unknown. Measure it off a real paper's Network tab; `MAX_WIDTH` and `QUALITY` in
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
- **PgBouncer, when connections rather than load become the limit.** Not needed on one box: the
  §6 pools fit `db.t4g.small` even at `t4g.2xlarge`. It arrives with a second API box or pools past
  ~80% of `max_connections`, and runs beside the API containers.
  Measured 28 September 2026 with PgBouncer 1.25.2 in transaction mode: all of `pnpm test:db`
  passes through it unchanged, and the scoring bench runs ~1,390 a second against ~1,360 direct.
  Three settings make that true. `max_prepared_statements = 200` (above Prisma's per-connection
  cache of 100) and **no** `pgbouncer=true` on the url — the flag drops the statement cache, and
  scoring fell to ~730 a second at twice the database CPU. `search_path` in
  `track_extra_parameters`, or PgBouncer refuses Prisma's startup. And the migrate container keeps
  a direct url: `migrate deploy` through the pooler left its advisory lock held on an idle server
  connection, so the next one would time out. RDS Proxy is not the alternative — Prisma's
  statements pin every connection, so it pools nothing.

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

**The Graviton multiplier matters most.** It sits underneath every projection in this file, it was
never anything but an assertion, and it is replaced by one command on the first box that exists.
