import { PERMISSION_CODE, type PermissionCode } from './permission-codes';

export interface OrderReadAccess {
  areaId: string;
  permissions: readonly PermissionCode[];
  isSystemAdmin: boolean;
}

export interface OrderReadResource {
  to_area_id: string;
}

export const ORDER_READ_PERMISSIONS = [
  PERMISSION_CODE.SUPPLY_ORDER_CREATE,
  PERMISSION_CODE.SUPPLY_ORDER_APPROVE,
  PERMISSION_CODE.SUPPLY_ORDER_ALLOCATE,
  PERMISSION_CODE.SUPPLY_ORDER_CONFIRM_ALLOCATION,
  PERMISSION_CODE.SUPPLY_ORDER_ISSUE,
] as const;

const includesPermission = (
  access: OrderReadAccess,
  permission: PermissionCode,
): boolean => access.isSystemAdmin || access.permissions.includes(permission);

export const hasOrderReadPermission = (access: OrderReadAccess): boolean =>
  access.isSystemAdmin
  || ORDER_READ_PERMISSIONS.some((permission) => includesPermission(access, permission));

/**
 * Whether the actor only sees Orders addressed to their own Area.
 *
 * Deny by default. This used to also require SUPPLY_ORDER_CREATE, which meant a
 * role holding only `supply.order.issue` or `supply.order.allocate` passed
 * hasOrderReadPermission but matched no pinning rule, and so read every Area's
 * Orders. Approval authority is now the single condition that widens the view.
 */
export const isOrderAreaScoped = (access: OrderReadAccess): boolean =>
  !access.isSystemAdmin
  && !includesPermission(access, PERMISSION_CODE.SUPPLY_ORDER_APPROVE);

export const canReadOrder = (
  access: OrderReadAccess,
  order: OrderReadResource,
): boolean => hasOrderReadPermission(access)
  && (!isOrderAreaScoped(access) || order.to_area_id === access.areaId);
