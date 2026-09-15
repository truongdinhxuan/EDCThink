import { login } from "../../api/auth.service";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { useAuth } from "../../context/AuthContext";
import { resolveRoleCode } from "../../constants/roles";
import { getApiErrorMessage } from "../../api/errors";
import { getButtonClassName } from "../../components/common/Button";
import { getRoleHomePath } from "../../constants/workspaces";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";

interface ILoginFormInput {
  vinfast_id: number;
  password: string;
}

const CURRENT_YEAR = new Date().getFullYear();

// Small L-shaped corner mark used around the auth card for a technical,
// blueprint-style frame. Decorative only.

export const LoginPage = () => {
  useDocumentTitle("Đăng nhập");
  const { loginContext } = useAuth();
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ILoginFormInput>({
    defaultValues: {
      vinfast_id: 0,
      password: "",
    },
  });

  const onSubmit = async (data: ILoginFormInput) => {
    const { vinfast_id, password } = data;

    if (!Number.isInteger(vinfast_id) || !password) return;

    try {
      const response = await login({ vinfast_id, password });

      loginContext(response);

      // Phân luồng điều hướng dựa theo Role
      const userRole = resolveRoleCode(response.publicData?.role);
      navigate(getRoleHomePath(userRole));
    } catch (error) {
      console.error("Lỗi đăng nhập:", error);
      alert(getApiErrorMessage(error, "Đăng nhập thất bại, vui lòng kiểm tra lại thông tin!"));
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-50 px-4 py-12">
      {/* Technical grid backdrop: light graph-paper lines fading toward the edges */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0
          [background-image:linear-gradient(to_right,rgba(51,65,85,0.07)_1px,transparent_1px),linear-gradient(to_bottom,rgba(51,65,85,0.07)_1px,transparent_1px)]
          [background-size:48px_48px]
          [mask-image:radial-gradient(ellipse_65%_55%_at_50%_38%,black_10%,transparent_78%)]
          [-webkit-mask-image:radial-gradient(ellipse_65%_55%_at_50%_38%,black_10%,transparent_78%)]"
      />
      {/* Single soft brand-blue glow behind the card, no secondary accent color */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[-12rem] h-[30rem] w-[30rem] -translate-x-1/2 rounded-full bg-blue-200/40 blur-[110px]"
      />

      <div className="relative w-full max-w-md">

        <div className="motion-safe:animate-[login-card-in_0.6s_cubic-bezier(0.16,1,0.3,1)] rounded-2xl border border-slate-200 bg-white/95 p-8 shadow-lg shadow-slate-200/70 backdrop-blur-sm">
          <div className="mb-8 flex flex-col items-center text-center">
            <img
              src="https://res.cloudinary.com/pz6tbgyt/image/upload/v1789314542/EdcThink_logo.png"
              alt="VinFast"
              className="h-8"
            />
            <h2 className="mt-1 text-2xl font-extrabold text-slate-800">Login</h2>
            <p className="mt-2 text-sm text-slate-500">
              Đăng nhập để tiếp tục truy cập hệ thống
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {/* Nhập VinFast ID */}
            <div>
              <label className="mb-2 block font-mono text-[11px] font-bold uppercase tracking-wider text-slate-500">
                VinFast ID
              </label>
              <input
                type="number"
                inputMode="numeric"
                placeholder="Nhập VinFast ID"
                className={`w-full rounded-xl border px-4 py-3 font-mono text-sm tabular-nums focus:bg-white focus:outline-none focus:ring-2
                  ${errors.vinfast_id
                    ? "border-red-500 focus:border-red-500 focus:ring-red-500/20"
                    : "border-slate-200 focus:border-blue-500 focus:ring-blue-500/20"}`}
                {...register("vinfast_id", {
                  valueAsNumber: true,
                  required: "VinFast ID là trường bắt buộc",
                  validate: (value) =>
                    Number.isInteger(value) || "VinFast ID phải là số nguyên",
                })}
              />
              {errors.vinfast_id && (
                <p className="mt-1.5 text-xs font-medium text-red-500">
                  {errors.vinfast_id.message}
                </p>
              )}
            </div>

            {/* Nhập Password */}
            <div>
              <label className="mb-2 block font-mono text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Password
              </label>
              <input
                type="password"
                placeholder="••••••••"
                className={`w-full rounded-xl border px-4 py-3 text-sm focus:bg-white focus:outline-none focus:ring-2
                  ${errors.password
                    ? "border-red-500 focus:border-red-500 focus:ring-red-500/20"
                    : "border-slate-200 focus:border-blue-500 focus:ring-blue-500/20"}`}
                {...register("password", {
                  required: "Mật khẩu là trường bắt buộc nhập",
                  minLength: {
                    value: 9,
                    message: "Mật khẩu phải chứa ít nhất 9 ký tự",
                  },
                })}
              />
              {errors.password && (
                <p className="mt-1.5 text-xs font-medium text-red-500">
                  {errors.password.message}
                </p>
              )}
            </div>

            {/* Nút Đăng nhập */}
            <button
              type="submit"
              disabled={isSubmitting}
              className={getButtonClassName({
                variant: "info",
                size: "lg",
                block: true,
                className: "rounded-xl active:scale-[0.98]",
              })}
            >
              {isSubmitting ? "Đang xử lý..." : "Đăng Nhập"}
            </button>
          </form>

          <p className="mt-8 text-center font-mono text-[11px] text-slate-400">
            © {CURRENT_YEAR} EDCThink
          </p>
        </div>
      </div>
    </div>
  );
};
