/**
 * PBR texture-set discovery.
 *
 * Sugarbuilder-style material import starts from a folder full of exported
 * texture files. This module owns the filename-based role inference and the
 * validation rules that decide whether a set is importable as a Standard PBR
 * material snapshot.
 */

import type { TextureDefinition } from "@sugarmagic/domain";

export type PbrTextureRole =
  | "basecolor"
  | "normal"
  | "orm"
  | "roughness"
  | "metallic"
  | "ao"
  | "height";

export type StandardPbrTextureParameterId =
  | "basecolor_texture"
  | "normal_texture"
  | "orm_texture"
  | "roughness_texture"
  | "metallic_texture"
  | "ao_texture";

export interface DiscoveredPbrTextureSet {
  filesByRole: Partial<Record<PbrTextureRole, File>>;
  suggestedMaterialDisplayName: string;
  warnings: string[];
}

interface TextureRoleDescriptor {
  role: PbrTextureRole;
  aliases: string[];
}

const TEXTURE_ROLE_DESCRIPTORS: readonly TextureRoleDescriptor[] = [
  { role: "basecolor", aliases: ["basecolor", "basecolour", "albedo", "diffuse"] },
  { role: "normal", aliases: ["normal"] },
  { role: "orm", aliases: ["occlusionroughnessmetallic", "orm", "arm"] },
  { role: "roughness", aliases: ["roughness", "rough"] },
  { role: "metallic", aliases: ["metallic", "metalness"] },
  { role: "ao", aliases: ["ambientocclusion", "occlusion", "ao"] },
  { role: "height", aliases: ["displacement", "displace", "height"] }
] as const;

function normalizeStem(value: string): string {
  return value.toLowerCase().replace(/\.[^.]+$/u, "").replace(/[^a-z0-9]+/gu, "");
}

function getStem(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  return lastDot <= 0 ? fileName : fileName.slice(0, lastDot);
}

function prettifyStem(stem: string): string {
  return stem
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/\b\w/gu, (character) => character.toUpperCase());
}

function inferPbrTextureRole(fileName: string): PbrTextureRole | null {
  const normalizedStem = normalizeStem(fileName);
  for (const descriptor of TEXTURE_ROLE_DESCRIPTORS) {
    if (
      descriptor.aliases.some((alias) => normalizedStem.includes(alias))
    ) {
      return descriptor.role;
    }
  }
  return null;
}

export function labelForPbrTextureRole(role: PbrTextureRole): string {
  switch (role) {
    case "basecolor":
      return "basecolor";
    case "normal":
      return "normal";
    case "orm":
      return "ORM";
    case "roughness":
      return "roughness";
    case "metallic":
      return "metallic";
    case "ao":
      return "ambient occlusion";
    case "height":
      return "height";
  }
}

function buildSuggestedMaterialDisplayName(filesByRole: Partial<Record<PbrTextureRole, File>>): string {
  const preferredSource =
    filesByRole.basecolor ??
    filesByRole.orm ??
    filesByRole.roughness ??
    filesByRole.normal ??
    Object.values(filesByRole)[0] ??
    null;

  if (!preferredSource) {
    return "Imported Material";
  }

  let stem = getStem(preferredSource.name);
  for (const descriptor of TEXTURE_ROLE_DESCRIPTORS) {
    for (const alias of descriptor.aliases) {
      const pattern = new RegExp(`(^|[_\\-. ])${alias}($|[_\\-. ])`, "iu");
      stem = stem.replace(pattern, " ");
    }
  }

  const prettified = prettifyStem(stem);
  return prettified.length > 0 ? prettified : prettifyStem(getStem(preferredSource.name));
}

export function packingForPbrTextureRole(
  role: PbrTextureRole
): TextureDefinition["packing"] {
  switch (role) {
    case "basecolor":
      return "rgba";
    case "normal":
      return "normal";
    case "orm":
      return "orm";
    case "roughness":
      return "roughness";
    case "metallic":
      return "metallic";
    case "ao":
      return "ao";
    case "height":
      return "height";
  }
}

export function colorSpaceForPbrTextureRole(
  role: PbrTextureRole
): TextureDefinition["colorSpace"] {
  return role === "basecolor" ? "srgb" : "linear";
}

export function materialParameterIdForPbrTextureRole(
  role: PbrTextureRole
): StandardPbrTextureParameterId | null {
  switch (role) {
    case "basecolor":
      return "basecolor_texture";
    case "normal":
      return "normal_texture";
    case "orm":
      return "orm_texture";
    case "roughness":
      return "roughness_texture";
    case "metallic":
      return "metallic_texture";
    case "ao":
      return "ao_texture";
    case "height":
      return null;
  }
}

export function discoverPbrTextureSet(files: File[]): DiscoveredPbrTextureSet {
  if (files.length === 0) {
    throw new Error(
      "The selected folder does not contain any importable PNG or JPEG textures."
    );
  }

  const filesByRole: Partial<Record<PbrTextureRole, File>> = {};
  const unrecognizedFiles: string[] = [];

  for (const file of files) {
    const role = inferPbrTextureRole(file.name);
    if (!role) {
      unrecognizedFiles.push(file.name);
      continue;
    }
    if (filesByRole[role]) {
      throw new Error(
        `PBR import found multiple ${labelForPbrTextureRole(role)} textures: "${filesByRole[role]!.name}" and "${file.name}". Keep one authoritative file per role.`
      );
    }
    filesByRole[role] = file;
  }

  if (!filesByRole.basecolor) {
    throw new Error(
      "PBR import requires a basecolor texture. Expected a filename containing basecolor, basecolour, albedo, or diffuse."
    );
  }

  if (
    !filesByRole.orm &&
    !filesByRole.roughness &&
    !filesByRole.metallic &&
    !filesByRole.ao &&
    !filesByRole.normal
  ) {
    throw new Error(
      "PBR import requires more than a basecolor map. Add at least one of normal, ORM, roughness, metallic, or ambient occlusion."
    );
  }

  const warnings: string[] = [];
  if (unrecognizedFiles.length > 0) {
    warnings.push(
      `Ignored unrecognized texture files: ${unrecognizedFiles.join(", ")}.`
    );
  }
  if (filesByRole.height) {
    warnings.push(
      `Imported "${filesByRole.height.name}" as a Height texture, but Standard PBR does not bind height yet. The texture will be added to the library and left unbound.`
    );
  }

  return {
    filesByRole,
    suggestedMaterialDisplayName: buildSuggestedMaterialDisplayName(filesByRole),
    warnings
  };
}
