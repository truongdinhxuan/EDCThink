import type { FastifyInstance } from 'fastify';
import type {} from '../plugins/dbContext';
import type {
  AreaScopeActor,
  EffectiveAreaTypeScope,
  ScopedArea,
} from '../interfaces/area-scopes';

export interface AreaTypeAccessRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
  is_deleted: boolean;
}

export interface RoleScopeAccessRow {
  role_id: string;
  role: {
    id: string;
    is_active: boolean;
    is_deleted: boolean;
  } | Array<{
    id: string;
    is_active: boolean;
    is_deleted: boolean;
  }> | null;
  area_type: AreaTypeAccessRow | AreaTypeAccessRow[] | null;
}

export interface ScopedAreaAccessRow extends ScopedArea {
  area_type_id: string | null;
  is_active: boolean;
  is_deleted: boolean;
}

export class AreaScopeServiceError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'AreaScopeServiceError';
  }
}

const firstRelation = <T>(value: T | T[] | null): T | null =>
  Array.isArray(value) ? (value[0] ?? null) : value;

const activeAreaType = (areaType: AreaTypeAccessRow | null): areaType is AreaTypeAccessRow =>
  areaType !== null && areaType.is_active && !areaType.is_deleted;

export const resolveEffectiveAreaTypes = (
  actor: Pick<AreaScopeActor, 'roleIds' | 'isSystemAdmin'>,
  roleScopes: RoleScopeAccessRow[],
  systemAdminAreaTypes: AreaTypeAccessRow[] = [],
): AreaTypeAccessRow[] => {
  const roleIds = new Set(actor.roleIds);
  const candidates = actor.isSystemAdmin
    ? systemAdminAreaTypes
    : roleScopes
      .filter((scope) => roleIds.has(scope.role_id))
      .filter((scope) => {
        const role = firstRelation(scope.role);
        return role !== null && role.is_active && !role.is_deleted;
      })
      .map((scope) => firstRelation(scope.area_type))
      .filter(activeAreaType);

  return [...new Map(
    candidates
      .filter(activeAreaType)
      .map((areaType) => [areaType.id, areaType]),
  ).values()].sort((left, right) =>
    left.code.localeCompare(right.code) || left.id.localeCompare(right.id));
};

export const groupEffectiveAreaTypeScopes = (
  areaTypes: AreaTypeAccessRow[],
  areas: ScopedAreaAccessRow[],
): EffectiveAreaTypeScope[] => {
  const activeAreas = areas
    .filter((area) => area.is_active && !area.is_deleted && area.area_type_id !== null)
    .sort((left, right) => left.code.localeCompare(right.code) || left.id.localeCompare(right.id));

  return areaTypes.map((areaType) => ({
    id: areaType.id,
    code: areaType.code,
    name: areaType.name,
    description: areaType.description,
    areas: activeAreas
      .filter((area) => area.area_type_id === areaType.id)
      .map(({ id, code, name }) => ({ id, code, name })),
  }));
};

export const isAreaWithinEffectiveScope = (
  scopes: EffectiveAreaTypeScope[],
  areaId: string,
): boolean => scopes.some((scope) => scope.areas.some((area) => area.id === areaId));

export class AreaScopesService {
  private areaTypesPromise?: Promise<AreaTypeAccessRow[]>;
  private scopesPromise?: Promise<EffectiveAreaTypeScope[]>;

  constructor(
    private readonly fastify: FastifyInstance,
    private readonly actor: AreaScopeActor,
  ) {}

  private get db() {
    return this.fastify.supabaseAdmin;
  }

  private async loadEffectiveAreaTypes(): Promise<AreaTypeAccessRow[]> {
    if (this.actor.isSystemAdmin) {
      const { data, error } = await this.db
        .from('area_types')
        .select('id, code, name, description, is_active, is_deleted')
        .eq('is_active', true)
        .eq('is_deleted', false)
        .order('code', { ascending: true })
        .order('id', { ascending: true });
      if (error) throw new AreaScopeServiceError(500, 'Không thể tải Area Type Scope');
      return resolveEffectiveAreaTypes(
        this.actor,
        [],
        (data ?? []) as AreaTypeAccessRow[],
      );
    }

    if (this.actor.roleIds.length === 0) return [];
    const { data, error } = await this.db
      .from('role_area_type_scopes')
      .select(`
        role_id,
        role:roles!role_area_type_scopes_role_id_fkey!inner(
          id, is_active, is_deleted
        ),
        area_type:area_types!role_area_type_scopes_area_type_id_fkey!inner(
          id, code, name, description, is_active, is_deleted
        )
      `)
      .in('role_id', this.actor.roleIds)
      .eq('role.is_active', true)
      .eq('role.is_deleted', false)
      .eq('area_type.is_active', true)
      .eq('area_type.is_deleted', false);
    if (error) throw new AreaScopeServiceError(500, 'Không thể tải Area Type Scope');

    return resolveEffectiveAreaTypes(
      this.actor,
      (data ?? []) as unknown as RoleScopeAccessRow[],
    );
  }

  getEffectiveAreaTypes(): Promise<AreaTypeAccessRow[]> {
    this.areaTypesPromise ??= this.loadEffectiveAreaTypes();
    return this.areaTypesPromise;
  }

  async getEffectiveAreaTypeScopes(): Promise<EffectiveAreaTypeScope[]> {
    if (!this.scopesPromise) {
      this.scopesPromise = (async () => {
        const areaTypes = await this.getEffectiveAreaTypes();
        if (areaTypes.length === 0) return [];

        const { data, error } = await this.db
          .from('areas')
          .select('id, code, name, area_type_id, is_active, is_deleted')
          .in('area_type_id', areaTypes.map((areaType) => areaType.id))
          .eq('is_active', true)
          .eq('is_deleted', false)
          .order('code', { ascending: true })
          .order('id', { ascending: true });
        if (error) throw new AreaScopeServiceError(500, 'Không thể tải Area trong phạm vi');

        return groupEffectiveAreaTypeScopes(
          areaTypes,
          (data ?? []) as ScopedAreaAccessRow[],
        );
      })();
    }
    return this.scopesPromise;
  }

  async assertAreaWithinEffectiveScope(areaId: string): Promise<void> {
    const scopes = await this.getEffectiveAreaTypeScopes();
    if (!isAreaWithinEffectiveScope(scopes, areaId)) {
      throw new AreaScopeServiceError(
        403,
        'Area nằm ngoài Area Type Scope được cấp cho bạn',
      );
    }
  }
}
