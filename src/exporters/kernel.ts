/* OpenCascade (WebAssembly) is loaded lazily, only when a STEP export is requested. */
let ready: Promise<any> | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any

export function loadKernel(): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  ready ??= (async () => {
    const [R, oc, wasm] = await Promise.all([
      import('replicad'),
      import('@oc/single'),
      import('@oc/wasm?url'),
    ]);
    const OC = await (oc.default as (o: unknown) => Promise<unknown>)({ locateFile: () => wasm.default });
    (R as any).setOC(OC); // eslint-disable-line @typescript-eslint/no-explicit-any
    return R;
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

/** Builds the B-rep solid with the family's own geometry and returns a real STEP (ISO 10303) file. */
export async function makeStep(build: (R: any) => any): Promise<Blob> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const R = await loadKernel();
  const shape = build(R);
  const blob: Blob = shape.blobSTEP();
  if (!blob || blob.size < 100) throw new Error('STEP generation returned an empty file.');
  return blob;
}
