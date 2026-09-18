import type { FastifyInstance } from 'fastify';
import { databaseError } from './master-data.helpers';

export interface MilkrunPublicUserSummary {
  id: string;
  vinfast_id: string;
  first_name: string;
  last_name: string;
  email: string;
  avatar_url: string | null;
  is_active: boolean;
  is_deleted: boolean;
}

export interface MilkrunPublicAreaSummary {
  id: string;
  code: string;
  name: string;
}

const uniqueIds = (ids: readonly (string | null | undefined)[]): string[] =>
  [...new Set(ids.filter((id): id is string => Boolean(id)))];

export const loadPublicUsersById = async (
  fastify: FastifyInstance,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, MilkrunPublicUserSummary>> => {
  const requestedIds = uniqueIds(ids);
  if (requestedIds.length === 0) return new Map();

  const { data, error } = await fastify.supabaseAdmin
    .from('users')
    .select(
      'id, vinfast_id, first_name, last_name, email, avatar_url, is_active, is_deleted',
    )
    .in('id', requestedIds);

  if (error) databaseError(error, 'Không thể tải thông tin tài xế');
  return new Map(
    ((data ?? []) as MilkrunPublicUserSummary[]).map((user) => [user.id, user]),
  );
};

export const loadPublicAreasById = async (
  fastify: FastifyInstance,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, MilkrunPublicAreaSummary>> => {
  const requestedIds = uniqueIds(ids);
  if (requestedIds.length === 0) return new Map();

  const { data, error } = await fastify.supabaseAdmin
    .from('areas')
    .select('id, code, name')
    .in('id', requestedIds);

  if (error) databaseError(error, 'Không thể tải thông tin Area');
  return new Map(
    ((data ?? []) as MilkrunPublicAreaSummary[]).map((area) => [area.id, area]),
  );
};
