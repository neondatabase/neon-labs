"use client";

import type { ComponentProps, ReactNode } from "react";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { cn } from "@/lib/utils";

export type ProjectTicketState = "default" | "selected" | "empty";

export interface ProjectTicketProps extends useRender.ComponentProps<"div"> {
  state?: ProjectTicketState;
  interactive?: boolean;
}

function projectTicketClassName({
  className,
  interactive = false,
  state = "default",
}: {
  className?: string;
  interactive?: boolean;
  state?: ProjectTicketState;
} = {}) {
  return cn(
    "group/ticket flex w-full items-center gap-3 rounded-[4px] border border-border bg-card px-3 py-2 text-left transition-colors duration-150 ease-out",
    interactive &&
      "cursor-pointer outline-none hover:border-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    state === "selected" && "border-primary/40 bg-primary/[0.04]",
    state === "empty" && "border-dashed text-muted-foreground",
    className
  );
}

function ProjectTicket({
  className,
  interactive = false,
  ref,
  render,
  state = "default",
  ...props
}: ProjectTicketProps) {
  return useRender({
    defaultTagName: "div",
    ref,
    props: mergeProps<"div">(
      { className: projectTicketClassName({ className, interactive, state }) },
      props
    ),
    render,
    state: { slot: "project-ticket", state },
  });
}

function ProjectTicketAvatar({
  className,
  children,
  ...props
}: ComponentProps<"span">) {
  return (
    <span
      data-slot="project-ticket-avatar"
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] bg-primary/15 font-medium text-micro text-primary uppercase",
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}

function ProjectTicketBody({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="project-ticket-body"
      className={cn("flex min-w-0 flex-1 flex-col gap-0.5", className)}
      {...props}
    />
  );
}

function ProjectTicketName({
  className,
  children,
  version,
  ...props
}: ComponentProps<"span"> & { version?: ReactNode }) {
  return (
    <span
      data-slot="project-ticket-name"
      className={cn("flex min-w-0 items-center gap-2", className)}
      {...props}
    >
      <span className="truncate text-caption font-medium text-foreground">
        {children}
      </span>
      {version}
    </span>
  );
}

function ProjectTicketVersion({
  className,
  latest = false,
  children,
  ...props
}: ComponentProps<"span"> & { latest?: boolean }) {
  return (
    <span
      data-slot="project-ticket-version"
      data-latest={latest ? "" : undefined}
      className={cn(
        "shrink-0 rounded-[2px] border px-1 py-px font-mono text-micro tnum",
        latest
          ? "border-[#f59e0b]/30 bg-[#f59e0b]/10 text-[#f59e0b]"
          : "border-border bg-muted text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}

function ProjectTicketMeta({
  className,
  items,
  ...props
}: Omit<ComponentProps<"span">, "children"> & { items: ReactNode[] }) {
  const shown = items.filter(Boolean);
  return (
    <span
      data-slot="project-ticket-meta"
      className={cn(
        "flex min-w-0 items-center gap-1.5 truncate font-mono text-micro text-muted-foreground",
        className
      )}
      {...props}
    >
      {shown.map((item, index) => (
        <span key={index} className="flex min-w-0 items-center gap-1.5">
          {index > 0 && <span className="text-border">·</span>}
          <span className="truncate">{item}</span>
        </span>
      ))}
    </span>
  );
}

export {
  projectTicketClassName,
  ProjectTicket,
  ProjectTicketAvatar,
  ProjectTicketBody,
  ProjectTicketMeta,
  ProjectTicketName,
  ProjectTicketVersion,
};
