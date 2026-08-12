export function LabsBanner() {
  return (
    <aside
      aria-label="Experimental tools notice"
      className="relative isolate overflow-hidden border-b border-[#00e599]/20 bg-[#0e1815] px-4 py-2.5 sm:px-6"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_18%_-120%,rgba(0,229,153,0.24),transparent_45%),linear-gradient(90deg,rgba(0,229,153,0.04),transparent_35%,rgba(127,245,207,0.035))]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-[#00e599]/70 to-transparent"
      />

      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-center">
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#00e599]/25 bg-[#00e599]/[0.08] px-2 py-1 font-mono text-[10px] font-medium uppercase leading-none tracking-[0.12em] text-[#7ff5cf]">
          <span
            aria-hidden="true"
            className="size-1.5 rounded-[2px] bg-[#00e599] shadow-[0_0_8px_rgba(0,229,153,0.65)]"
          />
          Experimental
        </span>
        <p className="text-pretty text-xs leading-5 text-[#d1d5db]">
          <span className="font-medium text-[#f3f4f6]">
            Neon Labs is a space for experimental tools.
          </span>{" "}
          <span className="text-[#7ff5cf]">
            Not intended for production use
          </span>
        </p>
      </div>
    </aside>
  );
}
