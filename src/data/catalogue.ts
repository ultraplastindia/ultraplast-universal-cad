import type { Params } from '../core/types.ts';
export interface CatCategory { id: string; name: string; items: string[] }
export const CATEGORIES: CatCategory[] = [
  { id: 'A', name: 'Conveyor Chains', items: ['Plastic conveyor chains', 'Tabletop chains', 'Flat-top chains', 'Multiflex chains', 'Side-flexing chains', 'Straight-running chains', 'Roller chains', 'Double-hinge chains', 'Magnetic chains', 'Stainless steel chains', 'Attachment chains', 'Hollow-pin chains', 'Mat-top chains', 'Accumulation chains', 'Specialty chains'] },
  { id: 'B', name: 'Sprockets and Wheels', items: ['Drive sprockets', 'Driven sprockets', 'Split sprockets', 'Solid sprockets', 'Idler sprockets', 'Return sprockets', 'Plastic sprockets', 'Stainless steel sprockets', 'Modular belt sprockets', 'Machined sprockets', 'Timing pulleys', 'Guide wheels', 'Wear wheels', 'Custom sprockets'] },
  { id: 'C', name: 'Conveyor Belts', items: ['Modular plastic belts', 'Flat-top belts', 'Flush-grid belts', 'Open-grid belts', 'Perforated belts', 'Friction-top belts', 'Roller-top belts', 'Radius belts', 'Side-flexing belts', 'Cleated belts', 'Ribbed belts', 'Specialty belts'] },
  { id: 'D', name: 'Rollers and Shafts', items: ['Drive rollers', 'Idler rollers', 'Return rollers', 'Gravity rollers', 'Powered rollers', 'Tapered rollers', 'Plastic rollers', 'Stainless steel rollers', 'Coated rollers', 'Drive shafts', 'Idler shafts', 'Hexagonal shafts', 'Round shafts', 'Stepped shafts', 'Machined shafts'] },
  { id: 'E', name: 'Bearings and Mechanical Components', items: ['Ball bearings', 'Roller bearings', 'Pillow block bearings', 'Flange bearings', 'Plastic bearings', 'Stainless steel bearings', 'Bushings', 'Sleeves', 'Couplings', 'Keys', 'Retaining rings', 'Fasteners', 'Washers', 'Spacers'] },
  { id: 'F', name: 'Conveyor Frames and Structures', items: ['Side frames', 'Support frames', 'Cross members', 'Conveyor stands', 'Adjustable legs', 'Mounting brackets', 'Guide rails', 'Side guides', 'Guarding systems', 'Structural profiles', 'Aluminium profiles', 'Stainless steel structures'] },
  { id: 'G', name: 'Conveyor Accessories', items: ['Wear strips', 'Guide profiles', 'Return guides', 'Chain guides', 'Belt guides', 'Transfer plates', 'Dead plates', 'Side guards', 'End stops', 'Tensioning units', 'Take-up units', 'Mounting accessories', 'Clamps', 'Connectors', 'Hinges', 'Brackets'] },
  { id: 'H', name: 'Conveyor Assemblies', items: ['Straight conveyor sections', 'Curved conveyor sections', 'Inclined conveyors', 'Declined conveyors', 'Transfer units', 'Drive assemblies', 'Return assemblies', 'Tensioning assemblies', 'Modular conveyor assemblies', 'Custom conveyor configurations'] },
  { id: 'I', name: 'Drive and Transmission Components', items: ['Motors', 'Gearboxes', 'Drive pulleys', 'Tail pulleys', 'Couplings (transmission)', 'Drive shafts (transmission)', 'Sprocket drives', 'Chain drives', 'Belt drives', 'Tensioners', 'Power transmission elements'] },
  { id: 'J', name: 'Additional manufacturing components (identified)', items: ['Chain connecting links and pins', 'Set screws and grub screws', 'Shaft collars and lock collars', 'Cotter pins and circlip pins', 'Lubrication fittings', 'Sensor and proximity-switch mounts'] },
];

