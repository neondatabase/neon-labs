"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  PlusCircle,
  ListChecks,
  Puzzle,
  FileText,
  HelpCircle,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useAssessment } from "./AssessmentProvider";
import { NeonMark } from "./NeonLogo";
import { Kbd, KbdGroup } from "./ui/kbd";
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "./ui/sidebar";

const PRIMARY = [
  { href: "/", label: "New assessment", icon: PlusCircle },
];

const ASSESSMENT = [
  { href: "/changes", label: "Version changes", icon: ListChecks },
];

const REFERENCE = [
  { href: "/extensions", label: "Extensions", icon: Puzzle },
];

const RESOURCES = [
  {
    href: "https://neon.com/docs/postgresql/postgres-upgrade",
    label: "Neon Upgrade Docs",
    icon: FileText,
  },
  { href: "https://neon.com/contact-sales", label: "Support", icon: HelpCircle },
];

export function Sidebar() {
  const pathname = usePathname();
  const { assessment } = useAssessment();

  return (
    <SidebarRoot collapsible="icon">
      <SidebarHeader className="p-0">
        <div className="flex h-[52px] items-center gap-[10px] border-b border-sidebar-border px-4 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <NeonMark className="h-[18px] w-[18px] shrink-0 text-primary" />
          <span className="truncate text-[13.5px] font-medium tracking-[-0.2px] text-foreground group-data-[collapsible=icon]:hidden">
            Neon Upgrade Advisor
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <NavMenu items={PRIMARY} pathname={pathname} />
        </SidebarGroup>

        {assessment && (
          <SidebarGroup>
            <SidebarGroupLabel>Assessment</SidebarGroupLabel>
            <SidebarGroupContent>
              <NavMenu items={ASSESSMENT} pathname={pathname} />
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <SidebarGroup>
          <SidebarGroupLabel>Reference</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavMenu items={REFERENCE} pathname={pathname} />
          </SidebarGroupContent>
        </SidebarGroup>


        <SidebarGroup>
          <SidebarGroupLabel>Resources</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavMenu items={RESOURCES} pathname={pathname} external />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="group-data-[collapsible=icon]:items-center">
        <CollapseButton />
      </SidebarFooter>

      <SidebarRail />
    </SidebarRoot>
  );
}

function CollapseButton() {
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";
  return (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      className="flex min-h-[32px] w-full items-center justify-between gap-2 rounded-[4px] px-1 text-caption text-muted-foreground transition-colors duration-150 ease-out hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
    >
      <span className="flex items-center gap-2">
        {collapsed ? (
          <PanelLeftOpen className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <PanelLeftClose className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="group-data-[collapsible=icon]:hidden">
          {collapsed ? "Expand" : "Collapse"}
        </span>
      </span>
      <KbdGroup className="group-data-[collapsible=icon]:hidden">
        <Kbd>⌘</Kbd>
        <Kbd>B</Kbd>
      </KbdGroup>
    </button>
  );
}

function NavMenu({
  items,
  pathname,
  external,
}: {
  items: {
    href: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[];
  pathname: string;
  external?: boolean;
}) {
  return (
    <SidebarMenu>
      {items.map(({ href, label, icon: Icon }) => {
        const active =
          !external &&
          (href === "/" ? pathname === "/" : pathname.startsWith(href));
        return (
          <SidebarMenuItem key={href}>
            <SidebarMenuButton
              isActive={active}
              tooltip={label}
              render={
                external ? (
                  <a href={href} target="_blank" rel="noreferrer" />
                ) : (
                  <Link href={href} />
                )
              }
            >
              <Icon />
              <span>{label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}
