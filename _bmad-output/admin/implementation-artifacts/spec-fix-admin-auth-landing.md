---
title: 'Fix admin auth landing configuration'
type: 'bugfix'
created: '2026-07-12'
status: 'done'
route: 'one-shot'
---

# Fix admin auth landing configuration

## Intent

**Problem:** The public admin landing called WorkOS unconditionally, so a valid development-preview setup without WorkOS credentials crashed before the preview login could open.

**Approach:** Centralize auth configuration validation, redirect complete preview setups to the console, retain configured WorkOS SSO, and render actionable configuration guidance for missing, partial, or rejected WorkOS setups.

## Suggested Review Order

**Auth routing**

- Landing selects preview, SSO, or configuration guidance without an unguarded WorkOS call.
  [`page.tsx:20`](../../../admin/app/page.tsx#L20)

- One validator defines complete WorkOS and preview requirements for every server layer.
  [`authConfig.ts:8`](../../../admin/lib/authConfig.ts#L8)

**Consistency boundaries**

- Root providers now consume the same auth state as the landing page.
  [`layout.tsx:39`](../../../admin/app/layout.tsx#L39)

- The route proxy constructs AuthKit only when the shared WorkOS contract passes.
  [`proxy.ts:15`](../../../admin/proxy.ts#L15)
