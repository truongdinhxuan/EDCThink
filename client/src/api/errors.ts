import axios from "axios";

interface ErrorResponse<TDetails = unknown> {
  error?: string;
  message?: string;
  code?: string;
  details?: TDetails;
}

/** Backend refuses a status change once the Order's shift ended over 3h ago. */
export const ORDER_STATUS_UPDATE_WINDOW_EXPIRED = 'ORDER_STATUS_UPDATE_WINDOW_EXPIRED';

const businessErrorMessages: Record<string, string> = {
  [ORDER_STATUS_UPDATE_WINDOW_EXPIRED]:
    "Đã quá thời hạn cho phép cập nhật trạng thái Order (kết thúc ca + 3 giờ). Không thể tiếp tục thao tác trên Order này.",
  STACK_ALLOCATIONS_NOT_CONFIRMED:
    "Còn vật tư kiện tiêu chuẩn chưa xác nhận số chồng trước khi xuất hàng.",
  STACK_APPROVAL_NOT_COMPATIBLE:
    "Số lượng đã duyệt không tương thích với quy cách SET/chồng.",
  ALLOCATION_ALREADY_CONFIRMED:
    "Dòng vật tư này đã được xác nhận số chồng trước đó.",
  CONFIRM_REASON_REQUIRED:
    "Số chồng xác nhận khác số đã duyệt: phải chọn lý do.",
  CONFIRM_REASON_DIRECTION_MISMATCH:
    "Lý do không khớp chiều chênh lệch (nhận ít hơn / nhận thêm).",
  NORMAL_ISSUE_STOCK_CONFLICT:
    "Tồn kho không đủ để cấp hàng.",
  ORDER_ALREADY_ISSUED:
    "Order đã được cấp hàng; không thể trừ tồn lần nữa.",
  ORDER_NOT_ISSUABLE:
    "Order không ở trạng thái có thể cấp hàng.",
  ORDER_ITEM_ZERO_STOCK:
    "Vật tư hiện không còn tồn tại khu vực cấp. Không thể gửi Order.",
  WORK_SHIFT_ASSIGNMENT_NOT_FOUND:
    "Tài khoản chưa có ca làm việc hiệu lực tại thời điểm submit.",
  ORDER_SHIFT_LEADER_NOT_FOUND:
    "Không xác định được Tổ trưởng phụ trách từ thông tin managed_by.",
  ORDER_SHIFT_SHEET_CONTEXT_INVALID:
    "Phiếu Order Ca không thuộc đúng Area, nhóm, ca hoặc ngày làm việc.",
};

const technicalErrorPattern = /SQLSTATE|PostgREST|PGRST\d+|duplicate key|violates .* constraint|relation .* does not exist|function .* does not exist/i;

const resolveBusinessErrorMessage = (
  response: ErrorResponse | undefined,
  fallback: string,
): string => {
  const rawMessage = response?.error ?? response?.message;
  const code = response?.code ?? rawMessage;
  if (code && businessErrorMessages[code]) return businessErrorMessages[code];
  if (rawMessage && /Stack operation not supported for this transaction type/i.test(rawMessage)) {
    return "Loại điều chỉnh này hiện chưa hỗ trợ cho kiện sắt tiêu chuẩn.";
  }
  if (!rawMessage || technicalErrorPattern.test(rawMessage)) return fallback;
  return rawMessage;
};

export const getApiErrorMessage = (error: unknown, fallback: string): string => {
  if (axios.isAxiosError<ErrorResponse>(error)) {
    if (error.response?.data) {
      return resolveBusinessErrorMessage(error.response.data, fallback);
    }
    return error.message || fallback;
  }
  return error instanceof Error ? error.message : fallback;
};

export const getApiErrorDetails = <TDetails>(error: unknown): TDetails | null => {
  if (!axios.isAxiosError<ErrorResponse<TDetails>>(error)) return null;
  return error.response?.data?.details ?? null;
};

export const getApiErrorCode = (error: unknown): string | null => {
  if (!axios.isAxiosError<ErrorResponse>(error)) return null;
  return error.response?.data?.code ?? null;
};
