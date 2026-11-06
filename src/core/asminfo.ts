/** What the assembly checker needs to know about a placed component (all in the component's local frame, axis = Z). */
export interface AsmInfo {
  /** informational only */
  role: 'shaft' | 'bore' | 'other';
  /** bore-part: inner bore diameter (shaft fit is checked against this) */
  bore?: number;
  /** true when the bore is a thread (no shaft clearance fit check) */
  thread?: boolean;
  /** shaft-like: diameters available along local z (shafts, roller stubs, bushing outsides) */
  sections?: { d: number; z0: number; z1: number }[];
  /** chain id for sprockets */
  chain?: string;
  chainPitch?: number;
}
