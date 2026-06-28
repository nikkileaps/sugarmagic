/**
 * packages/plugins/src/catalog/sugarprofile/ui/SignedInBadge.tsx
 *
 * Purpose: Corner pill showing the signed-in user + a Sign Out
 * button. Mounted by App.tsx when the active provider's current
 * user is credentialed (isAnonymous=false).
 *
 * Implements: Plan 047 §Story 47.7.5
 *
 * Status: active
 */

import { useState } from "react";
import { Box, Button, Group, Text } from "@mantine/core";
import type {
  User,
  UserIdentityProvider
} from "@sugarmagic/runtime-core";

export interface SignedInBadgeProps {
  user: User;
  provider: UserIdentityProvider;
}

export function SignedInBadge(props: SignedInBadgeProps) {
  const { user, provider } = props;
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    setBusy(true);
    try {
      await provider.signOut();
    } catch (error) {
      console.error("[sugarprofile] signOut failed", error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        zIndex: 18,
        padding: "6px 12px",
        borderRadius: 999,
        border: "1px solid rgba(236, 72, 153, 0.4)",
        background: "rgba(15, 10, 36, 0.85)",
        backdropFilter: "blur(8px)",
        color: "#fff",
        boxShadow: "0 6px 18px rgba(0,0,0,0.3)"
      }}
    >
      <Group gap="xs" align="center" wrap="nowrap">
        <Text size="xs" c="dimmed">
          Signed in as
        </Text>
        <Text size="xs" fw={600} style={{ maxWidth: 220 }} truncate>
          {user.email ?? user.displayName ?? user.userId}
        </Text>
        <Button
          size="compact-xs"
          variant="subtle"
          color="pink"
          loading={busy}
          onClick={() => void handleSignOut()}
        >
          Sign Out
        </Button>
      </Group>
    </Box>
  );
}
