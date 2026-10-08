"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import {
  useSignMessage,
  useWallets as useSolanaWallets,
} from "@privy-io/react-auth/solana";
import { useAction, useConvexAuth, useQuery, useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  investGateState,
  shouldHoldForPurchaseRestore,
  formatUsd,
  remainingRegAHeadroom,
  INVEST_COPY,
} from "./invest.helpers";
import {
  SLIDER_MIN,
  SLIDER_MAX,
  QUICK_CHIPS,
  ownershipFraction,
  estMonthlyIncome,
  firstYearBase,
  firstYearDownside,
  rentComponent,
  appreciationComponent,
  isValidInvestAmount,
  formatUsdCents,
  formatSignedUsd,
  formatOwnershipPct,
  formatYieldPct,
  formatMinHint,
  CALC_COPY,
} from "./calculator.helpers";
import {
  PLATFORM_FEE_RATE,
  platformFee,
  totalChargedToday,
  formatMgmtFeeNote,
  ORDER_COPY,
} from "./order.helpers";
import {
  RIGHTS_ACKS,
  allAcknowledged,
  RIGHTS_COPY,
} from "./rights.helpers";
import {
  CONFIRMATION_COPY,
  formatConfirmationRef,
} from "./confirmation.helpers";
import { usePurchase } from "@/lib/solana/usePurchase";

// Whole-dollar add-money bounds — client-side mirror of convex/funding.ts MIN_FUNDING/MAX_FUNDING.
// The mutation is the authoritative validator; these gate the form (required + submit-disabled).
const MIN_ADD = 50;
const MAX_ADD = 1_000_000;

