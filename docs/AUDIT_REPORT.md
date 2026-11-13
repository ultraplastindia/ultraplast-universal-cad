# Audit and reliability report (v0.9)

Scope: the existing Ultraplast Conveyor Designer. Nothing was rebuilt; no working module was removed.
Honesty note: this audit was done in a build workspace **without** a browser, without npm access, without a database and without CAD software. Everything marked TESTED was run by automated tests there. Everything marked NOT TESTED still needs a check on your side (list at the end).

## 1. Evidence (automated tests, all passing)
- **300 tests pass** (was 195 before this audit round).
- **Stress test (new):** 27 components x about 1,566 cases = every number at its minimum, maximum, zero, negative, 1 000 000 000, NaN and Infinity, 12 random in-range sets each, every select option, plus all 627 built-in variants. For each case the result must be either a complete finite drawing + 3D model + valid DXF/SVG text, or a refusal with a readable reason. It must never crash and never contain NaN/Infinity.
- **Damaged saved designs (new):** garbage values in a saved design are repaired; the design still opens (27 components).
- **Built-in designs regression (new):** all 627 built-in variants open through the full pipeline.
- Existing tests kept: dimension text equals geometry, DXF equals the drawing, mass equals model volume, drawings fit the sheet, custom shapes, type library, image tracing.

## 2. Issues found and fixed
| # | Finding | Severity | Fix | Proof |
|---|---|---|---|---|
| 1 | Values far outside the form limits (for example 1 000 000 mm) were accepted by the calculation and made the app run out of memory / overflow the stack (browser tab crash). Form limits were only hints. | High | `rangeErrors` / `safeCalculate` in `src/lib/design.ts`: limits are enforced for every number, NaN is refused, any unexpected exception becomes a readable message. | stress test |
| 2 | A crash while building the drawing or 3D model could blank the page. | High | `buildDesign` catches it and returns an error result; new `ErrorBoundary` shows "Something went wrong" with Reload and keeps autosaved work. | stress test, code review |
| 3 | Sprocket bore field allowed at most 150 mm while a built-in variant (24B-1, bore 156) exceeded it. Found by the new limits check. | Medium | Limit raised to 200 mm. | regression test |
| 4 | Sprocket (all types) bolt fields had a minimum of 10 / 2 although 0 means "none". | Low | Minimum 0; the calculation still requires real values when bolts are used. | stress test |
| 5 | No protection against losing work (closed tab, crash). | Medium | Autosave to the browser every second, "Unsaved work found: Restore / Discard" when reopening. Saved designs are not re-offered. | code review (browser not run) |
| 6 | Only two roles (admin / user). | Medium | Roles Administrator, Engineer, Employee, Viewer, enforced on the server (viewer: no save, upload or AI; employee: no AI). Role selector in Settings. New column `users.role` is added safely, existing admins become `admin`, everyone else `engineer`. | unit tests of the rules; API not run against a database |
| 7 | Uploaded "pictures" were only checked by their declared type. | Medium | First bytes (JPEG/PNG/WebP signature) are verified for uploads and AI requests. | unit test |
| 8 | Access requests could be spammed by a script. | Low | At most 30 waiting requests per hour. | code review |
| 9 | No browser security headers. | Low | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS in `vercel.json`. A Content-Security-Policy was **not** added because it can break the 3D viewer and the STEP kernel (WASM); add it only after testing. | config review |
| 10 | Values read from pictures looked like confirmed values. | Medium | Reading-confidence score (contrast, cut-off, close-call edges, ignored objects, size) with reasons, and a required tick-box "I have checked these values against the real part" before a part is created. | unit tests |

## 3. New: validation engine
Designer > Downloads shows a checklist before any export: values inside limits, calculation conflicts, engineering warnings, drawing valid, 3D model valid and its overall size, very large/small model, features thinner than 0.5 mm, material, standards, and tolerances (the drawings carry nominal sizes only, which is reported as a warning). Errors block export (buttons were already disabled when the calculation fails). The panel always states: **geometry and data checks only, NOT an engineering, strength or manufacturing approval.**

