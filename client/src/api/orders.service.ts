import instance from "./http";
import type {
  ApproveOrderInput,
  CancelOrderInput,
  ConfirmStackItemInput,
  ConfirmStackItemResult,
  CreateOrderInput,
  IssueOrderInput,
  Order,
  OrderListParams,
  OrderStatus,
  ReceiveOrderInput,
  RejectOrderInput,
  UpdateOrderInput,
} from "../types/orders";
import type { PaginatedResponse } from '../types/pagination.types';

interface ApiEnvelope<T> {
  data: T;
}

const get = <T>(response: ApiEnvelope<T>): T => response.data;
const normalizeOrder = (order: Order): Order => (
  order.status_lookup?.code
    ? { ...order, status: order.status_lookup.code as OrderStatus }
    : order
);

export const listOrders = async (
  params: OrderListParams = {},
  signal?: AbortSignal,
): Promise<PaginatedResponse<Order>> => {
  const response = await instance.get<
    PaginatedResponse<Order>,
    PaginatedResponse<Order>
  >('orders', { params, signal });
  return { ...response, data: response.data.map(normalizeOrder) };
};

export const getOrder = async (id: string, signal?: AbortSignal): Promise<Order> =>
  normalizeOrder(
    get(await instance.get<ApiEnvelope<Order>, ApiEnvelope<Order>>(`orders/${id}`, { signal })),
  );

export const createOrder = async (input: CreateOrderInput): Promise<Order> =>
  normalizeOrder(get(await instance.post<ApiEnvelope<Order>, ApiEnvelope<Order>>("orders", input)));

export const updateOrder = async (id: string, input: UpdateOrderInput): Promise<Order> =>
  normalizeOrder(get(await instance.patch<ApiEnvelope<Order>, ApiEnvelope<Order>>(`orders/${id}`, input)));

export const approveOrder = async (id: string, input: ApproveOrderInput): Promise<Order> =>
  normalizeOrder(get(await instance.post<ApiEnvelope<Order>, ApiEnvelope<Order>>(`orders/${id}/approve`, input)));

export const confirmOrderStackItem = async (
  orderId: string,
  orderItemId: string,
  input: ConfirmStackItemInput,
): Promise<ConfirmStackItemResult> => {
  const result = get(
    await instance.post<
      ApiEnvelope<ConfirmStackItemResult>,
      ApiEnvelope<ConfirmStackItemResult>
    >(`orders/${orderId}/items/${orderItemId}/confirm`, input),
  );
  return { ...result, order: normalizeOrder(result.order) };
};

export const rejectOrder = async (id: string, input: RejectOrderInput): Promise<Order> =>
  normalizeOrder(get(await instance.post<ApiEnvelope<Order>, ApiEnvelope<Order>>(`orders/${id}/reject`, input)));

export const issueOrder = async (id: string, input: IssueOrderInput): Promise<Order> =>
  normalizeOrder(get(await instance.post<ApiEnvelope<Order>, ApiEnvelope<Order>>(`orders/${id}/issue`, input)));

export const receiveOrder = async (
  id: string,
  input: ReceiveOrderInput = {},
): Promise<Order> =>
  normalizeOrder(get(await instance.post<ApiEnvelope<Order>, ApiEnvelope<Order>>(`orders/${id}/receive`, input)));

export const completeOrder = async (id: string): Promise<Order> =>
  normalizeOrder(get(await instance.post<ApiEnvelope<Order>, ApiEnvelope<Order>>(`orders/${id}/complete`)));

export const cancelOrder = async (id: string, input: CancelOrderInput): Promise<Order> =>
  normalizeOrder(get(await instance.post<ApiEnvelope<Order>, ApiEnvelope<Order>>(`orders/${id}/cancel`, input)));
