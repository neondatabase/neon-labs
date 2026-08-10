"use client";

import { Plug } from "lucide-react";
import { useSetupStatus } from "@/lib/setup-status";
import { SetupLanding } from "./SetupLanding";
import { AppFooter } from "./AppFooter";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { Button } from "./ui/button";
import { Notice, NoticeIcon } from "./ui/notice";
import { SidebarInset, SidebarProvider } from "./ui/sidebar";

export function SetupGate({ children }: { children: React.ReactNode }) {
  const status = useSetupStatus();

  if (status.initializing) return null;

  if (!status.ready && !status.skipped) {
    return <SetupLanding status={status} />;
  }

  return (
    <SidebarProvider className="min-h-0 flex-1">
      <Sidebar />
      <SidebarInset className="bg-background">
        <TopBar />
        {!status.ready && status.skipped && (
          <UnconnectedBanner onConnect={status.unskip} />
        )}
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
        <AppFooter />
      </SidebarInset>
    </SidebarProvider>
  );
}

function UnconnectedBanner({ onConnect }: { onConnect: () => void }) {
  return (
    <Notice
      tone="warning"
      className="flex-wrap items-center gap-x-2 gap-y-1 rounded-none border-x-0 border-t-0 px-8 py-2 text-caption"
    >
      <NoticeIcon>
        <Plug />
      </NoticeIcon>
      <span className="text-foreground">
        Not connected to Neon. Pages render, but assessments and migrations
        won&apos;t run.
      </span>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={onConnect}
        className="font-medium text-[#f59e0b] underline underline-offset-2 hover:bg-[#f59e0b]/10 hover:text-[#f59e0b]"
      >
        Connect
      </Button>
    </Notice>
  );
}
