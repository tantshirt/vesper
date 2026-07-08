"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { usePrivy, useSolanaWallets } from "@privy-io/react-auth";
import { useConvexAuth, useQuery, useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  investGateState,
  shouldMirrorWallet,
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

  const { ready, authenticated, login, user } = usePrivy();
  const { isAuthenticated } = useConvexAuth();
  const { wallets: solanaWallets } = useSolanaWallets();

  const property = useQuery(api.properties.getWithGates, { id: propertyId });
  const currentUser = useQuery(api.users.currentUser);
  const eligibility = useQuery(api.eligibility.getEligibility, { propertyId });
  const fundedBalance = useQuery(api.funding.getFundedBalance);
  const ensureUser = useMutation(api.users.ensureUser);
  const setWalletAddress = useMutation(api.users.setWalletAddress);
  const recordEligibility = useMutation(api.eligibility.recordEligibility);
  const joinWaitlist = useMutation(api.eligibility.joinWaitlist);
  const addMoney = useMutation(api.funding.addMoney);

  // Local form/submission state for the identity-check + waitlist steps (client-only; the
  // authoritative record lives in Convex). `country` maps to the jurisdiction the mutation records.
  const [country, setCountry] = useState<"us" | "other">("us");
  const [annualIncome, setAnnualIncome] = useState("");
  const [netWorth, setNetWorth] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);

  // Add-money form state (client-only; the settled deposit lives in the append-only Convex ledger).
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"card" | "ach">("card");
  const [addingMoney, setAddingMoney] = useState(false);
  const [showAddMore, setShowAddMore] = useState(false);

  // Story 4.1 · Calculator view — a local, button-driven toggle off the funded screen (same idiom
  // as `showAddMore`; the reactive gate-state machine is unchanged). `investAmount` is the raw input
  // string (default "100" for a live projection on first paint); `projection` flips the first-year
  // figure between the base and the −12% downside case; `reviewOpened` reveals the calm 4.2 handoff.
  const [view, setView] = useState<"funded" | "calculator" | "order">("funded");
  const [investAmount, setInvestAmount] = useState("100");
  const [projection, setProjection] = useState<"base" | "downside">("base");
  const [reviewOpened, setReviewOpened] = useState(false);

  // Resolve the embedded Solana address. Select ONLY the Privy-embedded wallet (its
  // `walletClientType` is "privy"). Never fall back to `solanaWallets[0]`: with "wallet" in
  // `loginMethods` a user may have an external Solana wallet ordered first, and mirroring that as
  // the settlement routing key would link an account we did not pre-generate. If the embedded
  // wallet isn't resolvable yet, the `provisioning` gate covers the gap (we never write null).
  // Fall back to the value already mirrored on the Convex user, then to `user.wallet`. Internal only.
  const embeddedSolana = solanaWallets?.find((w) => w.walletClientType === "privy");
  const resolvedAddress =
    embeddedSolana?.address ??
    currentUser?.walletAddress ??
    user?.wallet?.address ??
    null;

  // Provision the Convex user once Convex has accepted the Privy token (idempotent server-side).
  useEffect(() => {
    if (isAuthenticated && currentUser === null) {
      ensureUser().catch(() => {});
    }
  }, [isAuthenticated, currentUser, ensureUser]);

  // Mirror the embedded address into the read model exactly once. `shouldMirrorWallet` guards
  // against null addresses, a missing user row, and already-linked accounts; the mutation is
  // mirror-once + idempotent server-side. Best-effort: a transient failure is swallowed and the
  // effect re-runs whenever its inputs next change (e.g. the reactive `currentUser` updates).
  useEffect(() => {
    if (isAuthenticated && shouldMirrorWallet(currentUser, resolvedAddress)) {
      setWalletAddress({ walletAddress: resolvedAddress! }).catch(() => {});
    }
  }, [isAuthenticated, currentUser, resolvedAddress, setWalletAddress]);

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

  // Submit the (stubbed-Persona) identity check. The hosted Persona flow that would call this same
  // mutation is deferred; here the form is the KYC-result boundary and always reports success.
  async function submitIdentityCheck(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await recordEligibility({
        propertyId,
        jurisdiction: country === "us" ? "United States" : "Somewhere else",
        annualIncome: Number(annualIncome) || 0,
        netWorth: Number(netWorth) || 0,
        verified: true,
      });
    } catch {
      // Best-effort; the reactive state reflects the outcome. Failures leave the user on this step.
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
    try {
      await addMoney({ amountUsd: amountNum, method });
      setAmount("");
      setShowAddMore(false);
    } catch {
      // Best-effort; the reactive balance reflects the outcome. Failures leave the form in place.
    } finally {
      setAddingMoney(false);
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
          <Link href="/explore">{INVEST_COPY.notFoundCta}</Link>
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
      <main className="wrap" role="status" aria-live="polite">
        <p className="eyebrow"><span className="dot" /> {INVEST_COPY.brandEyebrow}</p>
        <h1>{INVEST_COPY.provisioningTitle}</h1>
        <p className="muted">{INVEST_COPY.provisioningBody}</p>
      </main>
    );
  }

  if (state === "kyc") {
    return (
      <main className="wrap">
        <p className="eyebrow"><span className="dot" /> {INVEST_COPY.brandEyebrow}</p>
        <h1>{INVEST_COPY.kycTitle}</h1>
        {p && (
          <p className="muted">{p.name} · {p.location}</p>
        )}
        <p className="muted">{INVEST_COPY.kycBody}</p>
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
        {addMoneyForm}
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
          onClick={() => {
            // Enter the order preview fresh: clear any prior Continue-reveal so the 4.3 coming-soon
            // note never pre-shows for an order the user hasn't re-confirmed on this visit.
            setReviewOpened(false);
            setView("order");
          }}
        >
          {CALC_COPY.reviewCta}
        </button>
      </main>
    );
  }

  // state === "funded", view === "order" — Story 4.2 fee-transparent order preview: a local `view`
  // between the calculator and the future rights step (4.3), same idiom as 4.1's funded → calculator.
  // Shows the investment, the one-time 0.9% platform fee, and the total charged today, plus the
  // no-double-charge management-fee note. Reuses the calculator's `projAmount` clamp; the fee rate and
  // yield derive from PLATFORM_FEE_RATE / property.targetNetYield (no hardcoded digits). No order
  // record or persistence here — the order is created and settled atomically in Story 4.4. Back
  // returns to the calculator with the amount intact; Continue reveals the honest 4.3 coming-soon note.
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

        <button type="button" className="cta" onClick={() => setReviewOpened(true)}>
          {ORDER_COPY.continueCta}
        </button>
        {reviewOpened && (
          <p className="muted" role="status">{ORDER_COPY.comingSoonNote}</p>
        )}
      </main>
    );
  }

  // state === "funded", view === "funded" — account-level balance in dollars, "Add more"
  // affordance, then the Story 4.1 handoff into the calculator. Balance is the same across every
  // property (account-level).
  const balance = typeof fundedBalance === "number" ? fundedBalance : 0;
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
      {showAddMore ? (
        addMoneyForm
      ) : (
        <button className="cta ghost" onClick={() => setShowAddMore(true)}>
          {INVEST_COPY.fundedAddMore}
        </button>
      )}
      <button className="cta" onClick={() => setView("calculator")}>
        {INVEST_COPY.fundedCta}
      </button>
    </main>
  );
}