/** catalogue item -> implemented family id. Everything not listed is PENDING. */
export const IMPLEMENTED: Record<string, string> = {
  'B:Drive sprockets': 'sprocket', 'B:Driven sprockets': 'sprocket', 'B:Idler sprockets': 'sprocket', 'B:Solid sprockets': 'sprocket', 'B:Machined sprockets': 'sprocket',
  'D:Drive shafts': 'shaft', 'D:Idler shafts': 'shaft', 'D:Round shafts': 'shaft', 'D:Stepped shafts': 'shaft', 'D:Machined shafts': 'shaft', 'D:Hexagonal shafts': 'hexshaft',
  'D:Drive rollers': 'roller', 'D:Idler rollers': 'roller', 'D:Return rollers': 'roller', 'D:Gravity rollers': 'roller', 'D:Plastic rollers': 'roller', 'D:Stainless steel rollers': 'roller',
  'E:Ball bearings': 'bearing', 'E:Bushings': 'bushing', 'E:Sleeves': 'bushing', 'E:Spacers': 'bushing', 'E:Keys': 'key', 'E:Washers': 'washer', 'E:Fasteners': 'hexnut', 
  'F:Guide rails': 'angle', 'F:Side guides': 'angle', 'F:Cross members': 'rhs', 'F:Support frames': 'rhs', 'F:Structural profiles': 'rhs', 'F:Aluminium profiles': 'rhs', 'F:Stainless steel structures': 'rhs',
  'B:Guide wheels': 'guidewheel', 'B:Wear wheels': 'guidewheel', 'I:Drive pulleys': 'pulley', 'I:Tail pulleys': 'pulley',
  'F:Side frames': 'channel', 'F:Adjustable legs': 'leg', 'F:Conveyor stands': 'leg', 'F:Mounting brackets': 'plate',
  'G:Transfer plates': 'plate', 'G:Dead plates': 'plate', 'G:Mounting accessories': 'plate',
  'H:Straight conveyor sections': 'assembly', 'H:Drive assemblies': 'assembly',
  'G:Wear strips': 'wearstrip', 'G:Guide profiles': 'wearstrip', 'G:Chain guides': 'wearstrip', 'G:Return guides': 'wearstrip',
};
/** Items covered only partially by their family (shown as "partial" in the coverage register). */
export const PARTIAL: Record<string, string> = {
  'H:Straight conveyor sections': 'roller conveyor preset in the Assembly designer (frames + rollers)', 'H:Drive assemblies': 'example drive-shaft assembly (shaft, bearings, sprocket) in the Assembly designer',
  'F:Side frames': 'U-channel member only, no welded frame', 'F:Conveyor stands': 'single adjustable leg, no complete stand', 'F:Mounting brackets': 'flat plate only, no bent brackets', 'B:Wear wheels': 'plain wheel, no bearing seat', 'B:Guide wheels': 'plain flanged wheel, no bearing seat',
  'I:Drive pulleys': 'solid belt pulley only', 'I:Tail pulleys': 'solid belt pulley only', 'G:Transfer plates': 'flat plate only', 'G:Dead plates': 'flat plate only', 'G:Mounting accessories': 'flat plate only',
  'E:Fasteners': 'hex nut, hex bolt, cap screw, washer (no set screws, studs)', 'F:Support frames': 'single tube members only, no welded frames', 'F:Stainless steel structures': 'tube members in SS 304 only',
  'F:Aluminium profiles': 'plain rectangular tube, not T-slot extrusions', 'G:Chain guides': 'flat strip only, no channel/profile guides', 'G:Return guides': 'flat strip only', 'G:Guide profiles': 'flat strip only',
  'D:Drive rollers': 'tube roller, no lagging or drive features', 'D:Return rollers': 'tube roller only', 'D:Gravity rollers': 'tube roller only', 'D:Plastic rollers': 'plastic tube material only', 'D:Stainless steel rollers': 'SS 304 tube material only',
  'B:Solid sprockets': 'plate/hub sprocket for roller chain', 'B:Machined sprockets': 'plate/hub sprocket for roller chain',
};