// Story 3.1 · Invest-flow entry — the auth-gated gateway behind Property Detail's "Invest" CTA.
// Unauthenticated → calm passkey/social signup (in place, so the user returns to this property).
// On signup Privy silently pre-generates a self-custodial Solana account; its address is mirrored
// once into the Convex user (audited) and NEVER shown. The invest flow proper (calculator, order,
// settlement) is Epic 4 — this page ends at an honest "account ready → continue" handoff.
export default function InvestPage() {
  const params = useParams<{ id: string }>();
  const propertyId = params.id as Id<"properties">;

  const { ready, authenticated, login } = usePrivy();
  const { isAuthenticated } = useConvexAuth();
  const { wallets: solanaWallets } = useSolanaWallets();
  const { signMessage } = useSignMessage();

  const property = useQuery(api.properties.getWithGates, { id: propertyId });
  const currentUser = useQuery(api.users.currentUser);
  const eligibility = useQuery(api.eligibility.getEligibility, { propertyId });
  const identityRail = useQuery(api.eligibility.getIdentityRailStatus);
  const fundedBalance = useQuery(api.funding.getFundedBalance);
  const fundingRail = useQuery(api.funding.getFundingRailStatus);
  const ensureUser = useMutation(api.users.ensureUser);
  const requestWalletLinkChallenge = useMutation(api.users.requestWalletLinkChallenge);
  const confirmWalletAddress = useMutation(api.users.confirmWalletAddress);
  const recordEligibility = useMutation(api.eligibility.recordEligibility);
  const joinWaitlist = useMutation(api.eligibility.joinWaitlist);
  const addMoney = useMutation(api.funding.addMoney);
  const preparePurchase = useAction(api.purchaseQuote.preparePurchase);
  const activePurchase = useQuery(api.settlement.getActivePurchase, { propertyId });
  const acknowledgeCompletedPurchase = useMutation(api.settlement.acknowledgeCompletedPurchase);
  const purchaseFlow = usePurchase();

  // Local form/submission state for the identity-check + waitlist steps (client-only; the
  // authoritative record lives in Convex). `country` maps to the jurisdiction the mutation records.
  const [country, setCountry] = useState<"us" | "other">("us");
  const [annualIncome, setAnnualIncome] = useState("");
  const [netWorth, setNetWorth] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [linkingWallet, setLinkingWallet] = useState(false);
  const [acknowledgingPurchase, setAcknowledgingPurchase] = useState(false);

  // Add-money form state (client-only; the settled deposit lives in the append-only Convex ledger).
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"card" | "ach">("card");
  const [addingMoney, setAddingMoney] = useState(false);
  const [showAddMore, setShowAddMore] = useState(false);

  // Story 4.1 · Calculator view — a local, button-driven toggle off the funded screen (same idiom
  // as `showAddMore`; the reactive gate-state machine is unchanged). `investAmount` is the raw input
  // string (default "100" for a live projection on first paint); `projection` flips the first-year
  // figure between the base and the −12% downside case. Story 4.3 adds the `rights` view: `acks`
  // holds the per-order checkbox state (reset fresh each entry so consent is deliberate per order).
  // Consent and teach-back remain local until the server prepares an exact, live Offering quote.
  const [view, setView] = useState<"funded" | "calculator" | "order" | "rights">("funded");
  const [investAmount, setInvestAmount] = useState("100");
  const [projection, setProjection] = useState<"base" | "downside">("base");
  const [acks, setAcks] = useState<Record<string, boolean>>({});
  const [teachBackOwnership, setTeachBackOwnership] = useState("");
  const [teachBackLiquidity, setTeachBackLiquidity] = useState("");
  const [flowError, setFlowError] = useState<string | null>(null);
  const stageHeadingRef = useRef<HTMLHeadingElement>(null);

  // Resolve the embedded Solana address. Select ONLY the Privy-embedded wallet. Never fall back to
  // `solanaWallets[0]`: a user may have an external Solana wallet ordered first, and mirroring that as
  // the settlement routing key would link an account we did not pre-generate. If the embedded
  // wallet isn't resolvable yet, the `provisioning` gate covers the gap (we never write null).
  // A Convex wallet is trusted only after the signed challenge has been verified server-side.
  const embeddedSolana = solanaWallets?.find(
    (w) => (w.standardWallet as { isPrivyWallet?: boolean }).isPrivyWallet === true,
  );
  const resolvedAddress = currentUser?.walletAddress ?? null;

  // Provision the Convex user once Convex has accepted the Privy token (idempotent server-side).
  useEffect(() => {
    if (isAuthenticated && currentUser === null) {
      ensureUser().catch(() => {});
    }
  }, [isAuthenticated, currentUser, ensureUser]);

  async function verifyEmbeddedWallet() {
    if (linkingWallet || !embeddedSolana || currentUser === null) return;
    setLinkingWallet(true);
    setFlowError(null);
    try {
      const challenge = await requestWalletLinkChallenge({ walletAddress: embeddedSolana.address });
      const { signature } = await signMessage({
        message: new TextEncoder().encode(challenge.message),
        wallet: embeddedSolana,
      });
      const signatureBase64 = btoa(String.fromCharCode(...signature));
      await confirmWalletAddress({ challengeId: challenge.challengeId, signature: signatureBase64 });
    } catch (error) {
      setFlowError(error instanceof Error ? error.message : "Wallet verification could not be completed.");
    } finally {
      setLinkingWallet(false);
    }
  }

  useEffect(() => {
    stageHeadingRef.current?.focus();
  }, [view, activePurchase?.status]);

  // The per-property eligibility doc (undefined = query still resolving, null = no doc yet).
  const eligibilityLoaded = eligibility !== undefined;
  const eligible = eligibility == null ? null : eligibility.eligible;
  // The account-level balance query (undefined = still resolving). Held on `loading` while unresolved
  // so `funding` never flashes for an already-funded user.
  const balanceLoaded = fundedBalance !== undefined;
  // Hold the loading affordance until the reactive user resolves, so a returning verified user
  // never flashes the identity-check step before their status is known.
  const userLoaded = !authenticated || currentUser !== undefined;

  const rawState = investGateState({
    privyReady: ready,
    isAuthenticated: authenticated,
    walletAddress: resolvedAddress,
    propertyLoaded: property !== undefined,
    propertyFound: property != null,
    kycStatus: currentUser?.kycStatus ?? null,
    eligibilityLoaded,
    eligible,
    balanceLoaded,
    fundedBalance: fundedBalance ?? null,
  });
  const state = !userLoaded && rawState !== "loading" ? "loading" : rawState;

  // Submit the development-only identity simulation. Production never renders this form: the
  // identity-rail capability query presents an explicit unavailable state until a provider is wired.
  async function submitIdentityCheck(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setFlowError(null);
    try {
      await recordEligibility({
        propertyId,
        jurisdiction: country === "us" ? "United States" : "Somewhere else",
        annualIncome: Number(annualIncome) || 0,
        netWorth: Number(netWorth) || 0,
        verified: true,
      });
    } catch {
      setFlowError(INVEST_COPY.genericFormError);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitWaitlist() {
    if (joining) return;
    setJoining(true);
    try {
      await joinWaitlist({
        propertyId,
        jurisdiction: eligibility?.jurisdiction ?? (country === "us" ? "United States" : "Somewhere else"),
      });
      setJoined(true);
    } catch {
      // Idempotent server-side; a transient failure just leaves the CTA available to retry.
    } finally {
      setJoining(false);
    }
  }

  // Whole-dollar client validation mirroring the mutation's rule — gates the submit button.
  const amountNum = Number(amount);
  const amountValid =
    amount.trim() !== "" &&
    Number.isInteger(amountNum) &&
    amountNum >= MIN_ADD &&
    amountNum <= MAX_ADD;

  // Record a settled deposit through the (stubbed) on-ramp. The client-supplied amount is validated
  // here and re-validated authoritatively by the mutation; the reactive balance reflects the result.
  async function submitAddMoney(e: React.FormEvent) {
    e.preventDefault();
    if (addingMoney || !amountValid) return;
    setAddingMoney(true);
    setFlowError(null);
    try {
      await addMoney({ amountUsd: amountNum, method });
      setAmount("");
      setShowAddMore(false);
    } catch (err) {
      setFlowError(err instanceof Error ? err.message : INVEST_COPY.genericFormError);
    } finally {
      setAddingMoney(false);
    }
  }

  async function authorizePurchase(pid: Id<"properties">, amountUsd: number) {
    if (!allAcknowledged(acks) || purchaseFlow.status === "building" || purchaseFlow.status === "signing") return;
    setFlowError(null);
    try {
      const operation = await preparePurchase({
        propertyId: pid,
        amountUsd,
        acknowledgedRiskIds: RIGHTS_ACKS.filter((a) => acks[a.id] === true).map((a) => a.id),
        teachBackOwnership,
        teachBackLiquidity,
      });
      await purchaseFlow.purchase(operation.operationId);
    } catch (error) {
      setFlowError(error instanceof Error ? error.message : "This order could not be prepared.");
    }
  }

  const addMoneyForm = (
    <form className="card inv-form" onSubmit={submitAddMoney}>
      <label className="inv-field">
        <span className="inv-label">{INVEST_COPY.fundingAmountLabel}</span>
        <input
          className="inv-input"
          type="number"
          min={MIN_ADD}
          max={MAX_ADD}
          step="1"
          inputMode="numeric"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      <label className="inv-field">
        <span className="inv-label">{INVEST_COPY.fundingMethodLabel}</span>
        <select
          className="inv-input"
          value={method}
          onChange={(e) => setMethod(e.target.value as "card" | "ach")}
        >
          <option value="card">{INVEST_COPY.fundingMethodCard}</option>
          <option value="ach">{INVEST_COPY.fundingMethodBank}</option>
        </select>
      </label>
      <p className="muted">{INVEST_COPY.fundingAmountHint}</p>
      {flowError && <p className="form-error" role="alert">{flowError}</p>}
      <button
        className="cta"
        type="submit"
        disabled={addingMoney || !amountValid}
        aria-disabled={addingMoney || !amountValid}
      >
        {addingMoney ? INVEST_COPY.fundingSubmitting : INVEST_COPY.fundingCta}
      </button>
    </form>
  );

  // Reg A+ per-investor limit, shown calmly on both add-money screens (carried over from the Story
  // 3.2 eligible screen). Show the ACTUAL yearly cap (floored), not remaining headroom, so the value
  // matches the "limit" label — `remainingRegAHeadroom(x, 0)` just floors/clamps. Hide when the cap
  // is 0 (or absent) so we never paint a "$0 limit" wall (the never-a-wall intent).
  const regaLimit = currentUser?.regAAnnualLimit;
  const regaLimitRow =
    typeof regaLimit === "number" && regaLimit > 0 ? (
      <div className="card">
        <div className="row">
          <span className="muted">{INVEST_COPY.regaLimitLabel}</span>
          <b className="inv-headroom">{formatUsd(remainingRegAHeadroom(regaLimit, 0))}</b>
        </div>
        <p className="muted">{INVEST_COPY.regaLimitNote}</p>
      </div>
    ) : null;

  const p = property?.property ?? null;

  if (shouldHoldForPurchaseRestore(isAuthenticated, activePurchase)) {
    return (
      <main className="wrap" aria-live="polite">
        <p className="muted" role="status">Checking your saved purchase...</p>
      </main>
    );
  }

  if (activePurchase) {
    const operationStatus = activePurchase.status;
    const complete = operationStatus === "complete";
    const reconciling = operationStatus === "confirmed_on_chain" || operationStatus === "reconciling";
    const submitted = operationStatus === "submitted" || operationStatus === "outcome_unknown";
    const awaiting = operationStatus === "prepared" || operationStatus === "awaiting_authorization";
    const confirmationRef = formatConfirmationRef(activePurchase.operationId);
    const savedSignature = activePurchase.signature ?? purchaseFlow.signature;
    const title = complete
      ? CONFIRMATION_COPY.title
      : reconciling
        ? "Payment confirmed"
        : submitted
          ? "Purchase submitted"
          : "Order ready to authorize";
    return (
      <main className="wrap" aria-live="polite">
        <p className="eyebrow"><span className="dot" /> {CONFIRMATION_COPY.eyebrow}</p>
        <h1 ref={stageHeadingRef} tabIndex={-1}>{title}</h1>
        {p && <p className="muted">{p.name} · {p.location}</p>}
        <div className="card">
          <div className="calc-row">
            <span className="muted">Investment</span>
            <b className="calc-figure">{formatUsdCents(activePurchase.amountUsd)}</b>
          </div>
          <div className="calc-row">
            <span className="muted">Payment</span>
            <b className="calc-figure">
              {awaiting ? "Not submitted" : complete || reconciling ? "Confirmed" : "May have completed"}
            </b>
          </div>
          <div className="calc-row">
            <span className="muted">Ownership</span>
            <b className="calc-figure">
              {complete ? "Updated" : reconciling ? "Updating" : awaiting ? "Not changed" : "Checking"}
            </b>
          </div>
          <div className="calc-row">
            <span className="muted">{CONFIRMATION_COPY.referenceLabel}</span>
            <b className="calc-figure">{confirmationRef}</b>
          </div>
          <p className="muted">{activePurchase.lastCheckpoint}</p>
        </div>
        {awaiting && (
          <button
            className="cta"
            type="button"
            disabled={["building", "signing"].includes(purchaseFlow.status)}
            onClick={() => void purchaseFlow.purchase(activePurchase.operationId)}
          >
            {purchaseFlow.status === "signing" ? "Waiting for authorization..." : "Authorize purchase"}
          </button>
        )}
        {(submitted || reconciling) && savedSignature && (
          <button
            className="cta"
            type="button"
            disabled={purchaseFlow.status === "checking"}
            onClick={() => void purchaseFlow.checkStatus(activePurchase.operationId, savedSignature)}
          >
            {purchaseFlow.status === "checking" ? "Checking..." : "Check status"}
          </button>
        )}
        {purchaseFlow.error && <p className="form-error" role="alert">{purchaseFlow.error}</p>}
        {complete && <Link className="cta" href="/app/portfolio">{CONFIRMATION_COPY.portfolioCta}</Link>}
        {complete && (
          <button
            className="cta ghost"
            type="button"
            disabled={acknowledgingPurchase}
            onClick={async () => {
              setAcknowledgingPurchase(true);
              try {
                await acknowledgeCompletedPurchase({ operationId: activePurchase.operationId });
              } finally {
                setAcknowledgingPurchase(false);
              }
            }}
          >
            {acknowledgingPurchase ? "Closing..." : "Done"}
          </button>
        )}
        {complete && p && (
          <p className="muted"><Link href={`/app/property/${p._id}/proof`}>{CONFIRMATION_COPY.proofLinkLabel}</Link></p>
        )}
      </main>
    );
  }

  if (state === "loading") {
    return (
      <main className="wrap">
        <p className="muted" role="status">{INVEST_COPY.loadingLabel}</p>
      </main>
    );
  }

  if (state === "not-found") {
    return (
      <main className="wrap">
        <p className="muted">
          {INVEST_COPY.notFoundTitle}.{" "}
          <Link href="/app/explore">{INVEST_COPY.notFoundCta}</Link>
        </p>
      </main>
    );
  }

  if (state === "signup") {
    return (
      <main className="wrap">
        <p className="eyebrow"><span className="dot" /> {INVEST_COPY.brandEyebrow}</p>
        <h1>{INVEST_COPY.signupTitle}</h1>
        {p && (
          <p className="muted">
            {INVEST_COPY.signupContext} {p.name} · {p.location}
          </p>
        )}
        <p className="muted">{INVEST_COPY.signupBody}</p>
        <button className="cta" onClick={() => login()}>
          {INVEST_COPY.signupCta}
        </button>
      </main>
    );
  }

  if (state === "provisioning") {
    return (
      <main className="wrap" aria-live="polite">
        <p className="eyebrow"><span className="dot" /> {INVEST_COPY.brandEyebrow}</p>
        <h1 ref={stageHeadingRef} tabIndex={-1}>{INVEST_COPY.provisioningTitle}</h1>
        <p className="muted">{INVEST_COPY.provisioningBody}</p>
        {embeddedSolana && currentUser && !currentUser.walletAddress && (
          <button className="cta" type="button" disabled={linkingWallet} onClick={() => void verifyEmbeddedWallet()}>
            {linkingWallet ? "Verifying..." : "Verify account"}
          </button>
        )}
        {flowError && <p className="form-error" role="alert">{flowError}</p>}
      </main>
    );
  }

  if (state === "kyc") {
    if (identityRail === undefined) {
      return (
        <main className="wrap">
          <p className="muted" role="status">{INVEST_COPY.loadingLabel}</p>
        </main>
      );
    }

    if (!identityRail.available || !identityRail.developmentSimulation) {
      return (
        <main className="wrap">
          <p className="eyebrow"><span className="dot" /> {INVEST_COPY.brandEyebrow}</p>
          <h1 ref={stageHeadingRef} tabIndex={-1}>{INVEST_COPY.kycUnavailableTitle}</h1>
          {p && <p className="muted">{p.name} · {p.location}</p>}
          <section className="card inv-form" aria-labelledby="identity-unavailable-heading">
            <h2 id="identity-unavailable-heading">Verification paused</h2>
            <p className="muted">{INVEST_COPY.kycUnavailableBody}</p>
            <Link className="cta" href={p ? `/app/property/${p._id}` : "/app/explore"}>
              {INVEST_COPY.kycUnavailableCta}
            </Link>
          </section>
        </main>
      );
    }

    return (
      <main className="wrap">
        <p className="eyebrow"><span className="dot" /> {INVEST_COPY.brandEyebrow}</p>
        <h1>{INVEST_COPY.kycTitle}</h1>
        {p && (
          <p className="muted">{p.name} · {p.location}</p>
        )}
        <p className="muted">{INVEST_COPY.kycBody}</p>
        <p className="muted" role="status">{INVEST_COPY.kycDevelopmentNote}</p>
        {currentUser?.kycStatus === "failed" && (
          <p className="muted" role="status">{INVEST_COPY.kycRetryNote}</p>
        )}
        <form className="card inv-form" onSubmit={submitIdentityCheck}>
          <label className="inv-field">
            <span className="inv-label">{INVEST_COPY.kycCountryLabel}</span>
            <select
              className="inv-input"
              value={country}
              onChange={(e) => setCountry(e.target.value as "us" | "other")}
            >
              <option value="us">{INVEST_COPY.kycCountryUs}</option>
              <option value="other">{INVEST_COPY.kycCountryOther}</option>
            </select>
          </label>
          <label className="inv-field">
            <span className="inv-label">{INVEST_COPY.kycIncomeLabel}</span>
            <input
              className="inv-input"
              type="number"
              min="0"
              inputMode="numeric"
              required
              value={annualIncome}
              onChange={(e) => setAnnualIncome(e.target.value)}
            />
          </label>
          <label className="inv-field">
            <span className="inv-label">{INVEST_COPY.kycNetWorthLabel}</span>
            <input
              className="inv-input"
              type="number"
              min="0"
              inputMode="numeric"
              required
              value={netWorth}
              onChange={(e) => setNetWorth(e.target.value)}
            />
          </label>
          <p className="muted">{INVEST_COPY.kycAmountHint}</p>
          {flowError && <p className="form-error" role="alert">{flowError}</p>}
          <button className="cta" type="submit" disabled={submitting} aria-disabled={submitting}>
            {submitting ? INVEST_COPY.kycSubmitting : INVEST_COPY.kycCta}
          </button>
        </form>
      </main>
    );
  }

  if (state === "restricted") {
    return (
      <main className="wrap">
        <p className="eyebrow"><span className="dot" /> {INVEST_COPY.brandEyebrow}</p>
        <h1>{INVEST_COPY.restrictedTitle}</h1>
        {p && (
          <p className="muted">{p.name} · {p.location}</p>
        )}
        <div className="card">
          <p className="muted">{INVEST_COPY.restrictedBody}</p>
          {joined ? (
            <p className="ok"><span aria-hidden="true">✓</span> {INVEST_COPY.restrictedConfirm}</p>
          ) : (
            <button
              className="cta"
              onClick={submitWaitlist}
              disabled={joining}
              aria-disabled={joining}
            >
              {joining ? INVEST_COPY.restrictedSubmitting : INVEST_COPY.restrictedCta}
            </button>
          )}
        </div>
      </main>
    );
  }

  if (state === "funding") {
    // Eligible, zero balance → the calm Add Money form (the fiat-native on-ramp surface).
    return (
      <main className="wrap">
        <p className="eyebrow"><span className="dot" /> {INVEST_COPY.fundingEyebrow}</p>
        <h1>{INVEST_COPY.fundingTitle}</h1>
        {p && (
          <p className="muted">{p.name} · {p.location}</p>
        )}
        <p className="muted">{INVEST_COPY.fundingBody}</p>
        {regaLimitRow}
        {fundingRail?.available ? addMoneyForm : (
          <div className="card" role="status">
            <b>Adding money is currently unavailable</b>
            <p className="muted">A verified funding provider has not been connected. No payment can be accepted here yet.</p>
          </div>
        )}
      </main>
    );
  }

  // state === "funded", view === "calculator" — Story 4.1 live projection. Reads the loaded
  // property's basis (offeringSize / targetNetYield / minInvestment) and recomputes every figure
  // on each render from `investAmount` (no debounce): typing, dragging the slider, or tapping a
  // quick chip all flow through `setInvestAmount`. Pure projection only — no order/fee/funding.
  if (state === "funded" && view === "calculator" && p) {
    const offeringSize = p.offeringSize;
    const targetNetYield = p.targetNetYield;
    const minInvestment = p.minInvestment;

    const amountNum = Number(investAmount);
    const valid = isValidInvestAmount(amountNum, minInvestment);

    // Project from a non-negative amount so a typed "-100" (the number field's `min=0` doesn't block
    // typed negatives) shows a neutral $0.00 / 0.0000% projection rather than negative figures painted
    // in positive color. Validity stays on the raw input, so the min hint + disabled CTA still fire.
    const projAmount = Number.isFinite(amountNum) ? Math.max(0, amountNum) : 0;

    const own = ownershipFraction(projAmount, offeringSize);
    const monthly = estMonthlyIncome(projAmount, targetNetYield);
    const rent = rentComponent(projAmount, targetNetYield);
    const appreciation = appreciationComponent(projAmount);
    const firstYear =
      projection === "downside" ? firstYearDownside(projAmount) : firstYearBase(projAmount, targetNetYield);
    // The slider control is bounded to SLIDER_MIN..SLIDER_MAX; a blank/out-of-range amount clamps
    // the thumb without altering the typed input (the input remains the source of truth).
    const sliderValue = Number.isFinite(amountNum)
      ? Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, amountNum))
      : SLIDER_MIN;

    return (
      <main className="wrap">
        <button type="button" className="calc-back" onClick={() => setView("funded")}>
          {CALC_COPY.backLabel}
        </button>
        <p className="eyebrow"><span className="dot" /> {CALC_COPY.eyebrow}</p>
        <h1>{CALC_COPY.title}</h1>
        <p className="muted">
          {p.name} · {formatYieldPct(targetNetYield)} · {p.location}
        </p>

        <div className="card">
          <label className="inv-field">
            <span className="inv-label">{CALC_COPY.amountLabel}</span>
            <div className="calc-amount">
              <span className="calc-amount-sign" aria-hidden="true">$</span>
              <input
                className="calc-amount-input"
                type="number"
                inputMode="numeric"
                min={0}
                step="1"
                value={investAmount}
                onChange={(e) => setInvestAmount(e.target.value)}
                aria-label={CALC_COPY.amountInputLabel}
              />
            </div>
          </label>
          <input
            className="calc-range"
            type="range"
            min={SLIDER_MIN}
            max={SLIDER_MAX}
            step={1}
            value={sliderValue}
            onChange={(e) => setInvestAmount(e.target.value)}
            aria-label={CALC_COPY.sliderLabel}
            aria-valuetext={formatUsd(sliderValue)}
          />
          <div className="calc-chips">
            {QUICK_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                className={`chip${amountNum === chip ? " on" : ""}`}
                onClick={() => setInvestAmount(String(chip))}
              >
                {formatUsd(chip)}
              </button>
            ))}
          </div>
          {!valid && <p className="calc-hint" role="status">{formatMinHint(minInvestment)}</p>}
        </div>

        <div className="card">
          <p className="calc-proj-head">{CALC_COPY.projectionHeading}</p>
          <div className="calc-row">
            <span className="muted">{CALC_COPY.ownLabel}</span>
            <b className="calc-figure">{formatOwnershipPct(own)}</b>
          </div>
          <div className="calc-row">
            <span className="muted">{CALC_COPY.monthlyLabel}</span>
            <b className="calc-figure calc-pos">{formatSignedUsd(monthly)}</b>
          </div>
          <div className="calc-fy">
            <div className="calc-row">
              <span className="muted">{CALC_COPY.firstYearLabel}</span>
              <b className={`calc-figure ${projection === "downside" ? "calc-neg" : "calc-pos"}`}>
                {formatSignedUsd(firstYear)}
              </b>
            </div>
            <div className="calc-seg" role="group" aria-label={CALC_COPY.firstYearLabel}>
              <button
                type="button"
                className={`calc-seg-btn${projection === "base" ? " on" : ""}`}
                aria-pressed={projection === "base"}
                onClick={() => setProjection("base")}
              >
                {CALC_COPY.baseToggle}
              </button>
              <button
                type="button"
                className={`calc-seg-btn${projection === "downside" ? " on" : ""}`}
                aria-pressed={projection === "downside"}
                onClick={() => setProjection("downside")}
              >
                {CALC_COPY.downsideToggle}
              </button>
            </div>
            {projection === "downside" ? (
              <p className="muted calc-item">{CALC_COPY.downsideExplainer}</p>
            ) : (
              <p className="muted calc-item">
                {formatUsdCents(rent)} {CALC_COPY.rentLabel} · {formatUsdCents(appreciation)}{" "}
                {CALC_COPY.appreciationLabel}
              </p>
            )}
          </div>
        </div>

        <button
          className="cta"
          disabled={!valid}
          aria-disabled={!valid}
          onClick={() => setView("order")}
        >
          {CALC_COPY.reviewCta}
        </button>
      </main>
    );
  }

  // state === "funded", view === "order" — Story 4.2 fee-transparent order preview: a local `view`
  // between the calculator and the rights step (4.3), same idiom as 4.1's funded → calculator.
  // Shows the investment, the one-time 0.9% platform fee, and the total charged today, plus the
  // no-double-charge management-fee note. Reuses the calculator's `projAmount` clamp; the fee rate and
  // yield derive from PLATFORM_FEE_RATE / property.targetNetYield (no hardcoded digits). No order
  // record or persistence here — the order is created and settled atomically in Story 4.4. Back
  // returns to the calculator with the amount intact; Continue advances into the rights step (4.3),
  // entered fresh (all boxes unchecked) so consent is deliberate per order.
  if (state === "funded" && view === "order" && p) {
    const targetNetYield = p.targetNetYield;
    const amountNum = Number(investAmount);
    const projAmount = Number.isFinite(amountNum) ? Math.max(0, amountNum) : 0;

    return (
      <main className="wrap">
        <button type="button" className="calc-back" onClick={() => setView("calculator")}>
          {ORDER_COPY.backLabel}
        </button>
        <p className="eyebrow"><span className="dot" /> {ORDER_COPY.eyebrow}</p>
        <h1>{ORDER_COPY.title}</h1>
        <p className="muted">
          {p.name} · {formatYieldPct(targetNetYield)} · {p.location}
        </p>

        <div className="card">
          <div className="calc-row">
            <span className="muted">{ORDER_COPY.investmentLabel}</span>
            <b className="calc-figure">{formatUsdCents(projAmount)}</b>
          </div>
          <div className="calc-row">
            <span className="muted">
              {ORDER_COPY.platformFeeLabel} ({formatYieldPct(PLATFORM_FEE_RATE)})
            </span>
            <b className="calc-figure">{formatUsdCents(platformFee(projAmount))}</b>
          </div>
          <div className="calc-row order-total">
            <span className="muted">{ORDER_COPY.totalLabel}</span>
            <b className="calc-figure">{formatUsdCents(totalChargedToday(projAmount))}</b>
          </div>
        </div>

        <p className="muted">{formatMgmtFeeNote(targetNetYield)}</p>

        <button
          type="button"
          className="cta"
          onClick={() => {
            setAcks({});
            setTeachBackOwnership("");
            setTeachBackLiquidity("");
            setFlowError(null);
            setView("rights");
          }}
        >
          {ORDER_COPY.continueCta}
        </button>
      </main>
    );
  }

  // state === "funded", view === "rights" — Story 4.3 active-consent gate now wired to Story 4.4's
  // atomic settlement. Renders the three RIGHTS_ACKS as accessible checkbox rows; Confirm is enabled
  // ONLY when `allAcknowledged(acks)` is true and no settle is in flight (both `disabled` and
  // `aria-disabled` mirrors the gate. The backend reads the live Offering before it reserves an order;
  // the browser never supplies token count, price, fee, or payment-account authority.
  if (state === "funded" && view === "rights" && p) {
    const acknowledged = allAcknowledged(acks);
    const amountNum = Number(investAmount);
    const projAmount = Number.isFinite(amountNum) ? Math.max(0, amountNum) : 0;

    const understood =
      teachBackOwnership === "spv-ownership" &&
      teachBackLiquidity === "buyer-dependent-resale";
    const busy = purchaseFlow.status === "building" || purchaseFlow.status === "signing";

    return (
      <main className="wrap">
        <button type="button" className="calc-back" onClick={() => setView("order")}>
          {RIGHTS_COPY.backLabel}
        </button>
        <p className="eyebrow"><span className="dot" /> {RIGHTS_COPY.eyebrow}</p>
        <h1>{RIGHTS_COPY.title}</h1>
        <p className="muted">{p.name} · {p.location}</p>
        <p className="muted">{RIGHTS_COPY.intro}</p>

        <div className="card">
          <div className="ack-list" role="group" aria-label={RIGHTS_COPY.title}>
            {RIGHTS_ACKS.map((ack) => (
              <label className="ack-item" key={ack.id}>
                <input
                  type="checkbox"
                  checked={acks[ack.id] === true}
                  onChange={(e) => {
                    setFlowError(null);
                    setAcks((prev) => ({ ...prev, [ack.id]: e.target.checked }));
                  }}
                />
                <span>{ack.label}</span>
              </label>
            ))}
          </div>
        </div>

        <fieldset className="card inv-form">
          <legend className="inv-label">What are you buying?</legend>
          <label className="ack-item">
            <input
              type="radio"
              name="ownership-check"
              value="spv-ownership"
              checked={teachBackOwnership === "spv-ownership"}
              onChange={(event) => setTeachBackOwnership(event.target.value)}
            />
            <span>An ownership interest in the property&apos;s legal entity</span>
          </label>
          <label className="ack-item">
            <input
              type="radio"
              name="ownership-check"
              value="direct-title"
              checked={teachBackOwnership === "direct-title"}
              onChange={(event) => setTeachBackOwnership(event.target.value)}
            />
            <span>My name directly on the property title</span>
          </label>
          {teachBackOwnership === "direct-title" && (
            <p className="form-error" role="status">You receive an interest in the property&apos;s legal entity, not direct title.</p>
          )}
        </fieldset>

        <fieldset className="card inv-form">
          <legend className="inv-label">When can you get your money back?</legend>
          <label className="ack-item">
            <input
              type="radio"
              name="liquidity-check"
              value="buyer-dependent-resale"
              checked={teachBackLiquidity === "buyer-dependent-resale"}
              onChange={(event) => setTeachBackLiquidity(event.target.value)}
            />
            <span>Only when a permitted sale finds a buyer; timing is not guaranteed</span>
          </label>
          <label className="ack-item">
            <input
              type="radio"
              name="liquidity-check"
              value="on-demand"
              checked={teachBackLiquidity === "on-demand"}
              onChange={(event) => setTeachBackLiquidity(event.target.value)}
            />
            <span>Whenever I request a withdrawal</span>
          </label>
          {teachBackLiquidity === "on-demand" && (
            <p className="form-error" role="status">Resale depends on eligibility and finding a buyer. It is not an on-demand withdrawal.</p>
          )}
        </fieldset>

        <button
          type="button"
          className="cta"
          disabled={!acknowledged || !understood || busy}
          aria-disabled={!acknowledged || !understood || busy}
          onClick={() => void authorizePurchase(p._id, projAmount)}
        >
          {busy ? RIGHTS_COPY.submittingLabel : "Authorize purchase"}
        </button>
        {flowError && <p className="form-error" role="alert">{flowError} No payment was submitted.</p>}
        {purchaseFlow.error && <p className="form-error" role="alert">{purchaseFlow.error}</p>}
      </main>
    );
  }

  // state === "funded", view === "funded" — account-level balance in dollars, "Add more"
  // affordance, then the Story 4.1 handoff into the calculator. Balance is the same across every
  // property (account-level).
  const balance = typeof fundedBalance === "number" ? fundedBalance : 0;
  const fundingUnavailable = fundingRail !== undefined && !fundingRail.available;
  return (
    <main className="wrap">
      <p className="eyebrow"><span className="dot" /> {INVEST_COPY.fundedEyebrow}</p>
      <h1>{INVEST_COPY.fundedTitle}</h1>
      {p && (
        <p className="muted">{p.name} · {p.location}</p>
      )}
      <div className="card">
        <div className="row">
          <span className="muted">{INVEST_COPY.fundedBalanceLabel}</span>
          <b className="inv-headroom">{formatUsd(balance)}</b>
        </div>
        <p className="muted">{INVEST_COPY.fundedBalanceNote}</p>
      </div>
      {regaLimitRow}
      {fundingUnavailable ? (
        <div className="card" role="status">
          <b>Purchases are not yet available</b>
          <p className="muted">The displayed balance is an account record only. A verified funding provider must fund your payment account before a purchase can be authorized.</p>
        </div>
      ) : showAddMore ? (
        addMoneyForm
      ) : (
        <button className="cta ghost" onClick={() => setShowAddMore(true)}>
          {INVEST_COPY.fundedAddMore}
        </button>
      )}
      {!fundingUnavailable && (
        <button className="cta" onClick={() => setView("calculator")}>{INVEST_COPY.fundedCta}</button>
      )}
    </main>
  );
}
