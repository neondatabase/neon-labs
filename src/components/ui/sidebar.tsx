"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type CSSProperties,
} from "react";
import { Drawer } from "@base-ui/react/drawer";
import { mergeProps } from "@base-ui/react/merge-props";
import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
import { useRender } from "@base-ui/react/use-render";
import { useMediaQuery } from "@base-ui/react/unstable-use-media-query";
import { PanelLeft } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Skeleton } from "./skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

const SIDEBAR_WIDTH = "240px";
const SIDEBAR_WIDTH_ICON = "52px";
const SIDEBAR_KEYBOARD_SHORTCUT = "b";
const SIDEBAR_STORAGE_KEY = "neon-advisor:sidebar-open";

type SidebarState = "expanded" | "collapsed";

interface SidebarContextValue {
  state: SidebarState;
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

let storeListeners: (() => void)[] = [];

function subscribeStoredOpen(onChange: () => void) {
  storeListeners = [...storeListeners, onChange];
  window.addEventListener("storage", onChange);
  return () => {
    storeListeners = storeListeners.filter((l) => l !== onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readStoredOpen() {
  return window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
}

function writeStoredOpen(open: boolean) {
  window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(open));
  for (const listener of storeListeners) listener();
}

function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
}

function SidebarProvider({
  children,
  className,
  defaultOpen = true,
  onOpenChange,
  open: openProp,
  style,
  ...props
}: ComponentProps<"div"> & {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const isMobile = useMediaQuery("(max-width: 767px)", {
    defaultMatches: false,
  });
  const [openMobile, setOpenMobile] = useState(false);
  const stored = useSyncExternalStore(
    subscribeStoredOpen,
    readStoredOpen,
    () => null
  );
  const open = openProp ?? (stored === null ? defaultOpen : stored === "true");

  const setOpen = useCallback(
    (next: boolean) => {
      onOpenChange?.(next);
      if (openProp === undefined) writeStoredOpen(next);
    },
    [onOpenChange, openProp]
  );

  const toggleSidebar = useCallback(() => {
    if (isMobile) {
      setOpenMobile(!openMobile);
      return;
    }
    setOpen(!open);
  }, [isMobile, open, openMobile, setOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleSidebar]);

  const context = useMemo<SidebarContextValue>(
    () => ({
      state: open ? "expanded" : "collapsed",
      open,
      setOpen,
      openMobile,
      setOpenMobile,
      isMobile,
      toggleSidebar,
    }),
    [isMobile, open, openMobile, setOpen, toggleSidebar]
  );

  return (
    <SidebarContext.Provider value={context}>
      <div
        data-slot="sidebar-wrapper"
        className={cn("flex min-h-svh w-full", className)}
        style={
          {
            "--sidebar-width": SIDEBAR_WIDTH,
            "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
            ...style,
          } as CSSProperties
        }
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

function Sidebar({
  children,
  className,
  collapsible = "icon",
  ...props
}: ComponentProps<"div"> & {
  collapsible?: "icon" | "offcanvas" | "none";
}) {
  const { isMobile, openMobile, setOpenMobile, state } = useSidebar();

  if (isMobile) {
    return (
      <Drawer.Root open={openMobile} onOpenChange={setOpenMobile}>
        <Drawer.Portal>
          <Drawer.Backdrop className="fixed inset-0 z-40 bg-black/60" />
          <Drawer.Popup
            data-slot="sidebar"
            data-mobile="true"
            className="fixed inset-y-0 left-0 z-50 flex w-(--sidebar-width) flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
          >
            {children}
          </Drawer.Popup>
        </Drawer.Portal>
      </Drawer.Root>
    );
  }

  if (collapsible === "none") {
    return (
      <div
        data-slot="sidebar"
        className={cn(
          "flex w-(--sidebar-width) shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
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
      className="group peer hidden shrink-0 md:block"
      data-collapsible={state === "collapsed" ? collapsible : ""}
      data-slot="sidebar"
      data-state={state}
    >
      <div
        className={cn(
          "relative h-svh w-(--sidebar-width) transition-[width] duration-200 ease-out",
          state === "collapsed" &&
            collapsible === "icon" &&
            "w-(--sidebar-width-icon)",
          state === "collapsed" && collapsible === "offcanvas" && "w-0"
        )}
      />
      <div
        data-slot="sidebar-container"
        className={cn(
          "fixed inset-y-0 left-0 z-10 flex h-svh w-(--sidebar-width) flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width,left] duration-200 ease-out",
          state === "collapsed" &&
            collapsible === "icon" &&
            "w-(--sidebar-width-icon)",
          state === "collapsed" &&
            collapsible === "offcanvas" &&
            "left-[calc(var(--sidebar-width)*-1)]",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </div>
  );
}

function SidebarInset({ className, ...props }: ComponentProps<"main">) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn("flex min-w-0 flex-1 flex-col", className)}
      {...props}
    />
  );
}

function SidebarHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-header"
      className={cn("flex flex-col gap-2 p-3", className)}
      {...props}
    />
  );
}

function SidebarFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-footer"
      className={cn(
        "flex flex-col gap-2 border-t border-sidebar-border p-4",
        className
      )}
      {...props}
    />
  );
}

function SidebarContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overflow-x-hidden px-3 py-4",
        className
      )}
      {...props}
    />
  );
}

function SidebarGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  );
}

function SidebarGroupLabel({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-label"
      className={cn(
        "px-3 text-micro font-medium uppercase tracking-[0.08em] text-muted-foreground transition-opacity duration-200 group-data-[collapsible=icon]:pointer-events-none group-data-[collapsible=icon]:h-0 group-data-[collapsible=icon]:opacity-0",
        className
      )}
      {...props}
    />
  );
}

function SidebarGroupContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-content"
      className={cn("flex flex-col gap-0.5", className)}
      {...props}
    />
  );
}

function SidebarMenu({ className, ...props }: ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu"
      className={cn("flex list-none flex-col gap-0.5", className)}
      {...props}
    />
  );
}

function SidebarMenuItem({ className, ...props }: ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-item"
      className={cn("relative", className)}
      {...props}
    />
  );
}

function SidebarMenuButton({
  className,
  isActive = false,
  render,
  tooltip,
  ...props
}: useRender.ComponentProps<"button"> & {
  isActive?: boolean;
  tooltip?: string;
}) {
  const { state, isMobile } = useSidebar();

  const element = useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        className: cn(
          "flex min-h-[40px] w-full items-center gap-2.5 overflow-hidden rounded-[4px] px-3 py-2 text-ui outline-none transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:px-0 [&>span]:truncate group-data-[collapsible=icon]:[&>span]:hidden [&>svg]:size-4 [&>svg]:shrink-0",
          isActive
            ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground [&>svg]:text-primary"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&>svg]:text-muted-foreground",
          className
        ),
      },
      props
    ),
    render,
    state: { active: isActive, slot: "sidebar-menu-button" },
  });

  if (!tooltip || state === "expanded" || isMobile) return element;

  return (
    <Tooltip>
      <TooltipTrigger render={element} />
      <TooltipContent side="right">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function SidebarMenuBadge({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="sidebar-menu-badge"
      className={cn(
        "ml-auto font-mono text-micro tabular-nums text-muted-foreground group-data-[collapsible=icon]:hidden",
        className
      )}
      {...props}
    />
  );
}

function SidebarMenuSkeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-menu-skeleton"
      className={cn("flex min-h-[40px] items-center gap-2.5 px-3", className)}
      {...props}
    >
      <Skeleton className="size-4 shrink-0 rounded-[4px]" />
      <Skeleton className="h-3 flex-1 group-data-[collapsible=icon]:hidden" />
    </div>
  );
}

function SidebarSeparator({
  className,
  ...props
}: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="sidebar-separator"
      className={cn("h-px w-full bg-sidebar-border", className)}
      {...props}
    />
  );
}

function SidebarTrigger({
  className,
  onClick,
  ...props
}: ComponentProps<typeof Button>) {
  const { toggleSidebar } = useSidebar();
  return (
    <Button
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon-lg"
      aria-label="Toggle sidebar"
      className={cn("text-muted-foreground", className)}
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      {...props}
    >
      <PanelLeft />
    </Button>
  );
}

function SidebarRail({ className, ...props }: ComponentProps<"button">) {
  const { toggleSidebar } = useSidebar();
  return (
    <button
      aria-label="Toggle sidebar"
      data-slot="sidebar-rail"
      onClick={toggleSidebar}
      tabIndex={-1}
      title="Toggle sidebar"
      className={cn(
        "absolute inset-y-0 right-0 z-20 hidden w-2 translate-x-1/2 transition-colors duration-150 ease-out after:absolute after:inset-y-0 after:left-1/2 after:w-px hover:after:bg-primary/40 md:block",
        className
      )}
      {...props}
    />
  );
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
};
