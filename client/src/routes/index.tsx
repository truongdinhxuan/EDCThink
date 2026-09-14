import { lazy } from "react";
import { Navigate, type RouteObject, useRoutes } from "react-router-dom";
import { PageSkeleton } from "../components/common/skeleton";
import { getRoleHomePath, getWorkspacePath } from "../constants/workspaces";
import { useAuth } from "../context/AuthContext";
import { authRoutes } from "./auth.routes";
import { workspaceRoutes } from "./workspace.routes";

const HomePage = lazy(() => import("../pages/HomePage"));
const UnauthorizedPage = lazy(() => import("../pages/error/UnauthorizedPage"));
const NotFoundPage = lazy(() => import("../pages/error/NotFoundPage"));

const RoleWorkspaceRedirect = ({
  relativePath,
}: {
  relativePath?: string;
}) => {
  const { user, role, loading } = useAuth();

  if (loading) return <PageSkeleton />;
  if (!user) return <Navigate to="/auth/login" replace />;
  return (
    <Navigate
      to={
        relativePath
          ? getWorkspacePath(role, relativePath)
          : getRoleHomePath(role)
      }
      replace
    />
  );
};

export const AppRoutes = () => {
  const routes: RouteObject[] = [
    { path: "/", element: <HomePage /> },
    authRoutes,
    { path: "/403-unauthorized", element: <UnauthorizedPage /> },
    { path: "/404", element: <NotFoundPage /> },
    ...workspaceRoutes,
    { path: "/milkrun", element: <RoleWorkspaceRedirect relativePath="milkrun" /> },
    { path: "*", element: <Navigate to="/404" replace /> },
  ];

  return useRoutes(routes);
};
