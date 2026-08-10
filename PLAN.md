# Sidebar + data table + wizard stack

Three layers on top of PR #12 (`feat/neon-ui-registry`). Bottom to top:

```
(main) <- feat/neon-ui-registry (#12, open)
       <- feat/sidebar-component
       <- feat/extensions-data-table
       <- feat/new-assessment-wizard
```

Multi-assessment is shelved. Nothing here blocks it later: Layer 3 leaves the
wizard writing into the existing `AssessmentProvider` context, so when the
direction is settled the change is rerouting the final step, not rebuilding it.

Everything below stays on Base UI. Where the `@neon` registry has no component,
we build it on `@base-ui/react` primitives and style it to our tokens rather than
pulling in Radix. No comments in the code.

---

## Layer 1 — `feat/sidebar-component`

`src/components/Sidebar.tsx` is a hand-rolled 197-line `<aside>` with a private
`NavSection`, an org lockup, three nav groups, and a wordmark footer.

### Why this is a port, not an install

`npx shadcn@latest add sidebar` is off the table. It would pull Radix `Slot`,
`Sheet`, `Separator`, and Radix-based `button`, `input`, `skeleton`, `tooltip` —
overwriting the Base UI versions PR #12 just installed and silently reverting
that PR. So we take the shadcn sidebar as a design reference and rebuild its API
on Base UI.

Base UI covers every piece:

| shadcn sidebar needs | Base UI equivalent |
|---|---|
| Radix `Slot` / `asChild` | `useRender` + `mergeProps` |
| `Sheet` for the mobile drawer | `@base-ui/react/drawer` |
| `Separator` | `@base-ui/react/separator` |
| `Tooltip` for collapsed labels | `@neon` tooltip, already installed |
| `Button`, `Input`, `Skeleton` | `@neon` versions, already installed |
| `useIsMobile` | `unstable-use-media-query` |

- [ ] 1. Build `src/components/ui/sidebar.tsx` on Base UI, exporting the same surface as the shadcn component: `SidebarProvider`, `Sidebar`, `SidebarHeader`, `SidebarContent`, `SidebarFooter`, `SidebarGroup`, `SidebarGroupLabel`, `SidebarGroupContent`, `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton`, `SidebarMenuBadge`, `SidebarRail`, `SidebarTrigger`, `SidebarSeparator`, `useSidebar`.
- [ ] 2. Use `useRender` for composition instead of `asChild`, matching the pattern the `@neon` Badge already uses. `SidebarMenuButton` takes `render={<Link href="..." />}` rather than `asChild`.
- [ ] 3. Use `@base-ui/react/drawer` for the mobile sidebar rather than porting Sheet. It is purpose-built for this and removes a whole component from the surface.
- [ ] 4. Style to our tokens: 4px radius, `--sidebar-*` variables already in `globals.css`, dark only. No light-mode branch.
- [ ] 5. Support `collapsible="icon"` with `state` of `expanded` or `collapsed`, persisted so a reload does not reopen it.
- [ ] 6. Bind cmd+b / ctrl+b. Verify it does not collide with an existing binding.
- [ ] 7. No comments in the file. The shadcn original is heavily commented; strip that rather than port it.

### The rebuild

- [ ] 8. Replace `src/components/Sidebar.tsx`'s markup with the new primitives, keeping the three groups (Assessment, Migration tools, Resources) as `SidebarGroup` + `SidebarGroupLabel`.
- [ ] 9. Replace the hand-rolled active logic in `NavSection` with `SidebarMenuButton isActive`, preserving the current rule that `/` matches exactly while others match by prefix.
- [ ] 10. Move the org lockup into `SidebarHeader` and the Neon wordmark into `SidebarFooter`.
- [ ] 11. Add `SidebarTrigger` to `TopBar`, and `SidebarRail` to the sidebar.
- [ ] 12. Collapsed state check: group labels hide, icons stay optically centred, and every item shows its label as a tooltip. This is the state most likely to look wrong.
- [ ] 13. Confirm the Base UI drawer and the Base UI dialog already used by `NeonSettingsModal` coexist cleanly. Both portal; check z-index and focus return.
- [ ] 14. Audit `globals.css` for `--sidebar-*` tokens the component reads but that were never defined. They were written for the hand-rolled version.

