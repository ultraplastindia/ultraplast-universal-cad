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
