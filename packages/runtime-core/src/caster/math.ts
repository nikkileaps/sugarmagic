export const DEFAULT_MAX_BATTERY = 100;
export const MAX_RESONANCE = 100;

export type BatteryTier = "full" | "unstable" | "critical" | "empty";

export function clampBattery(value: number, maxBattery: number = DEFAULT_MAX_BATTERY): number {
  return Math.max(0, Math.min(maxBattery, value));
}

export function clampResonance(value: number): number {
  return Math.max(0, Math.min(MAX_RESONANCE, value));
}

export function resolveBatteryTier(
  battery: number,
  maxBattery: number = DEFAULT_MAX_BATTERY
): BatteryTier {
  const normalizedBattery = clampBattery(battery, maxBattery);
  const safeMaxBattery = Math.max(1, maxBattery);
  const batteryPercent = (normalizedBattery / safeMaxBattery) * 100;

  if (batteryPercent >= 75) return "full";
  if (batteryPercent >= 25) return "unstable";
  if (batteryPercent > 0) return "critical";
  return "empty";
}

export function resolveBaseChaosChance(tier: BatteryTier): number {
  switch (tier) {
    case "full":
      return 0;
    case "unstable":
      return 0.4;
    case "critical":
      return 0.8;
    case "empty":
      return 1;
  }
}

export function applyResonanceStabilization(
  baseChaosChance: number,
  resonance: number
): number {
  const normalizedResonance = clampResonance(resonance);
  const stabilization = (normalizedResonance / MAX_RESONANCE) * 0.8;
  return baseChaosChance * (1 - stabilization);
}

export function resolveChaosChance(
  batteryBeforeCast: number,
  resonance: number,
  maxBattery: number = DEFAULT_MAX_BATTERY
): number {
  const batteryTier = resolveBatteryTier(batteryBeforeCast, maxBattery);
  const baseChaosChance = resolveBaseChaosChance(batteryTier);
  return applyResonanceStabilization(baseChaosChance, resonance);
}

export function rollChaos(
  batteryBeforeCast: number,
  resonance: number,
  maxBattery: number = DEFAULT_MAX_BATTERY,
  randomValue: number = Math.random()
): boolean {
  return randomValue < resolveChaosChance(batteryBeforeCast, resonance, maxBattery);
}

export function applyBatteryRechargePerMinute(
  currentBattery: number,
  rechargeRatePerMinute: number,
  deltaSeconds: number,
  maxBattery: number = DEFAULT_MAX_BATTERY
): number {
  if (rechargeRatePerMinute <= 0 || deltaSeconds <= 0 || maxBattery <= 0) {
    return clampBattery(currentBattery, maxBattery);
  }

  const rechargeAmount = (rechargeRatePerMinute * deltaSeconds) / 60;
  return clampBattery(currentBattery + rechargeAmount, maxBattery);
}
