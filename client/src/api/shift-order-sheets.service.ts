import axios, { type AxiosResponse } from 'axios';
import instance from './http';
import type { PaginatedResponse } from '../types/pagination.types';
import type {
  IncomingShiftOrderSheet,
  ShiftOrderSheetDetail,
  ShiftOrderSheetDetailParams,
  CurrentShiftOrderSheetResponse,
  ShiftOrderSheetIncomingParams,
  ShiftOrderSheetListParams,
  ShiftOrderSheetSummary,
} from '../types/shift-order-sheets';

interface ApiEnvelope<T> {
  data: T;
}

export interface ShiftOrderSheetDownload {
  blob: Blob;
  fileName: string | null;
}

const parseDownloadFileName = (contentDisposition?: string): string | null => {
  if (!contentDisposition) return null;
  const encoded = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  return contentDisposition.match(/filename="?([^";]+)"?/i)?.[1] ?? null;
};

const exportErrorMessage = (status?: number): string => {
  if (status === 403) return 'Bạn không có quyền xuất Phiếu Order Ca này.';
  if (status === 404) return 'Không tìm thấy Phiếu Order Ca.';
  return 'Không thể tạo file Excel. Vui lòng thử lại.';
};

/**
 * A failed download still carries a JSON body, but responseType 'blob' hands it
 * back as a Blob, so the server's own explanation has to be read out of it.
 * Without this the caller only ever sees the generic fallback and has no idea
 * which Order needs fixing.
 */
const readBlobErrorMessage = async (data: unknown): Promise<string | null> => {
  if (!(data instanceof Blob)) return null;
  try {
    const parsed: unknown = JSON.parse(await data.text());
    const message = (parsed as { error?: unknown } | null)?.error;
    return typeof message === 'string' && message.trim() ? message : null;
  } catch {
    return null;
  }
};

export const listShiftOrderSheets = (
  params: ShiftOrderSheetListParams,
  signal?: AbortSignal,
): Promise<PaginatedResponse<ShiftOrderSheetSummary>> => instance.get(
  'supply/shift-order-sheets',
  { params, signal },
);

export const getShiftOrderSheet = async (
  id: string,
  signal?: AbortSignal,
  params: ShiftOrderSheetDetailParams = {},
): Promise<ShiftOrderSheetDetail> => {
  const response = await instance.get<
    ApiEnvelope<ShiftOrderSheetDetail>,
    ApiEnvelope<ShiftOrderSheetDetail>
  >(`supply/shift-order-sheets/${id}`, { params, signal });
  return response.data;
};

/**
 * Market Sheets for one shift instance. The backend restricts this to the Areas
 * that order out of the caller's own Area and requires approval authority, so no
 * area filter is sent from here.
 */
export const listIncomingShiftOrderSheets = async (
  params: ShiftOrderSheetIncomingParams,
  signal?: AbortSignal,
): Promise<IncomingShiftOrderSheet[]> => {
  const response = await instance.get<
    ApiEnvelope<IncomingShiftOrderSheet[]>,
    ApiEnvelope<IncomingShiftOrderSheet[]>
  >('supply/shift-order-sheets/incoming', { params, signal });
  return response.data;
};

export const getCurrentShiftOrderSheet = async (
  signal?: AbortSignal,
): Promise<CurrentShiftOrderSheetResponse> => {
  const response = await instance.get<
    ApiEnvelope<CurrentShiftOrderSheetResponse>,
    ApiEnvelope<CurrentShiftOrderSheetResponse>
  >('supply/shift-order-sheets/current', { signal });
  return response.data;
};

export const exportShiftOrderSheet = async (
  id: string,
): Promise<ShiftOrderSheetDownload> => {
  try {
    const response = await instance.get<Blob, AxiosResponse<Blob>>(
      `supply/shift-order-sheets/${id}/export`,
      { responseType: 'blob' },
    );
    return {
      blob: response.data,
      fileName: parseDownloadFileName(response.headers['content-disposition']),
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const serverMessage = await readBlobErrorMessage(error.response?.data);
      throw new Error(
        serverMessage ?? exportErrorMessage(error.response?.status),
        { cause: error },
      );
    }
    throw error;
  }
};
