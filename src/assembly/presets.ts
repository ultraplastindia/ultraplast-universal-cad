import type { AsmItem } from './model.ts';
import { newItemId } from './model.ts';
import { getFamily } from '../families/index.ts';
import { AUTOFILL } from '../families/autofill.ts';

export interface RollerConveyorOpts { length: number; width: number; rollerOD: number; pitch: number; frameH: number; frameB: number }
export const rollerConveyorDefaults: RollerConveyorOpts = { length: 1200, width: 400, rollerOD: 50, pitch: 100, frameH: 80, frameB: 40 };

/** Straight roller conveyor section: two U-channel side frames and N tube rollers.
 *  World axes: X along the conveyor, Y up, Z across. Frames open outwards; roller stubs end exactly on the inner web faces. */
export function rollerConveyor(o: RollerConveyorOpts): AsmItem[] {
  const errs: string[] = [];
  const fin = (v: number, n: string) => { if (!Number.isFinite(v) || v <= 0) errs.push(`${n} must be a positive number.`); };
  fin(o.length, 'Length'); fin(o.width, 'Width between frames'); fin(o.rollerOD, 'Roller diameter'); fin(o.pitch, 'Roller pitch'); fin(o.frameH, 'Frame height'); fin(o.frameB, 'Frame flange');
  if (!errs.length) {
    if (o.rollerOD < 30) errs.push('Roller diameter must be at least 30 mm.');
    if (o.pitch < o.rollerOD + 2) errs.push('Roller pitch must be at least 2 mm larger than the roller diameter so rollers do not touch.');
    if (o.length < o.pitch) errs.push('Length must be at least one roller pitch.');
    if (Math.floor(o.length / o.pitch) > 80) errs.push('More than 80 rollers: increase the pitch or shorten the section.');
    if (o.frameH < o.rollerOD / 2 + 10) errs.push('Frame height is too small for the roller diameter.');
  }
  const roller = { ...getFamily('roller')!.defaults, tubeOD: o.rollerOD }, rf = AUTOFILL.roller(roller, 'tubeOD'), sl = Number(rf.stubLength);
  if (!errs.length && o.width < 2 * sl + 60) errs.push(`Width must be at least ${2 * sl + 60} mm for this roller size.`);
  if (errs.length) throw new Error(errs.join(' '));
  const chan = { ...getFamily('channel')!.defaults, height: o.frameH, flange: o.frameB, length: o.length, span: o.length }, cf = AUTOFILL.channel(chan, 'height');
  const frameParams = { ...chan, ...cf };
  const rp = { ...rf, tubeOD: o.rollerOD, tubeLength: o.width - 2 * sl, load: 0, material: 'S235 Steel' };
  const items: AsmItem[] = [
    { id: newItemId(), familyId: 'channel', name: 'Side frame left', params: frameParams, pos: [0, 0, -o.width / 2], rot: [0, 90, 0] },
    { id: newItemId(), familyId: 'channel', name: 'Side frame right', params: frameParams, pos: [o.length, 0, o.width / 2], rot: [0, -90, 0] },
  ];
  const n = Math.floor(o.length / o.pitch);
  for (let i = 0; i < n; i++) items.push({ id: newItemId(), familyId: 'roller', name: `Roller ${i + 1}`, params: rp, pos: [o.pitch / 2 + i * o.pitch + (o.length - n * o.pitch) / 2, o.frameH + 8 - o.rollerOD / 2, -o.width / 2 + sl], rot: [0, 0, 0] });
  return items;
}