---

## Layer 2 — `feat/extensions-data-table`

`src/app/extensions/page.tsx` renders every `ExtensionUsage` row into a `Table`,
with a search `Input` and status filter chips above it, all hand-rolled state.

- [ ] 15. Add `@tanstack/react-table` and build `src/components/data-table.tsx` as a reusable wrapper over the existing `@/components/ui/table` primitives, so the markup and tokens stay ours and TanStack only supplies state.
- [ ] 16. Define columns for the extensions view: Extension, Status, PG 16, PG 17, Notes.
- [ ] 17. Sort on Extension, Status, and both version columns. Notes stays unsorted, it is prose. Sortable headers get a click target and a direction indicator.
- [ ] 18. Wire the existing search box to TanStack's global filter over the name column. Keep the input where it is.
- [ ] 19. Fold the existing status chips in as a column filter rather than adding a second control. They already work and already show counts.
- [ ] 20. Paginate at 25 rows. Footer shows range, total, and prev/next as `Button variant="outline" size="sm"`. Hide the footer below one page.
- [ ] 21. Reset to page 1 on any filter change, so the user is never stranded on an empty page 3.
- [ ] 22. Keep "no extensions match this filter" distinct from "this assessment found no extensions".
- [ ] 23. Build the wrapper generically enough to take the rehearsal and replication tables later, but do not migrate them in this layer.

---

## Layer 3 — `feat/new-assessment-wizard`

`src/app/new/page.tsx` is 774 lines and already thinks in steps: it renders
`Section step={n}` blocks gated on `showStep2` / `showStep3` / `showStep4`, and
renumbers by hand because the upload path has four steps where live has three.
Today every revealed step stays on screen at once.

- [ ] 24. Extract a step machine: `{ id, title, subtitle, isValid, isVisible }` per step, derived from `method`. Replaces the `showStepN` / `stepNComplete` booleans and the `step={method === "live" ? 3 : 4}` renumbering.
- [ ] 25. Show one step at a time with a stepper header marking done, current, and upcoming. This is the actual behaviour change.
- [ ] 26. Wire Back and Continue. Continue disabled until the current step validates, reusing the existing `sourceReady` and `uploadFile` checks. Back never discards entered state.
- [ ] 27. Keep both branches honest: live is method, source project, target version; upload is method, ZIP upload, source version, target version. The machine derives the count, nothing hardcodes 3 or 4.
- [ ] 28. Final step runs the assessment and writes to the existing context, unchanged. Rerouting to a persisted assessment is deferred with the shelved work.
- [ ] 29. Extract the results view below the form (filter chips and change list, from roughly line 556) into its own component. It is a separate concern and inflates the file.
- [ ] 30. Verify the source project picker still renders correctly inside a single-step layout. It was clipped once already by `Card`'s `overflow-hidden` and now depends on `Popover` portalling.

---

## Verification, every layer

- [ ] 31. `npx tsc --noEmit` clean.
- [ ] 32. `npm run build` compiles.
- [ ] 33. `npx eslint src` at or below the 25-error baseline. Those are pre-existing `react-hooks/set-state-in-effect` complaints — do not fix them here, do not add to them.
- [ ] 34. No new Radix dependency in `package.json`. This is the check that Layer 1 stayed honest.
- [ ] 35. Conventional Commits. No `Co-Authored-By` or "Generated with" in commits or PR bodies.
- [ ] 36. `gh stack submit --auto` after each layer, so each PR shows only its own diff.

---

## Risks

1. **Porting the sidebar is more work than installing it.** The shadcn version is ~700 lines carrying real edge-case handling for collapse, mobile, and keyboard. Rebuilding on Base UI means re-earning that. The alternative was reverting PR #12's primitives, which is worse.
2. **`useRender` is not a drop-in for `asChild`.** Call sites read differently, and the sidebar is composition-heavy. Expect the `SidebarMenuButton` + `Link` pattern to need iteration.
3. **TanStack Table is a real dependency for one screen.** Item 23 mitigates by making the wrapper reusable, but if the rehearsal and replication tables never migrate, it stays a heavy answer to a small question.
4. **Layer 3 has no persistence to land in.** The wizard will still lose its result on refresh, exactly as today. Worth knowing so the wizard is not mistaken for a fix to that.
