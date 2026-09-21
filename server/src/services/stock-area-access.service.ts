import type { FastifyInstance } from 'fastify';
import {
  canReadStockArea,
  canWriteStockArea,
  resolveReadableStockAreas,
  resolveWritableStockAreaId,
  type ReadableStockAreas,
  type StockAreaAccess,
} from '../domain/stock-access';
import { AreaScopesService } from './area-scopes.service';
import { StockServiceError } from './stock.helpers';

export interface StockActorAccess extends StockAreaAccess {
  id: string;
  roleIds: string[];
}

/**
 * Resolves which Areas one request may read and write stock for.
 *
 * One instance per request: the Area Type scope is two round trips, and the
 * balances endpoint alone would otherwise repeat them for the list, the search
 * and the discrepancy lookup.
 */
export class StockAreaAccessService {
  private readablePromise?: Promise<ReadableStockAreas>;

  constructor(
    private readonly fastify: FastifyInstance,
    private readonly actor: StockActorAccess,
  ) {}

  readableAreaIds(): Promise<ReadableStockAreas> {
    this.readablePromise ??= (async () => {
      const scopes = await new AreaScopesService(this.fastify, {
        id: this.actor.id,
        areaId: this.actor.areaId ?? '',
        roleIds: this.actor.roleIds,
        isSystemAdmin: this.actor.isSystemAdmin,
      }).getEffectiveAreaTypeScopes();
      return resolveReadableStockAreas(
        this.actor,
        scopes.flatMap((scope) => scope.areas.map((area) => area.id)),
      );
    })();
    return this.readablePromise;
  }

  writableAreaId(): string | null {
    return resolveWritableStockAreaId(this.actor);
  }

  async assertCanRead(areaId: string): Promise<void> {
    if (!canReadStockArea(await this.readableAreaIds(), areaId)) {
      throw new StockServiceError(403, 'Khu vực này nằm ngoài phạm vi tồn kho được cấp cho bạn');
    }
  }

  assertCanWrite(areaId: string): void {
    if (!canWriteStockArea(this.actor, areaId)) {
      throw new StockServiceError(
        403,
        'Bạn chỉ được điều chỉnh tồn kho của khu vực mình phụ trách',
      );
    }
  }
}
