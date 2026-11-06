// Used only when replicad-opencascadejs is not installed: lets the site build and shows a clear error on STEP export.
export default function missing() { return Promise.reject(new Error('The OpenCascade CAD kernel (replicad-opencascadejs) is not installed, so STEP export is unavailable.')); }
