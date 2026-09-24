import type { FastifyInstance } from 'fastify';
import {
  assertPositiveStockQuantity,
  assertStockAdjustmentType,
  StockRuleError,
} from '../domain/stockRules';
import type {
  CreateStockAdjustmentBody,
  StockActor,
} from '../interfaces/stock';
import { StockServiceError, stockRpcError } from './stock.helpers';
import { StockAreaAccessService } from './stock-area-access.service';

export class StockAdjustmentsService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get db() {
    return this.fastify.supabaseAdmin;
  }

  async create(actor: StockActor, body: CreateStockAdjustmentBody) {
    // Before any other validation: an Area the actor may not touch is a refusal,
    // not a bad request, and the reply must not reveal whether the rest was valid.
    new StockAreaAccessService(this.fastify, actor).assertCanWrite(body.area_id);

    let quantity: number | null = null;
    if (body.quantity !== undefined) {
      try {
        quantity = assertPositiveStockQuantity(body.quantity);
      } catch (error) {
        if (error instanceof StockRuleError) {
          throw new StockServiceError(400, error.message);
        }
        throw error;
      }
    }
    if (body.stack_quantity !== undefined
      && (!Number.isFinite(body.stack_quantity) || body.stack_quantity <= 0)) {
      throw new StockServiceError(400, 'Invalid stack_quantity');
    }
    if (body.set_per_qty !== undefined
      && (!Number.isFinite(body.set_per_qty) || body.set_per_qty <= 0)) {
      throw new StockServiceError(400, 'Invalid set_per_qty');
    }

    let typeRequest = this.db
      .from('stock_transaction_types')
      .select('id, code, effect, requires_reason')
      .eq('is_active', true)
      .eq('is_deleted', false);
    if (body.transaction_type_id) {
      typeRequest = typeRequest.eq('id', body.transaction_type_id);
    } else {
      let code: string;
      try {
        code = assertStockAdjustmentType(
          body.transaction_type_code ?? body.type,
        );
      } catch (error) {
        if (error instanceof StockRuleError) {
          throw new StockServiceError(400, error.message);
        }
        throw error;
      }
      typeRequest = typeRequest.eq('code', code);
    }
    const { data: transactionType, error: typeError } =
      await typeRequest.single();
    if (typeError || !transactionType) {
      throw new StockServiceError(
        400,
        'transaction type does not exist or is inactive',
      );
    }
    try {
      assertStockAdjustmentType(transactionType.code);
    } catch {
      throw new StockServiceError(
        400,
        'transaction type is not valid for a stock adjustment',
      );
    }

    const reasonNote = (body.reason_note ?? body.reason)?.trim() || null;
    if (reasonNote && reasonNote.length > 2000) {
      throw new StockServiceError(400, 'reason_note must not exceed 2000 characters');
    }
    if (!body.adjustment_reason_id && !reasonNote) {
      throw new StockServiceError(
        400,
        'adjustment_reason_id or reason_note is required',
      );
    }
    if (body.adjustment_reason_id) {
      const { data: adjustmentReason, error: reasonError } = await this.db
        .from('adjustment_reasons')
        .select('id, requires_note')
        .eq('id', body.adjustment_reason_id)
        .eq('is_active', true)
        .eq('is_deleted', false)
        .single();
      if (reasonError || !adjustmentReason) {
        throw new StockServiceError(
          400,
          'adjustment_reason_id does not exist or is inactive',
        );
      }
      if (adjustmentReason.requires_note && !reasonNote) {
        throw new StockServiceError(400, 'reason_note is required for this reason');
      }
    }

    const note = typeof body.note === 'string' ? body.note.trim() || null : null;
    const { data, error } = await this.db.rpc('apply_stock_adjustment_v5', {
      p_supply_id: body.supply_id,
      p_provider_id: body.provider_id,
      p_area_id: body.area_id,
      p_location_ids: body.location_ids?.length ? body.location_ids : null,
      p_transaction_type_id: transactionType.id,
      p_quantity: quantity,
      p_stack_quantity: body.stack_quantity ?? null,
      p_set_per_qty: body.set_per_qty ?? null,
      p_adjustment_reason_id: body.adjustment_reason_id ?? null,
      p_reason_note: reasonNote,
      p_note: note,
      p_created_by: actor.id,
    });
    if (error) stockRpcError(error);
    return data;
  }
}
