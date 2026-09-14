import type { FastifyReply, FastifyRequest } from 'fastify';
import type {
  AreaListQuery,
  CreateAreaBody,
  UpdateAreaBody,
} from '../../interfaces/master-data';
import { AreasService } from '../../services/areas.service';
import { respondWithData } from '../master-data-response';

export const listAreas = (request: FastifyRequest, reply: FastifyReply) =>
  respondWithData(request, reply, () =>
    new AreasService(request.server).list(request.query as AreaListQuery));

export const getArea = (request: FastifyRequest, reply: FastifyReply) =>
  respondWithData(request, reply, () =>
    new AreasService(request.server).get((request.params as { id: string }).id));

export const createArea = (request: FastifyRequest, reply: FastifyReply) =>
  respondWithData(
    request,
    reply,
    () => new AreasService(request.server).create(request.body as CreateAreaBody),
    201,
  );

export const updateArea = (request: FastifyRequest, reply: FastifyReply) =>
  respondWithData(request, reply, () =>
    new AreasService(request.server).update(
      (request.params as { id: string }).id,
      request.body as UpdateAreaBody,
    ));

export const deleteArea = (request: FastifyRequest, reply: FastifyReply) =>
  respondWithData(request, reply, () =>
    new AreasService(request.server).remove((request.params as { id: string }).id));
