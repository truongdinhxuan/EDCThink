/**
 * Role codes seeded by the backend. Kept as a reference/autocomplete aid only —
 * never as an authorization source. Access is decided by permissions
 * (`PermissionGuard` / `useAuth().hasPermission`), so a role the database adds
 * later works without a frontend release.
 */
export const ROLE_CODE = {
  ADMIN: 'ADMIN',
  DATA_PACKING: 'DATA_PACKING',
  DATA_MATERIAL: 'DATA_MATERIAL',
  MATERIAL_LEADER: 'MATERIAL_LEADER',
  MATERIAL_CONTROL: 'MATERIAL_CONTROL',
} as const;

/**
 * Any role code the backend defines. Intentionally `string` (not a union of the
 * constants above) so new database roles are recognised dynamically.
 */
export type RoleCode = string;

/** The seeded role codes. Informational — do not branch authorization on this. */
export const ROLE_CODES: RoleCode[] = Object.values(ROLE_CODE);

const extractRoleCode = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return extractRoleCode(value[0]);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.code === 'string') return record.code;
  }
  return null;
};

/**
 * Reads the role code out of whatever shape the API returned (string,
 * `{ code }`, or an array of either). Any non-empty code is accepted.
 */
export const resolveRoleCode = (value: unknown): RoleCode | null => {
  const candidate = extractRoleCode(value)?.trim();
  return candidate ? candidate : null;
};
