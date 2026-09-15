import { useAuth } from "../../context/AuthContext";
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

const RoleDashboardPage = () => {
  useDocumentTitle('Tổng quan');
  const { user, role } = useAuth();
  const profile = user?.publicData;
  const displayName = [profile?.last_name, profile?.first_name]
    .filter(Boolean)
    .join(" ") || profile?.email || "Người dùng";
  // Role name comes from the user's own record so any role the database defines
  // renders correctly, with the raw code as fallback.
  const roleName = (profile?.role && typeof profile.role === "object"
    ? profile.role.name
    : null) ?? role ?? "Chưa được gán";

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-widest text-blue-600">Workspace dashboard</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Xin chào, {displayName}</h1>
        <p className="mt-2 text-sm text-slate-500">
          Các chức năng hiển thị theo permission được gán cho tài khoản của bạn.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-slate-500">Role hiện tại</p>
          <p className="mt-2 text-lg font-bold text-slate-900">{roleName}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-slate-500">Khu vực làm việc</p>
          <p className="mt-2 text-lg font-bold text-slate-900">
            {profile?.area ? `${profile.area.code} — ${profile.area.name}` : "Chưa được gán"}
          </p>
        </div>
      </div>
    </section>
  );
};

export default RoleDashboardPage;
