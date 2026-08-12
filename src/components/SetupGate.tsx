"use client";

import { useEffect } from "react";
import { Plug } from "lucide-react";
import { useSetupStatus } from "@/lib/setup-status";
import { clearPersistedNeonSecrets } from "@/lib/neon-settings";
import { SetupLanding } from "./SetupLanding";
import { AppFooter } from "./AppFooter";
import { LabsBanner } from "./LabsBanner";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { Button } from "./ui/button";
import { Notice, NoticeIcon } from "./ui/notice";
import { SidebarInset, SidebarProvider } from "./ui/sidebar";

export function SetupGate({ children }: { children: React.ReactNode }) {
  const status = useSetupStatus();

  useEffect(() => {
    clearPersistedNeonSecrets();
  }, []);

  if (status.initializing) return null;

  if (!status.error && !status.ready && !status.skipped) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <LabsBanner />
        <SetupLanding status={status} />
      </div>
    );
  }

  return (
    <SidebarProvider className="min-h-0 flex-1">
      <Sidebar />
      <SidebarInset className="bg-background">
        <TopBar />
        <LabsBanner />
        {status.error && (
          <ConfigErrorBanner
            loading={status.loading}
            onRetry={() => void status.refresh().catch(() => undefined)}
          />
        )}
        {!status.error && !status.ready && status.skipped && (
          <UnconnectedBanner onConnect={status.unskip} />
        )}
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
        <AppFooter />
      </SidebarInset>
    </SidebarProvider>
  );
}

function ConfigErrorBanner({
  loading,
  onRetry,
}: {
  loading: boolean;
  onRetry: () => void;
}) {
  return (
    <Notice
      tone="warning"
      className="flex-wrap items-center gap-x-2 gap-y-1 rounded-none border-x-0 border-t-0 px-8 py-2 text-caption"
    >
      <NoticeIcon>
        <Plug />
      </NoticeIcon>
      <span className="text-foreground">
        Couldn&apos;t verify the Neon connection. The app is still available;
        retry when the connection is back.
      </span>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={onRetry}
        disabled={loading}
        className="font-medium text-[#f59e0b] underline underline-offset-2 hover:bg-[#f59e0b]/10 hover:text-[#f59e0b]"
      >
        {loading ? "Retrying…" : "Retry"}
      </Button>
    </Notice>
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
