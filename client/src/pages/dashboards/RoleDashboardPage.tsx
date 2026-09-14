import type { RoleCode } from "../../constants/roles";
import { ROLE_WORKSPACES } from "../../constants/workspaces";
import { useAuth } from "../../context/AuthContext";

const RoleDashboardPage = ({ workspaceRole }: { workspaceRole?: RoleCode }) => {
  const { user, role } = useAuth();
  const workspace = workspaceRole ? ROLE_WORKSPACES[workspaceRole] : null;
  const displayName = [user?.publicData.last_name, user?.publicData.first_name]
    .filter(Boolean)
    .join(" ") || user?.publicData.email || "Người dùng";

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-widest text-blue-600">{workspace?.dashboardLabel ?? 'Workspace dashboard'}</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Xin chào, {displayName}</h1>
        <p className="mt-2 text-sm text-slate-500">
          {workspace?.dashboardDescription ?? 'Các chức năng hiển thị theo permission được gán.'}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-slate-500">Role hiện tại</p>
          <p className="mt-2 text-lg font-bold text-slate-900">{role ?? "Chưa được gán"}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-slate-500">Trạng thái triển khai</p>
          <p className="mt-2 text-lg font-bold text-slate-900">Routing và permission menu</p>
        </div>
      </div>
    </section>
  );
};

export default RoleDashboardPage;
