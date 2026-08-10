export function initials(name: string, fallback = "NA") {
  const letters = name
    .split(/[\s_-]+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, "")[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("");

  return letters ? letters.toUpperCase() : fallback;
}
