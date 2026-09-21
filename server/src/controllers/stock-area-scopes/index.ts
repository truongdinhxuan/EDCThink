import type { FastifyReply, FastifyRequest } from 'fastify';
import { StockAreaAccessService } from '../../services/stock-area-access.service';
import { stockActor } from '../stock-actor';
import { respondWithStockData } from '../stock-response';

interface AreaRow {
  id: string;
  code: string;
  name: string;
}

/**
 * What the stock screens may show this user: which Areas to offer in the filters
 * and which single Area the adjustment form may write to.
 *
 * Kept apart from /me/area-scopes because that endpoint answers a different
 * question — the Area Type groups used by Shift Order Sheets — and merging the
 * two would let a change made for one feature quietly reshape the other.
 */
export const getMyStockAreaScopes = (
  request: FastifyRequest,
  reply: FastifyReply,
) => respondWithStockData(request, reply, async () => {
  const actor = stockActor(request);
  const access = new StockAreaAccessService(request.server, actor);
  const readable = await access.readableAreaIds();
  const writableAreaId = access.writableAreaId();

  let query = request.server.supabaseAdmin
    .from('areas')
    .select('id, code, name')
    .eq('is_active', true)
    .eq('is_deleted', false)
    .order('code', { ascending: true });
  // 'ALL' is resolved to the real list here so the client never has to carry a
  // sentinel into its rendering code.
  if (readable !== 'ALL') {
    if (readable.length === 0) {
      return { areas: [], writableAreaId: null, readsAllAreas: false };
    }
    query = query.in('id', readable);
  }

  const { data } = await query;
  const areas = (data ?? []) as AreaRow[];
  return {
    areas,
    // Admins write anywhere, so there is no single Area to pin the form to.
    writableAreaId: actor.isSystemAdmin ? null : writableAreaId,
    readsAllAreas: readable === 'ALL',
  };
});
