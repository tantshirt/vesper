import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { GATE_DEFINITIONS } from "./gates";
import { REQUIRED_DOC_KINDS } from "./sponsorIntake";

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// CAPSTONE — the "test everything" end-to-end integration proof for the assembled Vesper admin build.
//
// This is NOT a per-unit test (the 785 unit tests already prove each piece in isolation). Its ONE job
// is to drive the ENTIRE assembled chain through the REAL Convex runtime (convexTest) and prove the
// pieces COMPOSE — that the seams between the 20 stories actually CONNECT in a real flow:
//
//   sponsor intake (6.1/6.2)  →  promotion / the bridge (3.x createPropertyFromDeal)
//     →  gate ceremony (3.1 + 1-2 SoD)  →  mint + confirm + list (3.2/3.3)
//       →  distribution build + fund + push + reconcile (4.1/4.2/3.3 reconcile)
//         →  cross-cutting invariants (1-1 platform_admin wall / INV2 durable denial / append-only
//            audit chain / no non-human approver).
//
// Everything runs under NODE_ENV=test (vitest default), which enables the documented stub seams
// (requireUnsafeStubs / requireStepUp / requireSeedWrites — see security.ts) so the on-chain acts are
// exercisable. Staff authenticate with a WorkOS issuer; consumers (holders) are seeded directly.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const modules = (
  import.meta as unknown as { glob: (p: string) => Record<string, () => Promise<unknown>> }
).glob("./**/*.*s");

// The scope wall (security.ts) keys off a recognized WorkOS user-management issuer — staff MUST present
// one, exactly as sod.test.ts / gates.test.ts do.
const WORKOS_ISSUER = "https://api.workos.com/user_management/client_test";
const workos = (subject: string) => ({ subject, issuer: WORKOS_ISSUER });

const PERIOD = "2026-07";

type T = ReturnType<typeof convexTest>;

async function auditRows(t: T) {
  return await t.run(async (ctx) => ctx.db.query("auditLog").collect());
}
async function auditActions(t: T) {
  return (await auditRows(t)).map((a) => a.action);
}

// Provision a staff member through the REAL internal grant core (rbac.grantRoles → applyGrant) — the
// same crown-jewel path production uses, not a raw staff insert. This proves the grant path composes
// with every downstream permission check.
async function grantStaff(
  t: T,
  s: { workosId: string; email: string; name: string; roles: string[] },
) {
  await t.mutation(internal.rbac.grantRoles, {
    workosId: s.workosId,
    email: s.email,
    name: s.name,
    roles: s.roles as never,
    grantedBy: "Deployment Owner",
  });
}

// Seed a consumer holder (users + holdings) directly — a consumer is a Privy `users` row, never staff,
// so it is created outside the WorkOS wall. Mirrors distributionPay.test.ts's seedHolder.
async function seedHolder(
  t: T,
  propertyId: Id<"properties">,
  privyId: string,
  wallet: string,
  ownershipPct: number,
  costBasis: number,
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      privyId,
      kycStatus: "verified",
      walletAddress: wallet,
      createdAt: Date.now(),
    });
    await ctx.db.insert("holdings", {
      userId,
      propertyId,
      tokenAmount: costBasis,
      ownershipPct,
      costBasis,
    });
    return userId;
  });
}

