import { resolveApiRoot } from "./apiRoot";

const isDev = typeof __DEV__ !== "undefined" && __DEV__;

export const clerkPublishableKey =
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() || null;

export const apiRoot = resolveApiRoot(
  process.env.EXPO_PUBLIC_API_BASE_URL,
  isDev,
);

/**
 * Sign-in and the AI Job screens need both public values at build time. A build without them
 * still opens: only the on-device Local Render is offered.
 */
export const accountFeaturesConfigured = Boolean(
  clerkPublishableKey && apiRoot.root,
);
