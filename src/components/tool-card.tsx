import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export type ToolCardProps = ComponentProps<"div">;

function toolCardClassName(className?: string) {
  return cn(
    "group group/tool-card relative isolate flex min-h-[128px] flex-col overflow-hidden rounded-lg border border-border/60 bg-card p-4 shadow-none ring-0 transition-colors hover:border-border [&>[data-slot=tool-card-icon]]:mb-2.5",
    className
  );
}

/* ─────────────────────────────────────────────────────────
 * AppCard's chrome, composed. Hairline border warming on
 * hover, neon underline sweeping under the title. Wash,
 * icon, title, action, copy, and footer are slots — omit
 * any of them. The root is a container; put the CTA in
 * the footer (or anywhere) rather than wrapping the card.
 * ───────────────────────────────────────────────────────── */
function ToolCard({ className, ...props }: ToolCardProps) {
  return (
    <div
      data-slot="tool-card"
      className={toolCardClassName(className)}
      {...props}
    />
  );
}

function ToolCardWash({
  children,
  className,
  ...props
}: ComponentProps<"div">) {
  if (children) {
    return (
      <div
        aria-hidden="true"
        data-slot="tool-card-wash"
        className={cn(
          "-z-10 pointer-events-none absolute inset-x-0 bottom-0 h-24 overflow-hidden text-primary",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      data-slot="tool-card-wash"
      className={cn(
        "neon-card-wash -z-10 pointer-events-none absolute inset-x-0 bottom-0 h-24 text-primary opacity-[0.07] transition-opacity duration-500 group-hover:opacity-[0.22]",
        className
      )}
      {...props}
    />
  );
}

function ToolCardIcon({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="tool-card-icon"
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary [&_svg:not([class*='size-'])]:size-4.5",
        className
      )}
      {...props}
    />
  );
}

function ToolCardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="tool-card-header"
      className={cn(
        "flex min-w-0 items-center gap-1.5",
        className
      )}
      {...props}
    />
  );
}

function ToolCardTitle({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="tool-card-title"
      className={cn(
        "relative min-w-0 truncate font-medium text-foreground text-sm after:absolute after:inset-x-0 after:bottom-0 after:h-px after:origin-left after:scale-x-0 after:bg-primary after:transition-transform after:duration-300 after:ease-out group-hover/tool-card:after:scale-x-100 motion-reduce:after:transition-none",
        className
      )}
      {...props}
    />
  );
}

function ToolCardAction({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="tool-card-action"
      className={cn(
        "inline-flex size-3.5 shrink-0 items-center justify-center text-muted-foreground/40 transition-colors group-hover/tool-card:text-foreground [&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      {...props}
    />
  );
}

function ToolCardDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="tool-card-description"
      className={cn(
        "mt-1.5 line-clamp-3 max-w-[48ch] text-pretty text-muted-foreground/80 text-xs leading-5",
        className
      )}
      {...props}
    />
  );
}

function ToolCardFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="tool-card-footer"
      className={cn("mt-auto flex items-center gap-1.5 pt-4", className)}
      {...props}
    />
  );
}

export {
  ToolCard,
  ToolCardAction,
  ToolCardDescription,
  ToolCardFooter,
  ToolCardHeader,
  ToolCardIcon,
  ToolCardTitle,
  ToolCardWash,
  toolCardClassName,
};
