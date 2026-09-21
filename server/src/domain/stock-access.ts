import { PERMISSION_CODE, type PermissionCode } from './permission-codes';

export interface StockAreaAccess {
  /** The Area this user works in. Empty when nobody has assigned one. */
  areaId: string | null;
  permissions: readonly PermissionCode[];
  isSystemAdmin: boolean;
}

/**
 * Every Area the actor may read stock for, or `ALL`.
 *
 * `ALL` is a value rather than an empty array on purpose. An empty array means
 * "no Area at all", and if the same value also meant "every Area" then one
 * missing branch would turn a lockout into a full disclosure. Callers are made
 * to handle both cases because TypeScript will not let them ignore the union.
 */
export type ReadableStockAreas = readonly string[] | 'ALL';

const includesPermission = (
  access: StockAreaAccess,
  permission: PermissionCode,
): boolean => access.isSystemAdmin || access.permissions.includes(permission);

export const readsEveryStockArea = (access: StockAreaAccess): boolean =>
  access.isSystemAdmin
  || includesPermission(access, PERMISSION_CODE.SUPPLY_STOCK_READ_ALL_AREAS);

/**
 * Role Area Type scope decides how wide the actor sees; their own Area is always
 * included on top of it.
 *
 * The union matters for the supply warehouse: VTDG deliberately belongs to no
 * Area Type, so without it the people who run that warehouse could not read the
 * stock they are responsible for.
 */
export const resolveReadableStockAreas = (
  access: StockAreaAccess,
  scopedAreaIds: readonly string[],
): ReadableStockAreas => {
  if (readsEveryStockArea(access)) return 'ALL';
  const readable = new Set(scopedAreaIds);
  if (access.areaId) readable.add(access.areaId);
  return [...readable];
};

export const canReadStockArea = (
  readable: ReadableStockAreas,
  areaId: string,
): boolean => readable === 'ALL' || readable.includes(areaId);

/**
 * Writing is pinned to the actor's own Area, and nothing widens it but being a
 * system admin.
 *
 * Deliberately not derived from the Area Type scope: that scope exists so a
 * supervisor can *see* the packing Areas, and reusing it here would silently
 * hand every one of them the right to move that stock as well.
 */
export const canWriteStockArea = (
  access: StockAreaAccess,
  areaId: string,
): boolean => access.isSystemAdmin
  || (Boolean(access.areaId) && access.areaId === areaId);

/** The single Area a non-admin may adjust, or null when they have none. */
export const resolveWritableStockAreaId = (
  access: StockAreaAccess,
): string | null => (access.isSystemAdmin ? null : access.areaId);