/** v1.0: items that moved from "pending" to a dedicated or partly dedicated model (see PARTIAL for what is still missing). */
const CHAIN_BELT: Record<string, string> = {
  'A:Plastic conveyor chains': 'modbelt', 'A:Tabletop chains': 'modbelt', 'A:Flat-top chains': 'modbelt', 'A:Multiflex chains': 'modbelt', 'A:Side-flexing chains': 'modbelt', 'A:Straight-running chains': 'modbelt', 'A:Double-hinge chains': 'modbelt',
  'A:Magnetic chains': 'modbelt', 'A:Stainless steel chains': 'modbelt', 'A:Mat-top chains': 'modbelt', 'A:Accumulation chains': 'modbelt', 'A:Specialty chains': 'modbelt',
  'A:Roller chains': 'chainlink', 'A:Attachment chains': 'chainlink', 'A:Hollow-pin chains': 'chainlink',
  'C:Modular plastic belts': 'modbelt', 'C:Flat-top belts': 'modbelt', 'C:Flush-grid belts': 'modbelt', 'C:Open-grid belts': 'modbelt', 'C:Perforated belts': 'modbelt', 'C:Friction-top belts': 'modbelt', 'C:Roller-top belts': 'modbelt',
  'C:Radius belts': 'modbelt', 'C:Side-flexing belts': 'modbelt', 'C:Cleated belts': 'modbelt', 'C:Ribbed belts': 'modbelt', 'C:Specialty belts': 'modbelt',
};
const MORE: Record<string, string> = {
  'B:Split sprockets': 'sprocket_types', 'B:Return sprockets': 'sprocket_types', 'B:Plastic sprockets': 'sprocket_types', 'B:Stainless steel sprockets': 'sprocket_types', 'B:Modular belt sprockets': 'sprocket_types', 'B:Timing pulleys': 'pulley', 'B:Custom sprockets': 'sprocket_types',
  'D:Powered rollers': 'roller', 'D:Tapered rollers': 'taperroll', 'H:Curved conveyor sections': 'curved', 'D:Coated rollers': 'roller',
  'E:Roller bearings': 'bearing', 'E:Pillow block bearings': 'brghousing', 'E:Flange bearings': 'brghousing', 'E:Plastic bearings': 'brghousing', 'E:Stainless steel bearings': 'brghousing', 'E:Couplings': 'coupling', 'E:Retaining rings': 'circlip',
  'F:Guarding systems': 'plate',
  'G:Belt guides': 'lbracket', 'G:Side guards': 'lbracket', 'G:End stops': 'lbracket', 'G:Tensioning units': 'takeup', 'G:Take-up units': 'takeup', 'G:Clamps': 'lbracket', 'G:Connectors': 'lbracket', 'G:Hinges': 'lbracket', 'G:Brackets': 'lbracket',
  'H:Inclined conveyors': 'assembly', 'H:Declined conveyors': 'assembly', 'H:Transfer units': 'assembly', 'H:Return assemblies': 'assembly', 'H:Tensioning assemblies': 'assembly', 'H:Modular conveyor assemblies': 'assembly', 'H:Custom conveyor configurations': 'assembly',
  'I:Motors': 'motor', 'I:Gearboxes': 'motor', 'I:Couplings (transmission)': 'coupling', 'I:Drive shafts (transmission)': 'shaft', 'I:Sprocket drives': 'assembly', 'I:Chain drives': 'assembly', 'I:Belt drives': 'pulley', 'I:Tensioners': 'takeup', 'I:Power transmission elements': 'coupling',
  'J:Chain connecting links and pins': 'dowel', 'J:Set screws and grub screws': 'setscrew', 'J:Shaft collars and lock collars': 'collar', 'J:Cotter pins and circlip pins': 'dowel', 'J:Lubrication fittings': 'greasenipple', 'J:Sensor and proximity-switch mounts': 'lbracket',
};
Object.assign(IMPLEMENTED, CHAIN_BELT, MORE);
const NOTE_GENERIC = 'generic standard-style shape, not Ultraplast proprietary geometry';
Object.assign(PARTIAL, {
  'A:Plastic conveyor chains': NOTE_GENERIC + '; no knuckle or tooth detail', 'A:Tabletop chains': NOTE_GENERIC + '; use a narrow width and flat style', 'A:Flat-top chains': NOTE_GENERIC, 'A:Multiflex chains': NOTE_GENERIC + '; no flex gap or tab detail',
  'A:Side-flexing chains': NOTE_GENERIC + '; straight module only, no side-flex clearance', 'A:Straight-running chains': NOTE_GENERIC, 'A:Double-hinge chains': NOTE_GENERIC + '; single hinge line only', 'A:Magnetic chains': NOTE_GENERIC + '; magnets not modelled',
  'A:Stainless steel chains': NOTE_GENERIC + '; SS 304 flat module', 'A:Mat-top chains': NOTE_GENERIC, 'A:Accumulation chains': NOTE_GENERIC + '; no roller or low-friction insert', 'A:Specialty chains': NOTE_GENERIC,
  'A:Roller chains': 'standard roller chain; pin, plate height and plate thickness are estimates', 'A:Attachment chains': 'flat K1-style lugs only, no bent or extended-pin attachments', 'A:Hollow-pin chains': 'plain hollow pin; no cross-rod',
  'C:Modular plastic belts': NOTE_GENERIC, 'C:Flat-top belts': NOTE_GENERIC, 'C:Flush-grid belts': NOTE_GENERIC + '; slots only', 'C:Open-grid belts': NOTE_GENERIC + '; slots only', 'C:Perforated belts': NOTE_GENERIC + '; round holes', 'C:Friction-top belts': NOTE_GENERIC + '; rubber layer as one sheet',
  'C:Roller-top belts': NOTE_GENERIC + '; balls instead of rollers', 'C:Radius belts': NOTE_GENERIC + '; straight module only', 'C:Side-flexing belts': NOTE_GENERIC + '; straight module only', 'C:Cleated belts': NOTE_GENERIC + '; plain flights', 'C:Ribbed belts': NOTE_GENERIC + '; plain rails', 'C:Specialty belts': NOTE_GENERIC,
  'B:Split sprockets': 'two halves shown as one piece with a split line', 'B:Return sprockets': 'roller-chain tooth form; single strand preset', 'B:Plastic sprockets': 'roller-chain tooth form in Nylon, no modular belt tooth form', 'B:Stainless steel sprockets': 'roller-chain tooth form in SS 304', 'B:Modular belt sprockets': 'roller-chain tooth form, NOT the modular belt tooth form', 'B:Timing pulleys': 'plain pulley body, no teeth', 'B:Custom sprockets': 'any roller-chain sprocket from values',
  'D:Powered rollers': 'tube roller only, motor not modelled', 'D:Coated rollers': 'tube roller only, coating not modelled', 'D:Tapered rollers': 'taper built from stacked short cylinders (stepped), no bearing seat', 'H:Curved conveyor sections': 'bed plate and side guards only; no rollers, chain track or supports',
  'E:Roller bearings': 'ring-type bearing, rolling elements illustrative', 'E:Pillow block bearings': 'housing only, no bearing insert; pillow base holes not in 3D', 'E:Flange bearings': 'housing only, no bearing insert', 'E:Plastic bearings': 'housing only (choose a plastic material), no insert', 'E:Stainless steel bearings': 'housing only (choose SS 304), no insert',
  'E:Couplings': 'no keyways or screws', 'E:Retaining rings': 'plain C-ring, no plier eyes', 'F:Guarding systems': 'flat panel only, no framed guard',
  'G:Belt guides': 'bent angle only', 'G:Side guards': 'bent angle only', 'G:End stops': 'bent angle only', 'G:Tensioning units': 'screw take-up only', 'G:Take-up units': 'screw take-up only, square-bar screw', 'G:Clamps': 'bent angle only', 'G:Connectors': 'bent angle only', 'G:Hinges': 'single bent leaf, no knuckle or pin', 'G:Brackets': 'bent angle, holes in the base leg only',
  'H:Inclined conveyors': 'built by placing and rotating parts in the Assembly designer; no automatic incline layout', 'H:Declined conveyors': 'built by placing and rotating parts in the Assembly designer; no automatic layout', 'H:Transfer units': 'built from parts by hand in the Assembly designer', 'H:Return assemblies': 'built from parts by hand in the Assembly designer', 'H:Tensioning assemblies': 'built from parts by hand in the Assembly designer (take-up unit, shaft, bearings)', 'H:Modular conveyor assemblies': 'built from parts by hand in the Assembly designer', 'H:Custom conveyor configurations': 'built from parts by hand in the Assembly designer',
  'I:Motors': 'outline only, no mass or ratings', 'I:Gearboxes': 'outline only, no ratio, mass or ratings', 'I:Couplings (transmission)': 'no keyways or screws', 'I:Drive shafts (transmission)': 'plain stepped shaft', 'I:Sprocket drives': 'built by hand in the Assembly designer (shaft, bearings, sprocket)', 'I:Chain drives': 'built by hand in the Assembly designer; no automatic chain path', 'I:Belt drives': 'one pulley only', 'I:Tensioners': 'screw take-up only', 'I:Power transmission elements': 'coupling only',
  'J:Chain connecting links and pins': 'plain dowel pin, no clip or cotter', 'J:Set screws and grub screws': 'thread not modelled', 'J:Shaft collars and lock collars': 'no screw holes', 'J:Cotter pins and circlip pins': 'plain pin only, no split or clip', 'J:Lubrication fittings': 'outline only, check sizes with the data sheet', 'J:Sensor and proximity-switch mounts': 'bent angle only, no clamp bore',
});
/** Starting values for catalogue items that share a family (a different style, material or size than the family default). */
export const PRESETS: Record<string, Params> = {
  'A:Tabletop chains': { style: 'flat', width: 82.6, pitch: 38.1, thickness: 10.4, pinDia: 6.4, modules: 10 }, 'A:Flat-top chains': { style: 'flat', width: 82.6, pitch: 38.1, thickness: 10.4, pinDia: 6.4, modules: 10 }, 'A:Plastic conveyor chains': { style: 'flat', width: 82.6, pitch: 38.1, thickness: 10.4, pinDia: 6.4, modules: 10 },
  'A:Stainless steel chains': { style: 'flat', width: 100, pitch: 38.1, thickness: 6, pinDia: 5, modules: 8, material: 'SS 304', density: 8 }, 'A:Mat-top chains': { style: 'flat', width: 150, pitch: 25.4, modules: 10 }, 'A:Accumulation chains': { style: 'friction', topH: 2, width: 82.5, pitch: 38.1, thickness: 8, pinDia: 6, modules: 10, material: 'Nylon PA6', density: 1.14 },
  'A:Attachment chains': { attach: 'k1', links: 16 }, 'A:Hollow-pin chains': { hollow: 'hollow', chain: '16B-1', links: 10 },
  'C:Flush-grid belts': { style: 'grid', openW: 6, openPitch: 12, thickness: 10 }, 'C:Open-grid belts': { style: 'grid', openW: 8, openPitch: 14, thickness: 10 }, 'C:Perforated belts': { style: 'perforated', openW: 6, openPitch: 12 }, 'C:Friction-top belts': { style: 'friction', topH: 3, material: 'Nylon PA6', density: 1.14 },
  'C:Roller-top belts': { style: 'rollertop', openW: 12, openPitch: 25, thickness: 10 }, 'C:Cleated belts': { style: 'cleated', topH: 25, every: 4 }, 'C:Ribbed belts': { style: 'ribbed', topH: 6, openW: 4, openPitch: 25 },
  'B:Plastic sprockets': { material: 'Nylon PA6', density: 1.14 }, 'B:Stainless steel sprockets': { material: 'SS 304', density: 8 },
  'E:Pillow block bearings': { type: 'pillow', size: 127, flangeThk: 12, height: 36, hubDia: 46, length: 38 }, 'E:Plastic bearings': { material: 'Nylon PA6', density: 1.14 }, 'E:Stainless steel bearings': { material: 'SS 304', density: 8 },
  'E:Couplings': { type: 'jaw', bore2: 25, od: 55, hubOd: 50, length: 70 }, 'I:Couplings (transmission)': { type: 'jaw', bore2: 25, od: 55, hubOd: 50, length: 70 }, 'I:Power transmission elements': { type: 'flange', bore1: 25, bore2: 25, od: 100, hubOd: 55, length: 80, boltDia: 9 },
  'G:End stops': { leg1: 80, leg2: 70, width: 100, thk: 8, holes: 2, holeDia: 11, edge: 20 }, 'G:Side guards': { leg1: 40, leg2: 120, width: 500, thk: 3, holes: 2, holeDia: 8, edge: 12, material: 'SS 304', density: 8 }, 'G:Belt guides': { leg1: 30, leg2: 40, width: 1000, thk: 4, holes: 0, material: 'UHMW-PE', density: 0.93 },
  'G:Clamps': { leg1: 50, leg2: 40, width: 30, thk: 5, holes: 1, holeDia: 9, edge: 18 }, 'J:Sensor and proximity-switch mounts': { leg1: 40, leg2: 50, width: 25, thk: 3, holes: 2, holeDia: 6.5, edge: 8 }, 'G:Connectors': { leg1: 45, leg2: 45, width: 40, thk: 4, holes: 2, holeDia: 9, edge: 12 }, 'G:Hinges': { leg1: 50, leg2: 50, width: 60, thk: 3, holes: 2, holeDia: 6.5, edge: 10 },
  'I:Gearboxes': { type: 'gearbox', bodyD: 100, bodyLen: 120, flangeA: 120, pcd: 100, shaftD: 25, shaftLen: 55 },
};
export const totalItems = (): number => CATEGORIES.reduce((a, c) => a + c.items.length, 0);
