# Ultraplast Universal Conveyor Components Designer (v0.3)

Browser-based parametric design tool for Ultraplast Chainbelts Private Limited (https://www.ultraplastindia.com/).
Search a component, enter parameters, get calculated dimensions, a 2D drawing and a 3D model, then export CAD files.
**Every result is PRELIMINARY and must be validated by an engineer before manufacture.**

## What works in v0.3
| Area | Status |
|---|---|
| Search | Header search on every page (press `/`), autocomplete, category/material filters, searchable size pickers, search in Saved designs and Coverage |
| Components | **21 families, 585 ready-made variants**: roller chain sprocket (ISO 606), stepped shaft, deep-groove bearing, parallel key, washer, hex nut, hex bolt, socket cap screw, dowel pin, bushing/sleeve/spacer, conveyor roller, hexagonal shaft, belt pulley, guide/wear wheel, wear strip, angle guide rail, U-channel, round tube, rectangular hollow section, adjustable leg, mounting/transfer plate |
| Minimum-value input | **Quick mode**: enter only the key values (for example sprocket: chain, teeth, bore); everything else is derived and listed. **Advanced mode** exposes every parameter. Both modes use the same calculations |
| Accuracy | Tessellation within 0.003 mm of the true curve. Automated tests prove every dimension on every drawing equals the geometry it measures, DXF coordinates equal the sheet coordinates (0.0001 mm), and each component's formula mass equals the volume of its 3D geometry |
| 2D drawing | Dimensioned views, section, detail, isometric edge view, A3 title block with logo, zoom/pan, layer toggles, measure, click-to-select, edit dimensions that are direct parameters |
| 3D model | Orbit/zoom/pan, standard views, wireframe, section, exploded, hide/show, selection, finish controls |
| Assembly designer | Add/duplicate/remove, numeric position and rotation, nudge, align on an axis, bore fit and interference checks, exploded view, 2D assembly drawing, BOM, **roller conveyor section preset**, save/open/import/export |
| Exports | DXF, SVG, PNG, PDF drawing (watermark), spec PDF, STL, OBJ, GLB, GLTF, STEP, BOM CSV, dimension CSV, project JSON, full ZIP, for parts and assemblies |
| Storage | Browser storage (IndexedDB) with import/export. See "Optional cloud database" below |
| Not yet | 77 of 125 catalogue items (plastic chains and belts, motors/gearboxes, complete frames, most assemblies), Ultraplast proprietary data, dragging parts in 3D. See `docs/LIMITATIONS.md` and the in-app Coverage page |

**Read `docs/LIMITATIONS.md` first.** 138 automated tests pass. Deployment of v0.2 was confirmed working; v0.3 has been type-checked and tested but the new screens have not been opened in a browser by the author.

## Windows: first-time setup
1. Install **Node.js LTS** from https://nodejs.org (accept defaults). Restart your computer if asked.
2. Extract the ZIP. Open the `ultraplast-designer` folder, click the address bar, type `cmd` and press Enter.
3. **Add the logo:** copy your `Logo.png` into `public\assets\` (exact name `Logo.png`).
4. Install packages (needs internet, takes a few minutes):
   ```
   npm install
   ```
5. Pin the CAD kernel versions: run `npm ls replicad replicad-opencascadejs`, then in `package.json` replace both `"*"` with the shown version, for example `"^0.18.0"`, and run `npm install` again.
6. Start the app: `npm run dev` and open the address it prints (usually http://localhost:5173).
7. Run tests: `npm test`. Check types and build: `npm run build`.
8. Try the sample files in `samples\` via **Saved designs > Import project file**.

If something fails, copy the full red error text; it points to the exact file and line.

## Put it on GitHub and Vercel
1. Create a free account at https://github.com and click **New repository** (name: `ultraplast-designer`, keep it Private). Do not add a README.
2. Install **Git for Windows** (https://git-scm.com). In the project folder, in `cmd`:
   ```
   git init
   git add .
   git commit -m "Ultraplast designer v0.3"
   git branch -M main
   git remote add origin https://github.com/YOUR-USER/ultraplast-designer.git
   git push -u origin main
   ```
   (GitHub asks you to sign in in the browser the first time.)
3. Go to https://vercel.com, sign in with GitHub, click **Add New > Project**, pick the repository, and press **Deploy**. Vercel detects Vite automatically (`vercel.json` is included). You get a public `.vercel.app` address.
4. **Updating the live site:** replace the files in your folder with the new version (keep your `public\assets\Logo.png` and `node_modules` if present), then:
   ```
   git add .
   git commit -m "Update"
   git push
   ```
   Vercel rebuilds and redeploys within a minute or two.

## Technology and why
React + TypeScript + Vite (fast, type-safe, static hosting on Vercel). three.js + react-three-fiber (3D viewport). replicad on OpenCascade WebAssembly (true B-rep solids and genuine STEP export in the browser; no server). jsPDF (vector PDF), JSZip (packages), idb (IndexedDB). Vitest for tests. No databases, no extra hosting, no secrets.

## Architecture (short)
- `src/families/`: each family has pure calculation, 2D views and a `geo()` made of exact primitives (`src/core/prims.ts`). The 3D mesh, the STEP solid, the projected views and the assembly checks all derive from that one description.
- `src/assembly/`: placement, fit and interference rules, BOM, assembly drawing and exports.
- `src/cad2d/sheet.ts`: scales views, expands dimensions/hatching, builds the title block. SVG, DXF and PDF all consume the same sheet entities.
- `src/exporters/`: file writers. `src/storage/`: IndexedDB and project files. `src/data/`: standards tables and the catalogue register.

## Local storage warning
Saved designs live only in this browser on this computer. They are not synced between devices and can be erased with browser data. Use Export to back up.

## Optional cloud database (Neon)
Not needed today: saving works in the browser. A database only becomes useful if you want designs saved to your account and available on other computers, or shared by link. That needs a Neon Postgres database, a small Vercel API (`/api` functions) that holds the connection string as a secret environment variable, and real sign-in so people cannot read each other's designs. Tell me you want it and I will say exactly what to create in Neon and Vercel; no keys ever go in the front-end code.

## What is new in v0.4
- **Custom components (enter values only):** three new families in category J: *Custom block / plate*, *Custom round part* (up to three diameters and an optional bore) and *Custom outline part* (any flat shape typed as x,y points, with optional round holes and cut-outs). Any material, or your own density. Each gives the 2D drawing, 3D model, mass and all exports.
- **Image to 3D:** menu *Image to 3D*. Upload a picture, the outline is traced in your browser, you enter one real size and a thickness, and it creates a *Custom outline part*. One picture gives an extruded outline only (no depth detail). Always check it against the real part.
- **Neon cloud database and accounts:** sign in on the *Account* page to save designs, assemblies, custom parts and pictures in Neon. Setup is in `docs/NEON_SETUP.md`. Without the setup the site works as before, saving in the browser.
- New files: `api/` (server functions), `db/schema.sql`, `src/cloud/`, `src/families/custom/`, `src/lib/trace.ts`, `src/pages/ImagePage.tsx`, `src/pages/AccountPage.tsx`, `tests/custom.test.ts`, `.env.example`. The earlier "Optional cloud database" section above is now implemented.

## What is new in v0.5
- **Sprocket (all types)** family: one value-driven sprocket for single, duplex, triplex, multi-strand, double single, bush, QD, steel split, drive, drum, industrial and shaft-style sprockets (number of strands, distance between strands, hub on one or both sides, flange bolt holes, split). The old single-strand *Roller chain sprocket* is unchanged.
- **Component types** page (`#/types`): a library with one type for every catalogue item (125) plus the 12 sprocket styles. Each opens the designer with starting values. Items without their own engineering model start from a generic value-based block or turned part. The administrator can add or edit types; they are stored in the Neon table `component_types`.
- Server function `api/types.ts`; tests in `tests/types.test.ts`.

## What is new in v0.6
- **Login with email code (OTP):** when email is set up (Settings > Email), sign-up and every sign-in need a 6-digit code mailed to the person (valid 10 minutes, one use, 5 tries). Forgot-password by email code. Nothing changes until an administrator switches email on, so the site keeps working the way it did.
- **Settings page (administrator only):** users (make/remove admin, disable, set password, delete), Email (SMTP) with test, Security (code at every sign-in), AI services (a separate key, model and on/off for Anthropic, OpenAI, Gemini, Stability and Meshy; a daily limit per person). Keys and the mail password are stored **encrypted** in the database and are never sent back to the browser.
- **Image to 3D has four tabs:** Flat outline (as before), **Turned part** (shafts, rollers, bushes), **Stepped block**, and **AI helper** (recognise the part, or build a 3D mesh). Every value can be edited afterwards in the designer.
- **New component types:** *Custom turned part* (up to 12 steps) and *Custom stepped block*.
- **3D viewer:** Front, Back, Left, Right, Top, Bottom and Isometric views everywhere.
- New environment variables: **none**. New database tables/columns are created automatically (`db/schema.sql` shows them). New package: `nodemailer`.

### Setup (after uploading v0.6 to GitHub and redeploying)
1. Open the site, sign in as the administrator, open **Settings > Email**.
2. Gmail: Google Account > Security > turn on 2-Step Verification > App passwords > create one. Press "Use Gmail settings", enter your Gmail address and the 16-character app password, **Save**, then **Send test** and check your inbox. Only then tick "Send email codes" and Save again.
3. **Settings > AI services:** paste the key of any AI you have, tick "Use this AI", Save, press "Test saved key". Add more at any time; the Image to 3D page uses whichever are switched on (preferred first, the next one if one fails).
4. Open **Image to 3D** and try each tab.

### v0.6.1: sign-in first, access by approval
- When the cloud database is connected, the site shows **only the sign-in page** until the person is signed in. Nothing else (components, designer, saved designs) is visible before that.
- A new person presses **Request access**, enters name, email and password (and the email code if email is on). They see "Access request sent" and **cannot sign in until the administrator approves** them.
- The administrator opens **Settings > Users**: waiting requests are marked "Waiting for approval" with **Approve** or **Reject**.
- The very first account becomes the administrator and is approved automatically. Everyone who already had an account stays approved.
- Without the cloud database (browser-only mode) there is no server to check anyone, so the site stays open as before.

### v0.6.2: professional sign-in page
The sign-in / request-access page now has a full-screen layout (company panel + form card, works on phones). Put the real logo at `public/assets/Logo.png`: it then appears on this page, the header, the footer, drawings and PDFs automatically.

### v0.6.4: new logo
Updated `public/assets/Logo.png` to the new logo. A step-by-step sign-in guide is in `docs/LOGIN_GUIDE.md`.

### v0.7: tidier header
One clean header line on wide screens (logo, search, menu, and a user chip with initials, name and role at the right); on laptops the menu moves to a second row. No features changed.

### v0.8: Conveyor tools, favourites
- New page **Conveyor tools** (menu): conveying speed, throughput, chain length and centre distance, sprocket pitch diameter, drive power and torque, roller pitch. Textbook formulas shown under each result; preliminary sizing only. Pure code in `src/lib/convcalc.ts` with tests in `tests/convcalc.test.ts`.
- **Component types:** star any type as a favourite, filter "Favourites only", and a "Recently used" row for one-click return. Stored in this browser only.

### v0.9: reliability upgrade
Input limits enforced everywhere, crash-safe pages, autosave and recovery, a validation panel before export, four user roles, upload checks, picture-reading confidence with confirmation, security headers, 100+ new tests. Read `docs/AUDIT_REPORT.md` first: it lists what was tested, what was not, and a 10-minute checklist for your side.

## What is new in v1.0: every catalogue item has a model
- **13 new component families** (generic standard-style models built from typed values, NOT Ultraplast's proprietary geometry): *Modular chain / belt* (flat, grid, perforated, friction top, ball top, cleated, ribbed), *Roller chain* (plain, K1 lugs, hollow pin, from the ISO 606 / ASME B29.1 table), *Bearing housing* (square or round flange, pillow block), *Shaft coupling* (sleeve, jaw, flange), *Shaft collar*, *Retaining ring*, *Take-up / tensioning unit*, *Bent bracket / stop / side guard / clamp / mount*, *Motor / gearbox* (outline only), *Set screw*, *Grease nipple*, *Tapered roller*, *Curved conveyor section*.
- The Coverage page now shows **125 of 125** catalogue items covered. Most are marked **partial** with a plain note of what is missing (for example "straight module only, no side-flex clearance"). Nothing is claimed beyond what the model does.
- Component types opened from the library start with sensible values for that item (for example "Open-grid belts" starts as a grid belt, "Stainless steel chains" starts in SS 304).
- Totals: 40 families (was 27), 714 ready variants (was 627). **No new environment variables, no database change, no new packages.**
- Tests: 407 automated tests pass (new file `tests/conveyor.test.ts`; every new family is also in the stress test that tries extreme values).
- Not verified here: the real `npm run build`, the browser screens, STEP/STL/PDF file writing and opening exports in CAD (this environment has no internet). See docs/LIMITATIONS.md.

### v1.0.1: reference chain sizes
- 7 ready table-top chain sizes (`MB-REF-*`, pitch 38.1 mm, several widths and rod sizes) taken from the basic numbers in public Rexnord and System Plast data sheets. See `docs/REFERENCE_DATA.md` for the exact values, sources and cautions. They are size references only, not Ultraplast products, and the shape is still the generic module.
- 408 automated tests pass. No new environment variables, database changes or packages.

## What is new in v1.1: Sprocket catalogue
- New page **Sprocket catalogue** (menu). 22 conveyor sprocket types in four groups: hub styles (Type A flat plate, B single hub, C double hub, D detachable hub), strand capacities (simplex, duplex, triplex, multi-strand, double-single), mounting and bores (finished bore, plain bore, Taper-Lock, QD, square bore, split) and conveyor applications (double-pitch, idler, segmental rim, drum / traction wheel, modular belt, table-top / slat chain, shear pin).
- Every entry has a two-sentence overview, standard materials, bore options, chain compatibility, load duty, applications, advantages, maintenance benefits and the list of customisable values. Filter by group, search, download the table as CSV.
- **Customise values** (chain, teeth, bore, strands, material), then **Open in designer** for the 2D drawing, 3D model and exports. Taper-Lock, QD, square bore, split halves, segmental rim, modular-belt and table-top tooth forms are approximated in the 3D model; each entry says what is not drawn.
- Data file: `src/data/sprocketCatalog.ts` (edit the text there). No new environment variables, database changes or packages. 412 automated tests pass.
