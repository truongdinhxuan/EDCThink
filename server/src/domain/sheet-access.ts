import { PERMISSION_CODE, type PermissionCode } from './permission-codes';

export interface SheetAreaAccess {
  areaId: string;
  permissions: readonly PermissionCode[];
  isSystemAdmin: boolean;
}

const includesPermission = (
  access: SheetAreaAccess,
  permission: PermissionCode,
): boolean => access.isSystemAdmin || access.permissions.includes(permission);

/**
 * Whether the actor is pinned to their own Area.
 *
 * Deny by default: approval authority is the only thing that widens the view
 * past the actor's own Area. Listing the permissions that DO get pinned would
 * mean every permission added to the catalog later silently defaults to
 * unrestricted cross-Area visibility, which is exactly the trap a
 * pick-your-permissions role model invites.
 */
export const isSheetAreaScoped = (access: SheetAreaAccess): boolean =>
  !access.isSystemAdmin
  && !includesPermission(access, PERMISSION_CODE.SUPPLY_ORDER_APPROVE);

/**
 * Narrows the Area Type scope down to what the actor may actually read.
 *
 * The role's Area Type scope stays the ceiling; pinning intersects with it
 * rather than replacing it, so an actor whose own Area sits outside their
 * role's scope still reads nothing.
 */
export const resolveReadableAreaIds = (
  access: SheetAreaAccess,
  scopedAreaIds: readonly string[],
): string[] => (isSheetAreaScoped(access)
  ? scopedAreaIds.filter((areaId) => areaId === access.areaId)
  : [...scopedAreaIds]);

/**
 * Areas the actor may review Orders FOR, excluding their own supplying Area.
 * Used by the approver's "Phiếu order từ các thị trường" section.
 */
export const resolveIncomingAreaIds = (
  access: SheetAreaAccess,
  scopedAreaIds: readonly string[],
): string[] => resolveReadableAreaIds(access, scopedAreaIds)
  .filter((areaId) => areaId !== access.areaId);

export const canReadSheetArea = (
  access: SheetAreaAccess,
  scopedAreaIds: readonly string[],
  areaId: string,
): boolean => resolveReadableAreaIds(access, scopedAreaIds).includes(areaId);
