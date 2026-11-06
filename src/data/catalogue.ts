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
export const totalItems = (): number => CATEGORIES.reduce((a, c) => a + c.items.length, 0);
