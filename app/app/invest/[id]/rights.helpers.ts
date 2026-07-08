// Story 4.3 · Rights & risk acknowledgement — pure consent-gate logic + consumer copy (no JSX/React/
// DOM), so the "all three checked" gate and the no-crypto-vocabulary invariant are unit-testable
// without a browser harness (mirrors the order.helpers.ts + vitest pattern). No consent record,
// mutation, or persistence lives here — this is the single source of truth for the gate and the copy.
//
// Consumer surface rule (spine I6 / NFR3): NONE of RIGHTS_COPY nor any RIGHTS_ACKS label may contain
// crypto vocabulary (the shared `hasCryptoVocabulary` guard asserts this). The acknowledgements are
// generic Reg A+ risk statements, kept here so a compliance-blessed wording swap is one edit.

// One risk acknowledgement: a stable kebab-case id (the checkbox key) and its first-person label.
export interface RiskAck {
  id: string;
  label: string;
}

// The three distinct risk acknowledgements a funded investor must actively check before Confirm
// enables (FR9): illiquidity / long-term, possible loss / no guaranteed return, and not-a-bank-deposit
// / invest-only-what-you-can-leave. Ids are unique and kebab-case; labels are plain-English and
// crypto-clean. Changing this list changes REQUIRED_ACK_COUNT and the rendered rows with no JSX churn.
export const RIGHTS_ACKS: readonly RiskAck[] = [
  {
    id: "illiquidity",
    label:
      "I understand this is a long-term investment and I may not be able to sell my shares quickly, or at all.",
  },
  {
    id: "loss",
    label:
      "I understand the value and income can go down as well as up, returns are not guaranteed, and I could lose money.",
  },
  {
    id: "not-insured",
    label:
      "I understand this is not a bank deposit and is not insured, and I should only invest money I can afford to leave invested.",
  },
] as const;

// The number of acknowledgements the gate requires — derived from RIGHTS_ACKS so it can never drift.
export const REQUIRED_ACK_COUNT = RIGHTS_ACKS.length;

// The consent gate (FR9): true iff EVERY required id is explicitly `=== true`. A missing key never
// accidentally enables Confirm, and an unknown/stale key can never satisfy the gate (only the three
// required ids are consulted). This is the single source of truth for Confirm's enabled state.
export function allAcknowledged(checked: Record<string, boolean>): boolean {
  // Defensive: an empty acknowledgement set must NEVER satisfy the gate (`[].every()` is `true`), so a
  // future edit that trims RIGHTS_ACKS to zero can't silently open Confirm with nothing checked.
  return RIGHTS_ACKS.length > 0 && RIGHTS_ACKS.every((a) => checked[a.id] === true);
}

// --- Consumer copy. No crypto vocabulary (the `hasCryptoVocabulary` guard asserts this) — the
// settlement-outcome strings stay fiat-native; the on-chain DvP receipt reference lives only in the
// pull-only proof view, never here. ---
export const RIGHTS_COPY = {
  eyebrow: "Before you invest",
  title: "A few things to acknowledge",
  intro:
    "Please read and confirm each of these. They matter — checking them means you understand the risks of this investment.",
  backLabel: "‹ Back to review your order",
  confirmCta: "Confirm and continue",

  // Story 4.4 · settlement outcome. Shown while the purchase settles, then a minimal factual
  // acknowledgement on success (the celebratory owner screen is Story 4.5) or a calm "nothing was
  // charged" note on any failure. Deliberately free of settlement/payment jargon; the failure note is
  // reason-neutral (it never promises an imminent retry will succeed — a cap/eligibility block won't).
  submittingLabel: "Completing your investment…",
  settledEyebrow: "Done",
  settledTitle: "Your investment is complete",
  ownedLabel: "You now own",
  failedNote:
    "We couldn't complete this, and nothing was charged. No harm done — please review your details and try again.",
} as const;
