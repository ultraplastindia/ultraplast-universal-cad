# Known limitations (v0.3)

- Built in an environment WITHOUT internet access. 138 automated tests pass: formulas, ISO 606 tooth profile over all chains and tooth counts, every variant of all 21 families, drawing layout, DXF round-trip, dimension-versus-geometry accuracy, mass-versus-volume cross-checks, tessellation tolerance, picking/editing bindings, assembly fit and interference, the conveyor preset, project/assembly files and search. v0.2 was deployed and confirmed working; the v0.3 screens were type-checked against stand-in library types but not opened in a browser by the author. The React UI, 3D viewer, PDF/PNG/GLB/GLTF export, ZIP packaging, IndexedDB storage and the STEP export (replicad / OpenCascade) have NOT been run in a browser by the author. Expect to fix small issues on first run and send the error text.
- `vite.config.ts` finds the OpenCascade files inside the installed `replicad-opencascadejs` package itself (`findOc.mjs`), because newer package versions block deep imports. If the files are missing the site still builds and STEP export shows an error message. If STEP fails in the browser, send me the message shown.
- `replicad` / `replicad-opencascadejs` are listed as "*" because exact versions could not be verified offline. After `npm install`, pin both to the installed version (`npm ls replicad replicad-opencascadejs`). Assembly STEP needs a compound builder (`compoundShapes` or `makeCompound`); if your version has neither, the ZIP contains per-part STEP files instead.
- Logo: none was supplied. Put it at `public/assets/Logo.png`.
- Sprocket tooth profile follows the ISO 606 limit formulas with an S-curve (seat arc, convex flank arc, tip arc). Verify the arc arrangement against the standard figure or supplier drawing; tooth side chamfer/radius and tolerances are not modelled.
- No proprietary Ultraplast plastic chain, belt or sprocket geometry (needs your catalogue data). 77 of 125 catalogue items remain pending, notably all plastic chains and belts, motors/gearboxes, frames beyond single tube members, conveyors and drive/transfer assemblies.
- Quick mode derives secondary values with fixed rules (see `src/families/autofill.ts`); they are sensible defaults, not optimised designs. Advanced mode lets you set every value.
- Dimensions are in millimetres only (no inch display).
- Several implemented items are partial (see the Coverage page), for example fasteners = hex nut only, wear strips = flat strips, rollers = plain tube rollers.
- 2D: views are generated, not hand-drawn; isometric views are edge projections without hidden-line removal; one detail view (sprocket tooth). Dimensions can be edited where they are direct parameters; calculated dimensions cannot. No moving of views, measure tool has no snapping.
- 3D: part selection, hide/show, exploded (per-component), section, wireframe. Dragging parts in the 3D view is not implemented; place parts with the numeric position/rotation fields, nudge buttons and "align coaxial".
- Assembly: no kinematic mates, no chain/belt path, no shaft keyways. Interference is exact only for coaxial round parts (bounding boxes otherwise). Assembly drawings are four projected views with the BOM in the notes.
- Bearing internals illustrative; no load ratings.
- Local storage: IndexedDB, per browser and device, not synchronised.

## v0.4 additions: limits to know
- **Custom components** are plain extruded or turned shapes: no bends, chamfers, threads, keyways or tolerances. Calculations are limited to geometry and mass.
- **Image to 3D** uses one picture, so it recovers only the outline (and visible round holes or cut-outs). Accuracy depends on the picture (straight-on, plain background, no shadows) and on the one real measurement you enter. Always verify the size and shape against the real part.
- **Cloud database:** there is no "forgot password" email yet; reference tables stored in the database are a copy, the app's calculations still use the built-in tables.

## v0.5 additions: limits to know
- **Sprocket (all types):** tooth plates are the ISO 606 form; hubs, bush flanges and bolt holes are simple cylinders. Taper bores for bush or QD fittings, splines, set screws, and the two halves of a split sprocket are not modelled (split is shown as a line only). Strand distance defaults are standard transverse pitch values: confirm with your chain maker.
- **Value-based component types** (for example belts, motors, gearboxes, chains) are generic blocks or turned shapes with starting sizes, not real models of those products. Use them for envelopes, simple parts and quick drawings.

## v0.6 additions: limits to know
- **A picture cannot give an exact size.** You always type one real measurement and everything is scaled from it. Perspective, lens distortion and shadows change the result: take the photo straight on, from far away (zoom in) rather than close up.
- **Turned part** reads the thickness along the part, so it assumes the part is round and symmetrical. Bores, keyways, threads, chamfers and grooves smaller than a few percent of the length are not seen; type them in the designer.
- **Stepped block** reads width and height from a front photo. Depth cannot be seen: you give it. Blocks are centred on each other.
- **AI recognise** gives relative proportions and a guess of the type and material. It can be wrong. The real size is always your typed measurement. Results are checked (limits, valid shapes) before use, and anything outside the limits is dropped.
- **AI 3D mesh** (Stability, Meshy) makes a triangle mesh you can view from every angle and download as GLB or STL. It is **not** parametric CAD: there are no editable values, no drawing and no mass. Size is scaled from the one measurement you type. Quality depends on the picture and the AI service.
- **AI costs money and is metered by the AI company**, not by this app. The per-person daily limit in Settings limits your cost. Model names (for example `claude-sonnet-5-5`, `gpt-4o`, `gemini-2.5-flash`) are editable in Settings because providers rename models; if a test fails with "model not found", change the model name.
- **Email codes** use your own Gmail or Outlook account. Gmail needs 2-step verification and an app password. Microsoft has been switching off basic (password) SMTP for many Outlook accounts; if the test email fails, use Gmail or a company SMTP server. Free mail accounts have daily sending limits.
- **Locked out?** If email stops working and you cannot receive codes, switch email off in Neon: `UPDATE settings SET value = jsonb_set(value, '{enabled}', 'false') WHERE key = 'mail';` (SQL editor). Keep at least one administrator you can reach.
- Changing `AUTH_SECRET` makes the saved mail password and AI keys unreadable: enter them again in Settings.
- Settings is hidden from non-administrators and also refused by the server for them.
- **Access approval** needs the cloud database. In browser-only mode (no Neon) nobody can be blocked, because everything runs in the visitor's own browser. The administrator is not emailed about new requests; check Settings > Users.
