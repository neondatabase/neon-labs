"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { getNeonSettings, setNeonSettings } from "@/lib/neon-settings";
import { neon } from "./ui";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function NeonSettingsModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [projectId, setProjectId] = useState("");
  const [sourceConn, setSourceConn] = useState("");
  const [targetConn, setTargetConn] = useState("");

  useEffect(() => {
    if (open) {
      const s = getNeonSettings();
      setApiKey(s.apiKey);
      setProjectId(s.projectId);
      setSourceConn(s.sourceConnectionString);
      setTargetConn(s.targetConnectionString);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-[520px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Neon connection</DialogTitle>
          <DialogDescription>
            Used to list your Neon projects and read their versions. Stored
            in this browser only.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setNeonSettings({
              apiKey: apiKey.trim(),
              projectId: projectId.trim(),
              sourceConnectionString: sourceConn.trim(),
              targetConnectionString: targetConn.trim(),
            });
            onSaved?.();
            onClose();
          }}
        >
          <div className="mb-4">
            <Label htmlFor="neon-api-key" className="mb-1.5">
              API key
            </Label>
            <Input
              id="neon-api-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="napi_..."
            />
            <a
              href="https://console.neon.tech/app/settings/api-keys"
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-flex items-center gap-1 text-label text-[#00e599] hover:underline"
            >
              Generate one in the Neon console
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          <div className="mb-5">
            <Label htmlFor="neon-project-id" className="mb-1.5">
              Project ID
            </Label>
            <Input
              id="neon-project-id"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="floral-glade-12345678"
              className="font-mono text-caption"
            />
            <p className="mt-1.5 text-label text-[#9ca3af]">
              Find this in your project URL or the Project page → Settings.
            </p>
          </div>

          <div className="mb-3 border-t border-border pt-4">
            <p className="tag mb-2">Live schema diff (optional)</p>
            <p className={`mb-3 text-label ${neon.muted}`}>
              For cross-version diffs (e.g. PG14 source vs PG17 target project).
              Connection strings are read-only on the server side.
            </p>
          </div>

          <div className="mb-4">
            <Label htmlFor="neon-source-conn" className="mb-1.5">
              Source connection string (PG{" "}
              <span className="text-[#9ca3af]">old version</span>)
            </Label>
            <Input
              id="neon-source-conn"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={sourceConn}
              onChange={(e) => setSourceConn(e.target.value)}
              placeholder="postgresql://user:pass@host/db?sslmode=require"
              className="font-mono text-label"
            />
          </div>

          <div className="mb-5">
            <Label htmlFor="neon-target-conn" className="mb-1.5">
              Target connection string (PG{" "}
              <span className="text-[#9ca3af]">new version</span>)
            </Label>
            <Input
              id="neon-target-conn"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={targetConn}
              onChange={(e) => setTargetConn(e.target.value)}
              placeholder="postgresql://user:pass@host/db?sslmode=require"
              className="font-mono text-label"
            />
          </div>

          <DialogFooter>
            <DialogClose
              render={
                <Button size="lg" type="button" variant="outline">
                  Cancel
                </Button>
              }
            />
            <Button size="lg" variant="white" type="submit">
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
