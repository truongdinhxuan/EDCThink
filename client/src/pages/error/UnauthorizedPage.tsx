import { Link } from "react-router-dom";
import { InfoButton } from "../../components/common/Button";
import { getRoleHomePath } from "../../constants/workspaces";
import { useAuth } from "../../context/AuthContext";

const UnauthorizedPage = () => {
  const { role } = useAuth();

  return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
    <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <p className="text-sm font-bold text-red-600">403</p>
      <h1 className="mt-2 text-2xl font-bold text-slate-900">Không có quyền truy cập</h1>
      <p className="mt-3 text-sm text-slate-500">
        Tài khoản chưa được gán một trong năm role hoặc không có quyền mở trang này.
        Tài khoản chưa được cấp quyền truy cập chức năng này.
      </p>
      <Link
        to={role ? getRoleHomePath(role) : "/auth/login"}
        className={`${InfoButton} mt-6`}
      >
        {role ? "Về dashboard" : "Về đăng nhập"}
      </Link>
    </div>
  </main>;
};

export default UnauthorizedPage;
