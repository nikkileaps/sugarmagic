/**
 * Audio transport control.
 *
 * Reusable editor-side playback UI for managed audio source URLs. Runtime
 * audio still flows through runtime-core commands and target adapters; this
 * component is a design-time preview surface with play/pause/stop/scrub.
 */

import { useEffect, useRef, useState } from "react";
import { Button, Group, Slider, Stack, Text } from "@mantine/core";

export interface AudioTransportProps {
  sourceUrl: string | null;
  label?: string;
  disabledReason?: string;
  loop?: boolean;
  playbackRate?: number;
  volume?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
}

export function AudioTransport({
  sourceUrl,
  label = "Audio Preview",
  disabledReason = "Select an audio clip to preview.",
  loop = false,
  playbackRate = 1,
  volume = 1,
  fadeInMs = 0,
  fadeOutMs = 0
}: AudioTransportProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fadeFrameRef = useRef<number | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    cancelFade();
    audio.pause();
    audio.currentTime = 0;
    audio.loop = loop;
    audio.playbackRate = playbackRate;
    audio.volume = clampVolume(volume);
    setCurrentSeconds(0);
    setDurationSeconds(0);
    setIsPlaying(false);
  }, [sourceUrl, loop, playbackRate, volume]);

  useEffect(() => () => cancelFade(), []);

  function cancelFade() {
    if (fadeFrameRef.current === null) return;
    window.cancelAnimationFrame(fadeFrameRef.current);
    fadeFrameRef.current = null;
  }

  function clampVolume(value: number): number {
    return Math.max(0, Math.min(1, value));
  }

  function fadeVolume(
    from: number,
    to: number,
    durationMs: number,
    onComplete?: () => void
  ) {
    const audio = audioRef.current;
    if (!audio || durationMs <= 0) {
      if (audio) audio.volume = clampVolume(to);
      onComplete?.();
      return;
    }
    cancelFade();
    const startedAt = performance.now();
    audio.volume = clampVolume(from);

    function tick(now: number) {
      const currentAudio = audioRef.current;
      if (!currentAudio) return;
      const progress = Math.min(1, (now - startedAt) / durationMs);
      currentAudio.volume = clampVolume(from + (to - from) * progress);
      if (progress >= 1) {
        fadeFrameRef.current = null;
        onComplete?.();
        return;
      }
      fadeFrameRef.current = window.requestAnimationFrame(tick);
    }

    fadeFrameRef.current = window.requestAnimationFrame(tick);
  }

  function play() {
    const audio = audioRef.current;
    if (!audio || !sourceUrl) return;
    cancelFade();
    audio.playbackRate = playbackRate;
    audio.volume = fadeInMs > 0 ? 0 : clampVolume(volume);
    audio.loop = loop;
    void audio.play().then(() => {
      if (fadeInMs > 0) {
        fadeVolume(0, volume, fadeInMs);
      }
    });
  }

  function pause() {
    cancelFade();
    audioRef.current?.pause();
  }

  function stop() {
    const audio = audioRef.current;
    if (!audio) return;
    const finishStop = () => {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = clampVolume(volume);
      setCurrentSeconds(0);
      setIsPlaying(false);
    };
    fadeVolume(audio.volume, 0, fadeOutMs, finishStop);
  }

  function seek(value: number) {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(durationSeconds)) return;
    audio.currentTime = value;
    setCurrentSeconds(value);
  }

  return (
    <Stack
      gap="sm"
      p="md"
      style={{
        border: "1px solid var(--sm-panel-border)",
        borderRadius: 12,
        background: "var(--sm-color-surface1)"
      }}
    >
      <audio
        ref={audioRef}
        src={sourceUrl ?? undefined}
        preload="metadata"
        onLoadedMetadata={(event) =>
          setDurationSeconds(event.currentTarget.duration || 0)
        }
        onTimeUpdate={(event) =>
          setCurrentSeconds(event.currentTarget.currentTime || 0)
        }
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
      />
      <Group justify="space-between" align="center">
        <Text fw={700}>{label}</Text>
        <Text size="xs" c="var(--sm-color-overlay0)">
          {formatTime(currentSeconds)} / {formatTime(durationSeconds)}
        </Text>
      </Group>
      <Slider
        min={0}
        max={Math.max(durationSeconds, 0)}
        step={0.01}
        value={Math.min(currentSeconds, Math.max(durationSeconds, 0))}
        disabled={!sourceUrl || durationSeconds <= 0}
        label={(value) => formatTime(value)}
        onChange={seek}
      />
      <Group gap="xs">
        <Button size="xs" onClick={play} disabled={!sourceUrl || isPlaying}>
          Play
        </Button>
        <Button
          size="xs"
          variant="light"
          onClick={pause}
          disabled={!sourceUrl || !isPlaying}
        >
          Pause
        </Button>
        <Button size="xs" variant="subtle" onClick={stop} disabled={!sourceUrl}>
          Stop
        </Button>
      </Group>
      {!sourceUrl ? (
        <Text size="xs" c="var(--sm-color-overlay0)">
          {disabledReason}
        </Text>
      ) : null}
    </Stack>
  );
}
