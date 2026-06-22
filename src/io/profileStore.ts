import type { MappingProfile } from "../types";

// Mapping profiles persist in localStorage keyed by the dataset's shape
// signature, so loading a file of a known shape can re-apply its mapping.

const KEY = "nevergraph:profiles:v1";

type ProfileMap = Record<string, MappingProfile>;

function read(): ProfileMap {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ProfileMap) : {};
  } catch {
    return {};
  }
}

function write(map: ProfileMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable / quota — ignore, in-memory still works */
  }
}

export function saveProfile(profile: MappingProfile): void {
  const map = read();
  map[profile.shapeSignature] = { ...profile };
  write(map);
}

export function loadProfile(shapeSignature: string): MappingProfile | null {
  return read()[shapeSignature] ?? null;
}

export function listProfiles(): MappingProfile[] {
  return Object.values(read());
}

export function deleteProfile(shapeSignature: string): void {
  const map = read();
  delete map[shapeSignature];
  write(map);
}

/** Validate an imported object is shaped like a MappingProfile. */
export function isMappingProfile(v: unknown): v is MappingProfile {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.shapeSignature === "string" &&
    Array.isArray(p.collections) &&
    p.collections.every(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        typeof (c as Record<string, unknown>).collection === "string",
    )
  );
}
