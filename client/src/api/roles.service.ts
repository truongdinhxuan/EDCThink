import type { ApiEnvelope } from '../types/api';
import type { CreateRoleInput, Role, RoleListParams, UpdateRoleInput } from '../types/roles';
import type { PaginatedResponse } from '../types/pagination.types';
import instance from './http';
import { unwrapData } from './response';
import type { Permission } from '../types/permissions';
import type { AreaTypeSummary } from '../types/area-scopes';

export const listRoles = async (
  params: RoleListParams = {},
  signal?: AbortSignal,
): Promise<PaginatedResponse<Role>> =>
  instance.get<PaginatedResponse<Role>, PaginatedResponse<Role>>('roles', { params, signal });

export const getRole = async (id: string): Promise<Role> =>
  unwrapData(await instance.get<ApiEnvelope<Role>, ApiEnvelope<Role>>(`roles/${id}`));

export const createRole = async (input: CreateRoleInput): Promise<Role> =>
  unwrapData(await instance.post<ApiEnvelope<Role>, ApiEnvelope<Role>>('roles', input));

export const updateRole = async (id: string, input: UpdateRoleInput): Promise<Role> =>
  unwrapData(await instance.patch<ApiEnvelope<Role>, ApiEnvelope<Role>>(`roles/${id}`, input));

export const deleteRole = async (id: string): Promise<Role> =>
  unwrapData(await instance.delete<ApiEnvelope<Role>, ApiEnvelope<Role>>(`roles/${id}`));

export const getRolePermissions = async (id: string): Promise<Permission[]> =>
  unwrapData(await instance.get<ApiEnvelope<Permission[]>, ApiEnvelope<Permission[]>>(
    `roles/${id}/permissions`,
  ));

export const replaceRolePermissions = async (
  id: string,
  permissionIds: string[],
): Promise<Permission[]> => unwrapData(await instance.put<
  ApiEnvelope<Permission[]>, ApiEnvelope<Permission[]>
>(`roles/${id}/permissions`, { permission_ids: permissionIds }));

export const getRoleAreaTypeScopes = async (id: string): Promise<AreaTypeSummary[]> =>
  unwrapData(await instance.get<ApiEnvelope<AreaTypeSummary[]>, ApiEnvelope<AreaTypeSummary[]>>(
    `roles/${id}/area-type-scopes`,
  ));

export const replaceRoleAreaTypeScopes = async (
  id: string,
  areaTypeIds: string[],
): Promise<AreaTypeSummary[]> => unwrapData(await instance.put<
  ApiEnvelope<AreaTypeSummary[]>, ApiEnvelope<AreaTypeSummary[]>
>(`roles/${id}/area-type-scopes`, { areaTypeIds }));
