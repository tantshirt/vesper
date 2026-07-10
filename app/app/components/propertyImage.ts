// Maps a property to one of the brand dusk illustrations under /public/brand/properties.
// Named buildings get their own art; anything else is assigned deterministically so every
// property shows a consistent image without a schema/data migration.
const ART = [
  "/brand/properties/the-monroe.png",
  "/brand/properties/cedar-row.png",
  "/brand/properties/alder-court.png",
];

export function propertyImage(name: string, key?: string): string {
  const n = name.toLowerCase();
  if (n.includes("monroe")) return ART[0];
  if (n.includes("cedar")) return ART[1];
  if (n.includes("alder")) return ART[2];
  const seed = key ?? name;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return ART[h % ART.length];
}
