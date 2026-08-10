/**
 * Official Neon brand assets.
 * Source: https://neon.com/brand (downloaded 2026-01-21)
 * Brand color: #34D59A (dark backgrounds) / #37C38F (light)
 * Do not edit, change, distort, recolor, or reconfigure.
 */

/** Neon logomark, the geometric N (use when there isn't room for the full logo). */
export function NeonMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M63 0.0177909V63.5526L38.4178 42.2501V63.5526H0V0L63 0.0177909ZM7.72251 55.8389H30.6953V25.3238L55.2779 47.0476V7.72922L7.72251 7.71559V55.8389Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Full Neon logo, logomark + "neon" wordmark, for dark backgrounds. */
export function NeonWordmark({ className = "h-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 157 45"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Neon"
    >
      <path
        d="M43.9842 0.0123174V44L26.9844 29.2514V44H0.416626V0L43.9842 0.0123174ZM5.75712 38.6595H21.6439V17.5326L38.644 32.5729V5.35124L5.75712 5.34181V38.6595Z"
        fill="#34D59A"
      />
      <path
        d="M79.0701 35.7042L62.1564 20.7349V35.4106H56.8364V9.06775L73.7502 24.037V9.36126H79.0701V35.7042ZM84.9267 35.4106V9.36126H100.85V14.6078H90.2466V19.7443H98.6485V24.8808H90.2466V30.1641H100.85V35.4106H84.9267ZM117.32 35.7042C109.945 35.7042 104.001 29.7605 104.001 22.386C104.001 15.0114 109.945 9.06775 117.32 9.06775C124.694 9.06775 130.638 15.0114 130.638 22.386C130.638 29.7605 124.694 35.7042 117.32 35.7042ZM117.32 30.5677C121.869 30.5677 125.281 26.8987 125.281 22.386C125.281 17.8732 121.869 14.2042 117.32 14.2042C112.77 14.2042 109.358 17.8732 109.358 22.386C109.358 26.8987 112.77 30.5677 117.32 30.5677ZM156.493 35.7042L139.579 20.7349V35.4106H134.259V9.06775L151.173 24.037V9.36126H156.493V35.7042Z"
        fill="white"
      />
    </svg>
  );
}

/** @deprecated use NeonMark or NeonWordmark */
export const NeonLogo = NeonWordmark;
