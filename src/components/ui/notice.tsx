import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const noticeVariants = cva(
  "group/notice flex w-full gap-3 rounded-[4px] border px-4 py-3 text-ui",
  {
    variants: {
      tone: {
        info: "border-primary/20 bg-primary/[0.04] [--notice-accent:var(--color-primary)]",
        neutral:
          "border-border bg-muted/40 [--notice-accent:var(--color-muted-foreground)]",
        warning:
          "border-[#f59e0b]/25 bg-[#f59e0b]/[0.06] [--notice-accent:#f59e0b]",
        danger:
          "border-destructive/35 bg-destructive/10 [--notice-accent:var(--color-destructive)]",
      },
    },
    defaultVariants: { tone: "info" },
  }
);

type NoticeTone = NonNullable<VariantProps<typeof noticeVariants>["tone"]>;

const LIVE_ROLE: Record<NoticeTone, ComponentProps<"div">["role"]> = {
  info: "status",
  neutral: undefined,
  warning: "status",
  danger: "alert",
};

function Notice({
  className,
  role,
  tone = "info",
  ...props
}: ComponentProps<"div"> & VariantProps<typeof noticeVariants>) {
  return (
    <div
      data-slot="notice"
      data-tone={tone}
      role={role ?? LIVE_ROLE[tone ?? "info"]}
      className={cn(noticeVariants({ tone }), className)}
      {...props}
    />
  );
}

function NoticeIcon({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      aria-hidden
      data-slot="notice-icon"
      className={cn(
        "mt-px shrink-0 text-(--notice-accent) [&>svg]:size-3.5",
        className
      )}
      {...props}
    />
  );
}

function NoticeBody({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="notice-body"
      className={cn("flex min-w-0 flex-1 flex-col gap-1", className)}
      {...props}
    />
  );
}

function NoticeTitle({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="notice-title"
      className={cn("text-body font-medium text-foreground", className)}
      {...props}
    />
  );
}

function NoticeDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="notice-description"
      className={cn("text-pretty text-ui text-muted-foreground", className)}
      {...props}
    />
  );
}

function NoticeActions({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="notice-actions"
      className={cn("mt-2 flex flex-wrap items-center gap-2", className)}
      {...props}
    />
  );
}

export {
  Notice,
  NoticeActions,
  NoticeBody,
  NoticeDescription,
  NoticeIcon,
  NoticeTitle,
  noticeVariants,
};
