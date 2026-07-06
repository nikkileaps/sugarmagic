/**
 * WizardDialog: the reusable multi-step modal frame.
 *
 * Plan 062 §062.5 — steps rail across the top, per-step content
 * slot, Back / Next / Finish footer, busy state with an optional
 * progress readout, and cancel-with-confirm so a half-finished
 * wizard never silently discards work. Wizard-agnostic by
 * design: the Character Wizard is the first consumer; any future
 * multi-step flow (import pipelines, setup flows) reuses this
 * frame instead of hand-rolling a Modal.
 *
 * The dialog is CONTROLLED: the parent owns the active step, the
 * step order, and whether next/finish are allowed — this
 * component only renders and reports intent. Keeps wizard logic
 * in the caller (View state, per the store-separation rule) and
 * the frame dumb.
 */

import type { ReactNode } from "react";
import {
  Button,
  Group,
  Modal,
  Progress,
  Stack,
  Stepper,
  Text
} from "@mantine/core";

export interface WizardDialogStep {
  id: string;
  label: string;
  /** Optional short description under the label in the rail. */
  description?: string;
}

export interface WizardDialogProps {
  opened: boolean;
  title: string;
  steps: WizardDialogStep[];
  activeStepId: string;
  /** Content for the ACTIVE step (parent switches on activeStepId). */
  children: ReactNode;
  /** Enable the Next (or Finish, on the last step) button. */
  canAdvance: boolean;
  canGoBack: boolean;
  /** Busy locks navigation and shows the progress row. */
  busy?: boolean;
  busyLabel?: string;
  /** 0..1 progress while busy; omit for an indeterminate bar. */
  busyProgress?: number;
  finishLabel?: string;
  onBack: () => void;
  onNext: () => void;
  onFinish: () => void;
  /** Called when the user confirms cancelling the wizard. */
  onCancel: () => void;
  /** Skip the confirm prompt (nothing to lose yet). */
  cancelNeedsConfirm?: boolean;
}

export function WizardDialog(props: WizardDialogProps) {
  const {
    opened,
    title,
    steps,
    activeStepId,
    children,
    canAdvance,
    canGoBack,
    busy = false,
    busyLabel,
    busyProgress,
    finishLabel = "Finish",
    onBack,
    onNext,
    onFinish,
    onCancel,
    cancelNeedsConfirm = true
  } = props;

  const activeIndex = Math.max(
    0,
    steps.findIndex((step) => step.id === activeStepId)
  );
  const isLastStep = activeIndex === steps.length - 1;

  function handleClose() {
    if (busy) return;
    if (
      cancelNeedsConfirm &&
      !window.confirm("Cancel and discard this wizard's progress?")
    ) {
      return;
    }
    onCancel();
  }

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      centered
      size="xl"
      title={
        <Text fw={600} size="sm" c="var(--sm-color-text)">
          {title}
        </Text>
      }
      closeOnClickOutside={false}
      closeOnEscape={!busy}
      withCloseButton={!busy}
      styles={{
        content: {
          background: "var(--sm-color-base)",
          borderRadius: "var(--sm-radius-lg)",
          border: "1px solid var(--sm-panel-border)"
        },
        header: {
          background: "var(--sm-color-surface1)",
          borderBottom: "1px solid var(--sm-panel-border)",
          padding: "var(--sm-space-md) var(--sm-space-xl)"
        },
        body: { padding: "var(--sm-space-xl)" }
      }}
    >
      <Stack gap="lg">
        <Stepper
          active={activeIndex}
          size="xs"
          styles={{
            stepLabel: { color: "var(--sm-color-text)" },
            stepDescription: { color: "var(--sm-color-subtext)" }
          }}
        >
          {steps.map((step) => (
            <Stepper.Step
              key={step.id}
              label={step.label}
              description={step.description}
              allowStepSelect={false}
            />
          ))}
        </Stepper>

        {children}

        {busy ? (
          <Stack gap={4}>
            {busyLabel ? (
              <Text size="xs" c="var(--sm-color-subtext)">
                {busyLabel}
              </Text>
            ) : null}
            <Progress
              value={busyProgress !== undefined ? busyProgress * 100 : 100}
              animated={busyProgress === undefined}
              size="sm"
            />
          </Stack>
        ) : null}

        <Group justify="space-between">
          <Button
            variant="subtle"
            color="gray"
            onClick={onBack}
            disabled={!canGoBack || busy}
          >
            Back
          </Button>
          {isLastStep ? (
            <Button onClick={onFinish} disabled={!canAdvance || busy}>
              {finishLabel}
            </Button>
          ) : (
            <Button onClick={onNext} disabled={!canAdvance || busy}>
              Next
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}
