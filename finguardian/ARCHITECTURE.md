# FinGuardian AI — Cloud Architecture

**Standard:** 100% serverless · event-driven · microservices · zero-ops.
**Region:** `ap-south-1` (Mumbai) — all compute, storage, and keys localised for
SEBI / RBI compliance.
**Security baseline:** AES-256 at rest and in transit; per-member KMS key
isolation; immutable CloudTrail/CloudWatch audit on every access and change.

> *Zero-ops* means the platform stays ~99.9% maintenance-free: it runs on fully
> managed services, and operational parameters (tax thresholds, trigger levels,
> feature flags) live in DynamoDB config tables that update **without** a code
> redeployment. There are no servers to patch and no idle cost.

---

## 1. Infrastructure layers

| Layer | Services | Responsibility |
|---|---|---|
| **Frontend & CDN** | AWS Amplify, CloudFront, Flutter / React Native | Cross-platform app; global edge-cached delivery, ultra-low-latency loads. |
| **Gateway & Auth** | API Gateway, Cognito, WAF | Single secure entry; OAuth2 tokens, biometric login, MFA automation. |
| **Compute Engine** | Lambda (Python) | All business logic; runs only on events — no idle cost, no OS patching, no server rot. |
| **Workflow Orchestration** | Step Functions, EventBridge | Long-running, stateful routines (consent waits, inactivity timers) that survive across days without data loss. |
| **Database** | DynamoDB | Auto-scaling NoSQL, single-digit-ms latency. Household model, config state, relationship indices. |
| **AI Processing Brain** | Amazon Bedrock (Claude / GPT-class) | Contextual parsing of CAS PDFs and regulatory circulars into structured changes. |
| **Security & Privacy** | KMS, Secrets Manager | AES-256 everywhere; each family member's records sealed under a unique, cryptographically isolated key. |
| **Queue & Resiliency** | SQS | Buffer + circuit-breaker: if a bank or RTA is down, requests wait safely until it recovers. |
| **Audit & Registry** | CloudTrail, CloudWatch | Immutable log of every access and modification: timestamp, source IP, user ID. |

---

## 2. Network topology & isolation

Strict public/private separation — the public internet only ever touches the
perimeter; the data and AI core has **no direct path to or from the internet**.

```
                          Internet
                             │
              ┌──────────────┴───────────────┐
              │   PUBLIC SUBNET (perimeter)   │
              │   • Route 53 (DNS)            │
              │   • AWS WAF (attack filter)   │
              │   • API Gateway (entry)       │
              └──────────────┬───────────────┘
                             │   (private link only)
              ┌──────────────┴───────────────┐
              │   PRIVATE SUBNET (the vault)  │
              │   • Lambda (app logic)        │
              │   • Bedrock (AI processors)   │
              │   • DynamoDB (master data)    │
              │   • KMS / Secrets Manager     │
              └───────────────────────────────┘
```

---

## 3. The household data model

A single DynamoDB table keys the entire household so one query returns every
member, and ownership is bound to the `UserID`.

```
Table: Households
  PK  FamilyID   "FAM#rao-2007"
  SK  UserID     "U#meera" | "U#arun" | "U#latha" | "U#kabir"

  Query(PK = "FAM#rao-2007")  →  whole family, sorted by UserID

  Attributes per item:
    role            Admin | Co-Owner | View-Only | Minor
    holdings[]      { folio, scheme, plan, units, ownerUserID }
    consentGrants[] { grantee, scope=READ, expiresAt }
    kycStatus       Active | AtRisk | Hold | Suspended

  GUARDRAIL (enforced in every Lambda):
    a redemption / transfer is authorised ONLY when
        requester.UserID == asset.ownerUserID
    → cross-member moves are structurally impossible.
```

---

## 4. Key workflows (Step Functions)

### 4.1 Dynamic consent handshake (Pillar A)

```
StartConsentRequest
  → NotifyMember (SNS → WhatsApp + in-app push)
  → AwaitDigitalHandshake   (waits — could be minutes or days)
      ├─ Approved → GrantScopedReadAccess (READ-only, time-boxed, logged)
      └─ Denied / Timeout → Seal request, no data shared
```

### 4.2 Regulatory watchdog (Pillar B)

```
EventBridge (02:00 IST nightly)
  → Lambda crawlers  (incometax.gov.in · sebi.gov.in · amfiindia.com)
  → new document?  → S3 (raw PDF)
  → Bedrock         → structured rule diff  (e.g. ltcg.equity.exemption)
  → Step Functions (human-in-the-loop)
       admin Approve → DynamoDB config table (atomic update)
                     → all Lambdas read new values next invocation (no deploy)
  → CloudTrail (immutable record of approver + change)
```

### 4.3 Dead Man's Switch (Pillar D)

```
EventBridge inactivity counter
  → 180 days of zero interaction?
       → open 15-day grace window
       → 3 security check-ins (SMS + email + WhatsApp)
            any reply  → reset to 0 (user is alive)
            all lapse  → ARM switch
                       → Lambda assembles holdings history
                       → Bedrock pre-fills Form T3, indemnity bond, AMC letters
                       → KMS-encrypt → S3 → one-time link to nominee
```

---

## 5. Pillar → service mapping

| Pillar | Primary services |
|---|---|
| A · Family Wealth Cloud & Consent | DynamoDB, Step Functions, Cognito, SNS |
| B · Regulatory Watchdog | EventBridge, Lambda, Bedrock, DynamoDB |
| C · KYC Health Watchdog | Lambda, DynamoDB, EventBridge, SNS, Secrets Manager |
| D · Dead Man's Switch | Step Functions, EventBridge, Lambda, Bedrock, S3, KMS |
| E · Buy-the-Dip & De-risking | EventBridge (4 PM IST), Lambda, Step Functions, SQS |
| F · Commission Scanner | S3, Bedrock, Lambda, Step Functions |
| G · Emergency LAMF | API Gateway, Lambda, banking-partner APIs, Secrets Manager, SQS |
| H · Anti-Panic Shield | API Gateway, Lambda, Step Functions (24h timer), DynamoDB |

---

## 6. Compliance & operational guardrails

- **Data residency** — all nodes, volumes, and keys locked to `ap-south-1`.
- **Encryption** — AES-256 at rest/in transit; per-member KMS keys via envelope
  encryption; third-party credentials only in Secrets Manager.
- **Immutable audit** — every transaction routes through append-only
  CloudTrail + CloudWatch (timestamp, source IP, user ID); not alterable by
  users or admins.
- **Resiliency** — SQS circuit-breaker holds requests when an external bank or
  RTA is unavailable, replaying when it recovers.
- **Cost** — serverless baseline drops to zero with no traffic; auto-scales
  instantly with demand; no idle infrastructure.

---

*This document describes the reference design. The companion prototype in this
folder runs entirely in the browser with simulated service calls; every finance
figure it shows is computed locally and is reproducible from the code.*
