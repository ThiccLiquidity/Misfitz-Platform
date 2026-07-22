# Local development — the reliable recipe (PowerShell)

Use **`npm run dev`** for anything you want to see change as you edit. It starts Next.js in dev mode
and hot-reloads every file you SAVE in your editor.

```powershell
npm run dev            # http://localhost:3000  — live, hot-reloading
```

Notes / gotchas:
- The FIRST hit on each route compiles on demand, so the first load of a page can be slow. That's normal dev mode, not a hang.
- **Do NOT use `npm start` for editing.** `npm start` serves a FROZEN production build from `.next/`; it never reflects new edits until you rebuild.
- If a change does NOT show up: stop the dev server with `Ctrl+C`, then run `npm run dev` again (the watcher occasionally misses files touched outside the editor).
- Still stale? Force a clean rebuild:

```powershell
Remove-Item -Recurse -Force .next; npm run dev
```

- Only use the production build when you specifically want to verify the exact prod output:

```powershell
npm run build; npm start   # production build, then serve it (not for live editing)
```
