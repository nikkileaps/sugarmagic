/**
 * packages/plugins/src/catalog/sugarprofile/ui/LoginModal.tsx
 *
 * Purpose: SugarProfile-contributed login modal for the published-
 * web bundle. Mantine-styled Sign In + Sign Up tabs, email/password
 * fields, inline error display. When mounted in "upgrade" mode for
 * an anonymous user, the Sign In tab calls
 * `linkAnonymousToCredentials` instead of `signIn` so the
 * underlying userId is preserved through the upgrade — per-user
 * state keyed on userId survives.
 *
 * Implements: Plan 047 §Story 47.7.5
 *
 * Status: active
 */

import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Modal,
  PasswordInput,
  Stack,
  Tabs,
  Text,
  TextInput
} from "@mantine/core";
import type { UserIdentityProvider } from "@sugarmagic/runtime-core";

export type LoginModalMode =
  | "required"  // no user; modal blocks until sign-in / sign-up
  | "upgrade"; // anonymous user; signIn becomes linkAnonymousToCredentials

export interface LoginModalProps {
  provider: UserIdentityProvider;
  mode: LoginModalMode;
  /** Called when the user dismisses the modal in upgrade mode. In
   *  required mode, the close affordance is hidden — pass `undefined`
   *  to suppress the X button entirely. */
  onClose?: () => void;
}

export function LoginModal(props: LoginModalProps) {
  const { provider, mode, onClose } = props;
  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-focus on mount — pure UX nicety as of Plan 050 §50.6.
  //
  // Original story 47.7.5 reasoning (PRE-Plan 050): Mantine
  // Modal's focus trap looks for `data-autofocus` on a child
  // element, but it applies the attribute to TextInput's
  // wrapper div — not the inner <input>. Without focus actually
  // landing on the input, typed keys fired with event.target =
  // the modal container, which bypassed runtime-core's shortcut
  // handlers' `target instanceof HTMLInputElement` guard and
  // triggered in-game shortcuts (i = inventory, c = caster
  // menu, q = quest journal, etc.) while the user typed their
  // email. The imperative focus was the only thing keeping
  // those shortcuts from firing.
  //
  // POST Plan 050: the host's runtime-mode resolver returns
  // "login-modal" while this modal is mounted (`useEffect` in
  // App.tsx / preview.tsx flips `UIStateStore.loginModalOpen`),
  // and the central action registry refuses to fire any in-
  // game / dialogue action in that mode. So even if the input
  // didn't auto-focus, shortcut keys wouldn't co-fire anymore.
  // The autofocus stays for UX (user starts typing without an
  // extra click) but is no longer load-bearing for correctness.
  const emailInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      emailInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function resetForm() {
    setEmail("");
    setPassword("");
    setConfirm("");
    setError(null);
  }

  async function handleSignIn() {
    setBusy(true);
    setError(null);
    try {
      if (mode === "upgrade") {
        // The current user is anonymous; merge in the credentials so
        // userId is preserved across the upgrade.
        await provider.linkAnonymousToCredentials({ email, password });
      } else {
        await provider.signIn({ email, password });
      }
      resetForm();
      onClose?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSignUp() {
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await provider.signUp({ email, password });
      resetForm();
      onClose?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      opened
      onClose={onClose ?? (() => undefined)}
      title={mode === "upgrade" ? "Upgrade Account" : "Sign In to Play"}
      centered
      withCloseButton={mode === "upgrade" && Boolean(onClose)}
      closeOnClickOutside={mode === "upgrade"}
      closeOnEscape={mode === "upgrade"}
      size="sm"
    >
      <Stack gap="md">
        {mode === "upgrade" ? (
          <Text size="sm" c="dimmed">
            Add an email + password to your anonymous account. Your
            progress will carry over.
          </Text>
        ) : null}
        <Tabs
          value={tab}
          onChange={(value) => {
            if (value === "signin" || value === "signup") {
              setTab(value);
              setError(null);
            }
          }}
        >
          <Tabs.List grow>
            <Tabs.Tab value="signin">Sign In</Tabs.Tab>
            <Tabs.Tab value="signup">Sign Up</Tabs.Tab>
          </Tabs.List>
        </Tabs>

        <TextInput
          ref={emailInputRef}
          label="Email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
          autoComplete="email"
          // data-autofocus is the Mantine-documented marker; we
          // also imperatively focus via the ref in a useEffect
          // because Mantine's TextInput wrapper may absorb the
          // attribute rather than forwarding it to the inner
          // input. The two together are belt + suspenders.
          data-autofocus
        />
        <PasswordInput
          label="Password"
          required
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          autoComplete={
            tab === "signin" ? "current-password" : "new-password"
          }
        />
        {tab === "signup" ? (
          <PasswordInput
            label="Confirm Password"
            required
            value={confirm}
            onChange={(event) => setConfirm(event.currentTarget.value)}
            autoComplete="new-password"
          />
        ) : null}

        {error ? (
          <Alert color="red" variant="light" title="Error">
            <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
              {error}
            </Text>
          </Alert>
        ) : null}

        <Group justify="flex-end">
          {mode === "upgrade" && onClose ? (
            <Button variant="subtle" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
          ) : null}
          {tab === "signin" ? (
            <Button
              onClick={() => void handleSignIn()}
              loading={busy}
              disabled={!email || !password}
            >
              {mode === "upgrade" ? "Upgrade" : "Sign In"}
            </Button>
          ) : (
            <Button
              onClick={() => void handleSignUp()}
              loading={busy}
              disabled={!email || !password || !confirm}
            >
              Sign Up
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}
