/** Who may do what.
 *  admin     everything, including Settings and user management
 *  engineer  design, save, upload pictures, use AI helpers
 *  employee  design, save and upload pictures; no AI helpers (they cost money)
 *  viewer    look only: open the library and the designer, but cannot save, upload or use AI */
export const ROLES = ['admin', 'engineer', 'employee', 'viewer'] as const;
export type Role = (typeof ROLES)[number];
export const asRole = (v: unknown, isAdmin: boolean): Role => (isAdmin ? 'admin' : (ROLES as readonly string[]).includes(String(v)) && v !== 'admin' ? (v as Role) : 'engineer');
export const canWrite = (r: Role): boolean => r !== 'viewer';
export const canAi = (r: Role): boolean => r === 'admin' || r === 'engineer';
