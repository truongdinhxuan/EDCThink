import axios, { type AxiosResponse } from 'axios';
import instance from './http';
import type { PaginatedResponse } from '../types/pagination.types';
import type {
  ShiftOrderSheetDetail,
  ShiftOrderSheetDetailParams,
  CurrentShiftOrderSheetResponse,
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
      throw new Error(exportErrorMessage(error.response?.status), { cause: error });
    }
    throw error;
  }
};
