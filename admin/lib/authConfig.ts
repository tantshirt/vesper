type Env = Record<string, string | undefined>;

function configuredValue(value: string | undefined): boolean {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 && !/^<.*>$/.test(normalized);
}

export function workosAuthConfigured(env: Env = process.env): boolean {
  return configuredValue(env.WORKOS_API_KEY) &&
    configuredValue(env.WORKOS_CLIENT_ID) &&
    configuredValue(env.NEXT_PUBLIC_WORKOS_REDIRECT_URI) &&
    (env.WORKOS_COOKIE_PASSWORD?.trim().length ?? 0) >= 32;
}

export function devAdminAuthConfigured(env: Env = process.env): boolean {
  return env.VESPER_RUNTIME_ENV === "development" &&
    env.VESPER_ENABLE_DEV_ADMIN_AUTH === "true" &&
    env.NEXT_PUBLIC_VESPER_DEV_ADMIN_AUTH === "true" &&
    configuredValue(env.NEXT_PUBLIC_CONVEX_URL) &&
    configuredValue(env.VESPER_DEV_ADMIN_PASSWORD) &&
    configuredValue(env.VESPER_DEV_ADMIN_PRIVATE_KEY_B64);
}

export function authConfigurationIssues(env: Env = process.env): string[] {
  const issues: string[] = [];
  if (!configuredValue(env.WORKOS_API_KEY)) issues.push("WORKOS_API_KEY");
  if (!configuredValue(env.WORKOS_CLIENT_ID)) issues.push("WORKOS_CLIENT_ID");
  if (!configuredValue(env.NEXT_PUBLIC_WORKOS_REDIRECT_URI)) issues.push("NEXT_PUBLIC_WORKOS_REDIRECT_URI");
  if ((env.WORKOS_COOKIE_PASSWORD?.trim().length ?? 0) < 32) issues.push("WORKOS_COOKIE_PASSWORD (32+ characters)");
  return issues;
}