describe("CAPSTONE — the whole assembled admin chain composes end-to-end", () => {
  test("sponsor deal → promotion → gates → mint/list → distribution → paid, with every seam connected", async () => {
    const t = convexTest(schema, modules);

    // ── Actors ───────────────────────────────────────────────────────────────────────────────────
    // Two DISTINCT ops_diligence signers (gate.sign + mint.execute + distribution.execute), a compliance
    // member, a powerless platform_admin, and a sponsor org + principal — all via the REAL grant/provision
    // internal paths.
    await grantStaff(t, { workosId: "ops1", email: "priya@vesper.co", name: "Priya Desai", roles: ["ops_diligence"] });
    await grantStaff(t, { workosId: "ops2", email: "rahul@vesper.co", name: "Rahul Mendes", roles: ["ops_diligence"] });
    await grantStaff(t, { workosId: "comp1", email: "marcus@vesper.co", name: "Marcus Cole", roles: ["compliance"] });
    await grantStaff(t, { workosId: "pa1", email: "sam@vesper.co", name: "Sam Lee", roles: ["platform_admin"] });

    // Sponsor org + principal member through the internal provisioning path (mints the tenant + member).
    const sponsorOrgId: Id<"sponsorOrgs"> = await t.mutation(internal.sponsor.provisionSponsor, {
      workosId: "sponsor1",
      email: "olivia@monroe-capital.com",
      name: "Olivia Monroe",
      role: "sponsor_principal",
      orgName: "Monroe Capital",
      provisionedBy: "Deployment Owner",
    });
    const sponsor = t.withIdentity(workos("sponsor1"));
    const ops1 = t.withIdentity(workos("ops1"));
    const ops2 = t.withIdentity(workos("ops2"));

    // ══ 1. SPONSOR INTAKE (6.1 / 6.2) ══════════════════════════════════════════════════════════════
    const dealId: Id<"sponsorDeals"> = await sponsor.mutation(api.sponsor.startDeal, {
      propertyName: "The Monroe",
    });

    // The submit gate is REAL: before KYB it refuses on Gate 0.
    await expect(
      sponsor.mutation(api.sponsor.submitDeal, { dealId }),
    ).rejects.toThrow("Complete KYB first");

    // Gate 0 — record a passing KYB (stubbed Middesk seam).
    const kyb = await sponsor.mutation(api.sponsor.recordKyb, { result: "passed" });
    expect(kyb.kybStatus).toBe("passed");

    // After KYB but before the documents, the checklist half of the same gate still refuses.
    await expect(
      sponsor.mutation(api.sponsor.submitDeal, { dealId }),
    ).rejects.toThrow("Upload required documents first");

    // Upload EVERY required document kind (each a `received` row).
    for (const kind of REQUIRED_DOC_KINDS) {
      const res = await sponsor.mutation(api.sponsorIntake.uploadDocument, {
        dealId,
        kind,
        storageRef: `ref://monroe/${kind}.pdf`,
      });
      expect(res.status).toBe("received");
    }

    // NOW the deal submits — KYB passed + all docs received.
    await sponsor.mutation(api.sponsor.submitDeal, { dealId });
    const submitted = await sponsor.query(api.sponsor.getDeal, { dealId });
    expect(submitted?.status).toBe("submitted");

    // ══ 2. PROMOTION — THE BRIDGE (createPropertyFromDeal) ═════════════════════════════════════════
    // Ops finalizes the submitted deal into a gateable property. This is the seam between the sponsor
    // epic (6.x) and the gate/mint/distribution epics (3.x/4.x).
    const promo = await ops1.mutation(api.gates.createPropertyFromDeal, {
      dealId,
      location: "Tampa, FL",
      propertyType: "Multifamily",
      units: 8,
      spvName: "The Monroe LLC",
      offeringSize: 1_240_000,
      targetNetYield: 0.06,
      minInvestment: 50,
    });
    const propertyId = promo.propertyId;
    expect(promo.created).toBe(8);

    // The property row exists, is pre-open, and carries THE tenant link (operatorSponsorOrgId).
    const property = await t.run(async (ctx) => ctx.db.get(propertyId));
    expect(property?.status).toBe("gating");
    expect(property?.operatorSponsorOrgId).toBe(sponsorOrgId);
    expect(property?.fundedPct).toBe(0);

    // 8 pending diligence gates were seeded from the ratified matrix.
    const seededGates = await t.run(async (ctx) =>
      ctx.db.query("diligenceGates").withIndex("by_property", (q) => q.eq("propertyId", propertyId)).collect(),
    );
    expect(seededGates).toHaveLength(GATE_DEFINITIONS.length);
    expect(seededGates.every((g) => g.status === "pending")).toBe(true);
    expect(seededGates.filter((g) => g.multiParty).map((g) => g.gateNo)).toEqual([6]);

    // The deal is burned to its terminal `promoted` state (promoted at most once) with the property linked.
    const promotedDeal = await t.run(async (ctx) => ctx.db.get(dealId));
    expect(promotedDeal?.status).toBe("promoted");
    expect(promotedDeal?.propertyId).toBe(propertyId);

    // THE TENANT LINK WORKS IN A REAL FLOW: the sponsor now sees this property on BOTH read surfaces,
    // scoped purely by the server-resolved operator link (no fixture, no client-supplied org).
    const operated = await sponsor.query(api.sponsorUpdates.myOperatedProperties, {});
    expect(operated.map((p) => p.id)).toContain(propertyId);
    const funding = await sponsor.query(api.sponsorFunding.myOfferingFunding, {});
    expect(funding.find((r) => r.propertyId === propertyId)?.status).toBe("gating");

    // ── INVARIANT (1-1 wall + INV2 durable denial): platform_admin holds NO operational power. It is
    // refused the mint AND leaves a durable rbac.denied.durable trace (written out-of-band from the
    // action via runMutation, so it survives the re-throw — no draining needed, per audit.ts:logDenial).
    await expect(
      t.withIdentity(workos("pa1")).action(api.mint.mintOffering, { propertyId }),
    ).rejects.toThrow("Not permitted: mint.execute");
    const durableDenials = (await auditRows(t)).filter((a) => a.action === "rbac.denied.durable");
    expect(durableDenials).toHaveLength(1);
    expect(durableDenials[0].actor).toBe("sam@vesper.co"); // the named human, never "system"
    expect(durableDenials[0].target).toBe(propertyId);
    expect((durableDenials[0].meta as { permission: string }).permission).toBe("mint.execute");

    // ── The mint GATE WALL (3-1) is live BEFORE the gates are signed: even a permitted ops signer is
    // refused the mint while any gate is unsigned, and the list is refused before any confirmed mint.
    await expect(
      ops1.action(api.mint.mintOffering, { propertyId }),
    ).rejects.toThrow("Cannot mint: every diligence gate must be signed first");
    await expect(
      ops1.mutation(api.mint.listOffering, { propertyId }),
    ).rejects.toThrow("Cannot list: the mint must be confirmed on-chain first");

    // ══ 3. GATE CEREMONY (3.1 + 1-2 SoD) ═══════════════════════════════════════════════════════════
    // Attach a REAL assembled evidence package to gate 1 — evidence with citations, NEVER an approval.
    const packageIds = new Map<number, Id<"evidencePackages">>();
    for (const gateNo of GATE_DEFINITIONS.map((gate) => gate.gateNo)) {
      const packageId = await t.run(async (ctx) =>
        ctx.db.insert("evidencePackages", {
          propertyId,
          gateNo,
          fieldIds: [],
          status: "assembled",
          assembledBy: "marcus@vesper.co",
          assembledAt: Date.now(),
        }),
      );
      packageIds.set(gateNo, packageId);
    }
    const pkgId = packageIds.get(1)!;

    const gateStatus = async () =>
      await ops1.query(api.gates.propertyGateStatus, { propertyId });

    // Sign the seven single-party gates (0-5, 7) as ops1; allGatesSigned stays false throughout.
    for (const gateNo of [0, 1, 2, 3, 4, 5, 7]) {
      const res = await ops1.action(api.gates.signGate, {
        propertyId,
        gateNo,
        evidencePackageId: packageIds.get(gateNo)!,
      });
      expect(res.passed).toBe(true);
      expect((await gateStatus()).allGatesSigned).toBe(false);
    }

    // Gate 6 is multi-party: one distinct signer leaves it pending, a DISTINCT second signer passes it.
    const gate6Evidence = packageIds.get(6)!;
    const g6first = await ops1.action(api.gates.signGate, { propertyId, gateNo: 6, evidencePackageId: gate6Evidence });
    expect(g6first.passed).toBe(false);
    expect((await gateStatus()).allGatesSigned).toBe(false); // still false — needs a 2nd distinct human

    const g6second = await ops2.action(api.gates.signGate, { propertyId, gateNo: 6, evidencePackageId: gate6Evidence });
    expect(g6second.passed).toBe(true);
    expect(g6second.signerCount).toBe(2);

    // NOW every gate is signed.
    expect((await gateStatus()).allGatesSigned).toBe(true);

    // ── INVARIANT (no non-human approver / spine I4): every gate passed, and every one is attributed to
    // a RESOLVED HUMAN NAME — never an AI/system. Gate 6 names BOTH distinct humans; the evidence package
    // is only ever "assembled", never "approved" (a package confers nothing; a human signs).
    const signedGates = await t.run(async (ctx) =>
      ctx.db.query("diligenceGates").withIndex("by_property", (q) => q.eq("propertyId", propertyId)).collect(),
    );
    const HUMAN_NAMES = new Set(["Priya Desai", "Rahul Mendes"]);
    for (const g of signedGates) {
      expect(g.status).toBe("passed");
      expect(g.signedByHuman).toBeTruthy();
      for (const name of (g.signedByHuman ?? "").split(", ")) {
        expect(HUMAN_NAMES.has(name)).toBe(true);
      }
    }
    expect(signedGates.find((g) => g.gateNo === 6)?.signedByHuman).toBe("Priya Desai, Rahul Mendes");
    expect(signedGates.find((g) => g.gateNo === 1)?.evidencePackageId).toBe(pkgId);
    const pkgs = await t.run(async (ctx) =>
      ctx.db.query("evidencePackages").withIndex("by_property", (q) => q.eq("propertyId", propertyId)).collect(),
    );
    expect(pkgs.every((p) => p.status === "assembled")).toBe(true); // never "approved"

    // ══ 4. MINT + CONFIRM + LIST (3.2 / 3.3) ═══════════════════════════════════════════════════════
    // With every gate signed, the mint now succeeds (step-up stub satisfied under NODE_ENV=test).
    const minted = await ops1.action(api.mint.mintOffering, { propertyId });
    expect(minted.minted).toBe(true);
    expect(minted.mint).toBe(`STUB-MINT-${propertyId}`);
    expect(minted.mintStatus).toBe("minting");

    // List is STILL refused — the mint is executed but not on-chain-confirmed (list-only-after-confirm).
    await expect(
      ops1.mutation(api.mint.listOffering, { propertyId }),
    ).rejects.toThrow("Cannot list: the mint must be confirmed on-chain first");

    // Confirm routes through the REAL reconcile apply path (chain-wins) → mintStatus confirmed.
    const confirm = await ops1.mutation(api.mint.confirmMintStub, { propertyId });
    expect(confirm.mintStatus).toBe("confirmed");

    // Now the listing flips gating → open (investor-browsable).
    const listed = await ops1.mutation(api.mint.listOffering, { propertyId });
    expect(listed.status).toBe("open");
    expect(await t.run(async (ctx) => (await ctx.db.get(propertyId))?.status)).toBe("open");

    // ══ 5. DISTRIBUTION (4.1 build → 4.2 fund/push → 3.3 reconcile) ═════════════════════════════════
    // Seed ONE consumer holder on this listed property (costBasis $60k). $400 gross − $100 costs = $300
    // net pool ⇒ implied annual net yield 300×12/60000 = 6.00% = the target, so matchesTarget is true.
    await seedHolder(t, propertyId, "privy_holder_1", "HOLDERWALLET1111111111111111111111111111111", 1.0, 60_000);

    const build = await ops1.mutation(api.distributionBuild.buildDistribution, {
      propertyId,
      period: PERIOD,
      grossRentDollars: 400,
      costsDollars: 100,
    });
    // matchesTarget SHAPE: the builder returns the target evaluation alongside the draft counts.
    expect(build.written).toBe(1);
    expect(build.poolNet).toBe(300);
    expect(build.netTotal).toBe(300);
    expect(typeof build.matchesTarget).toBe("boolean");
    expect(build.matchesTarget).toBe(true);
    expect(build.impliedNetYield).toBe(0.06);

    // The built rows are DRAFT (`scheduled`) — no money has moved, nothing is paid.
    let ledger = await t.run(async (ctx) =>
      (await ctx.db.query("incomeLedger").collect()).filter((r) => r.propertyId === propertyId),
    );
    expect(ledger).toHaveLength(1);
    expect(ledger[0].status).toBe("scheduled");
    expect(ledger[0].txSig).toBeUndefined();

    // Fund the escrow (B1 custody stub) — fund BEFORE push.
    const funded = await ops1.action(api.distributionPay.fundDistributionEscrow, { propertyId, period: PERIOD });
    expect(funded.funded).toBe(true);
    expect(funded.fundedAmount).toBe(300);

    // Push — records each holder's txSig but the row STAYS `scheduled`: Convex NEVER self-settles.
    const pushed = await ops1.action(api.distributionPay.pushDistribution, { propertyId, period: PERIOD });
    expect(pushed.pushed).toBe(1);
    ledger = await t.run(async (ctx) =>
      (await ctx.db.query("incomeLedger").collect()).filter((r) => r.propertyId === propertyId),
    );
    expect(ledger[0].status).toBe("scheduled"); // NOT paid — the push never settles
    expect(typeof ledger[0].txSig).toBe("string");
    expect(ledger[0].txSig).toContain("STUB-DIST-");
    expect(ledger[0].paidAt).toBeUndefined();

    // Confirm routes through the REAL reconcile apply path — the chain owns the scheduled → paid flip.
    const distConfirm = await ops1.mutation(api.distributionPay.confirmDistributionStub, { propertyId, period: PERIOD });
    expect(distConfirm.confirmed).toBe(true);
    ledger = await t.run(async (ctx) =>
      (await ctx.db.query("incomeLedger").collect()).filter((r) => r.propertyId === propertyId),
    );
    expect(ledger[0].status).toBe("paid");
    expect(typeof ledger[0].paidAt).toBe("number");

    // ── INVARIANT: the paid flip is owned by RECONCILE (actor "helius"), never the operator.
    const reconciled = (await auditRows(t)).filter((a) => a.action === "income.reconciled");
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0].actor).toBe("helius");

    // ══ 6. WHOLE-RUN AUDIT CHAIN — the append-only trail records the entire assembled flow in order ══
    const actions = await auditActions(t);
    // Every hop of the chain left its immutable mark.
    expect(actions).toContain("property.created_from_deal");
    // One gate.signed audit per SIGNATURE append: 7 single-party gates + gate 6's TWO distinct signs = 9
    // audit rows across the 8 passed gates (the first, pending sign of gate 6 audits too).
    expect(actions.filter((a) => a === "gate.signed")).toHaveLength(9);
    expect(signedGates.filter((g) => g.status === "passed")).toHaveLength(8); // 8 gates, all passed
    expect(actions).toContain("mint.executed");
    expect(actions).toContain("mint.confirmed");
    expect(actions).toContain("offering.listed");
    expect(actions).toContain("distribution.built");
    expect(actions).toContain("distribution.escrow.funded");
    expect(actions).toContain("distribution.pushed");
    expect(actions).toContain("income.reconciled");
    // And the durable denial the powerless platform_admin earned is on the record.
    expect(actions).toContain("rbac.denied.durable");

    // The chain-confirmation acts are chain-authoritative (actor "helius"), while the human operational
    // acts name the ops human — the two are never conflated.
    const rows = await auditRows(t);
    const mintExec = rows.find((a) => a.action === "mint.executed");
    expect(mintExec?.actor).toBe("priya@vesper.co");
    expect(rows.find((a) => a.action === "mint.confirmed")?.actor).toBe("helius");
    expect(rows.find((a) => a.action === "offering.listed")?.actor).toBe("priya@vesper.co");

    // The audit trail is APPEND-ONLY: no reversal/delete action ever appears for the acts we drove.
    expect(actions).not.toContain("mint.reverted");
    expect(actions).not.toContain("gate.unsigned");
  });
});
