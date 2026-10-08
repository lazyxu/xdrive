# Shared Mobile Web Shell implementation plan

> Required execution skill: `superpowers:executing-plans`. The repository's one-work-commit policy takes precedence over per-task commits; amend the same work commit throughout.

**Goal:** Deliver phase 1 of `docs/mobile-web.md`: compact Web navigation and a stable, viewport-sized shared workspace shell.

**Architecture:** Extract the existing core destination data for both sidebar and compact navigation. Keep one shared Shell/Content tree, with responsive navigation presentation and a Web-owned inert background boundary for Viewer. Preserve current routes, controllers and role/capability inputs.

**Stack:** React 18, TypeScript, MUI 7, Vite, Node's built-in test runner; real-browser smoke where an engine is available.

**Base:** `92b7d58370542fd0597433fdc4c3969e325a113c`, branch `feat/mobile-web-shell`, exactly one amended work commit.

## 1. Establish failing acceptance

- Add `desktop/tests/shared-workspace-compact-navigation.cjs` to execute the real shared model and component event handlers. Cover existing Web role filtering, capabilities, order, active destination, callback identity/modifiers, More open/close and disabled navigation.
- Update only superseded layout assertions in `desktop/tests/web-shell.cjs` and `web/scripts/check-workspace-surfaces.mjs`: all-width viewport/flex sizing, stable Content scrolling and removal of fixed mobile Files height.
- Run these tests against the unchanged implementation and confirm failures describe the missing behavior.

## 2. Share the destination model and add compact navigation

- Add `ui/shared/src/mui/WorkspaceNavigation.tsx`, retaining current destination keys/labels/icons and an optional compact label.
- Add `ui/shared/src/mui/WorkspaceCompactNavigation.tsx` using MUI bottom navigation and Drawer. Pass the original event to the existing callback, retain accessible current/open state and close the Drawer on lifecycle changes.
- Update `SidebarNav.tsx` to render its core items from the same model and `WorkspaceSidebar.tsx` to select compact presentation only for responsive narrow viewports. Preserve current exported section types and desktop composition.
- Adjust the existing core-navigation source guards to check the model's ownership, retaining unrelated contracts.

## 3. Fit the Web workspace to available height

- Update `WorkspaceShell.tsx` and `WorkspaceContent.tsx` to retain one content tree, flex/grid shrinking and explicit scroll ownership.
- Update `web/src/App.tsx` with a dynamic viewport, safe areas, background inert state and compact-navigation disabling while Viewer is active.
- Remove fixed mobile heights in App and the 420 px minimum in `web/src/WebFileExplorer.tsx`.
- Reconcile `web/src/styles.css` viewport minimum. Keep existing viewport metadata: review found that adding `viewport-fit=cover` would change Viewer/Auth/PublicShare safe areas beyond this phase.
- Close and synchronously gate the account menu/settings/update-confirmation portals when Viewer becomes active, as well as the compact More drawer.

## 4. Verify and review

- Run the focused shell/navigation/runtime tests, Web lint/build and Desktop typecheck/applicable tests.
- Exercise a real renderer at the specified widths/heights. Distinguish shared probe tests from actual Files/Gallery and device acceptance.
- Ask an independent reviewer to inspect shared ownership, route/permission preservation, Drawer lifecycle and viewport/Viewer risks. Fix material issues and rerun the affected checks.

## 5. Deliver

- Record exact validation and remaining device limits in `docs/mobile-web.md`.
- Fetch the target remote, preserve the fixed baseline unless an actual conflict requires reconstruction, amend the single work commit, and verify the branch has one commit above its merge base.
- Push the tested branch, open the GitHub PR, and require its authoritative CI to pass. Follow the repository's linear-history merge and automated branch-cleanup workflow.