## 4. Export formats
| Format | Status |
|---|---|
| DXF, SVG | Generated from the drawing; tested that they are complete, finite and equal to the drawing. |
| PDF, PNG | Built in the browser from the drawing. NOT TESTED here (needs a browser). |
| STL, OBJ, GLB, glTF | Built from the same primitives as the 3D view. The geometry behind them is tested (sizes, mass, finite coordinates). File writing itself NOT TESTED here (needs the three.js package). |
| STEP | Real B-rep from the OpenCascade kernel in the browser. NOT TESTED here (needs the kernel and a browser); open one in your CAD to confirm. |
| **IGES, DWG** | **Not provided.** Nothing fake is produced. DWG is a closed format; use DXF. IGES would need an extra kernel export that was not added here. |

## 5. Security review (code read through)
Checked: every design and upload query is limited to the signed-in owner; writes need same-origin + JSON; passwords use scrypt; sessions are signed httpOnly cookies; login is rate-limited; email codes are stored hashed; keys are stored encrypted and never returned; admin actions are checked on the server; the last administrator cannot be removed; AI downloads are limited to the Meshy host; SQL is always parameterised. NOT TESTED against a live database or by a penetration test. Backups: Neon keeps point-in-time history on its plans; confirm the retention of your plan in the Neon console and consider a weekly export.

## 6. Not done / limits (please read)
- **PDF drawing upload and OCR of dimensions:** not added. It needs a PDF/OCR library (a new dependency, against your rule). Pictures are read by outline tracing and optional AI. AI readings are suggestions.
- **Performance tuning and large-assembly profiling, memory-leak hunting, console-warning clean-up:** not measured, because there was no browser. The code already frees 3D geometry on change.
- **"Opens in compatible CAD software":** requires you to open the exported STEP/DXF in your CAD and compare sizes.
- **Tolerances and manufacturing rules** are not modelled; only the generic 0.5 mm thin-feature check exists.
- **Auth/permission tests against a live API** need a test database; only the rule logic is unit-tested.
- **Custom field / parameter templates:** the Component types library (admin-editable, stored in the database) is the existing mechanism; no new template system was added.

## 7. Files changed this round
New: `src/lib/validation.ts`, `src/ui/ErrorBoundary.tsx`, `api/_lib/roles.ts`, `api/_lib/files.ts`, `tests/reliability.test.ts`, `docs/AUDIT_REPORT.md`.
Changed: `src/lib/design.ts`, `src/lib/trace.ts`, `src/pages/DesignerPage.tsx`, `ImagePage.tsx`, `ImageModes.tsx`, `SettingsPage.tsx`, `src/main.tsx`, `src/cloud/client.ts`, `src/families/sprocket/calc.ts`, `multi.ts`, `api/_lib/db.ts`, `session.ts`, `api/admin.ts`, `account.ts`, `designs.ts`, `uploads.ts`, `ai.ts`, `db/schema.sql`, `vercel.json`, `tests/v06.test.ts`, `src/styles.css`.

## 8. Deploy
Upload to GitHub, redeploy on Vercel. No new environment variables. The database change (`users.role`) is applied automatically and safely (`ADD COLUMN IF NOT EXISTS`, default `engineer`). Then follow "Check on your side" below.

## 9. Check on your side (10 minutes)
1. Open a component, type 1000000 in a size: you must see a clear "above the maximum" message, not a freeze.
2. Designer > Downloads: the Validation list appears. Export DXF and STEP and open them in your CAD: compare two dimensions with the screen.
3. Change a value, close the tab, reopen the same component: "Unsaved work found" appears.
4. Settings > Users: set a test user to Viewer; sign in as that user: Save is disabled and the server refuses uploads.
5. Image to 3D: the confidence box and the confirmation tick-box appear before "Create".
