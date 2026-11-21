import { ClerkProvider } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { clerkPublishableKey } from "@/lib/config";
import { colors } from "@/lib/theme";

export { ErrorBoundary } from "expo-router";

function Screens() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {/* A build without a Clerk key still opens: the screens offer only the on-device render. */}
      {clerkPublishableKey ? (
        <ClerkProvider
          publishableKey={clerkPublishableKey}
          tokenCache={tokenCache}
        >
          <Screens />
        </ClerkProvider>
      ) : (
        <Screens />
      )}
    </SafeAreaProvider>
  );
}
