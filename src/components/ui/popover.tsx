"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import { cn } from "@/lib/utils";

function Popover(props: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root {...props} />;
}

function PopoverTrigger(props: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  align = "start",
  className,
  collisionAvoidance,
  collisionPadding,
  positionMethod,
  side,
  sideOffset = 6,
  ...props
}: PopoverPrimitive.Popup.Props & {
  align?: PopoverPrimitive.Positioner.Props["align"];
  collisionAvoidance?: PopoverPrimitive.Positioner.Props["collisionAvoidance"];
  collisionPadding?: PopoverPrimitive.Positioner.Props["collisionPadding"];
  positionMethod?: PopoverPrimitive.Positioner.Props["positionMethod"];
  side?: PopoverPrimitive.Positioner.Props["side"];
  sideOffset?: PopoverPrimitive.Positioner.Props["sideOffset"];
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        collisionAvoidance={collisionAvoidance}
        collisionPadding={collisionPadding}
        positionMethod={positionMethod}
        side={side}
        sideOffset={sideOffset}
      >
        <PopoverPrimitive.Popup
          className={cn(
            "fade-in-0 slide-in-from-bottom-1 z-50 animate-in rounded-lg border border-border/60 bg-card p-3 duration-200 motion-reduce:animate-none",
            className
          )}
          data-slot="popover-content"
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverContent, PopoverTrigger };
