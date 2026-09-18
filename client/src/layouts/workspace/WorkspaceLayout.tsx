import { useState, useEffect, useRef, useCallback } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "../../components/workspace/Sidebar";
import Header from "../../components/workspace/Header";
import Footer from "../../components/workspace/Footer";
import { LiveNotificationToast } from "../../components/notifications/LiveNotificationToast";
import { useSupplyRealtime } from "../../hooks/useSupplyRealtime";
import { OffcanvasProvider } from "../../components/offcanvas";
import { FilterRailProvider } from "../../components/filters";
import { useFilterRail } from "../../hooks/useFilterRail";
import { useBodyScrollLock } from "../../utils/bodyScrollLock";
import { APP_LAYER } from "../../constants/layers";

const WorkspaceLayoutContent = ({
  pathname,
  locationKey,
  mobileSidebarOpenLocationKey,
  setMobileSidebarOpenLocationKey,
}: {
  pathname: string;
  locationKey: string;
  mobileSidebarOpenLocationKey: string | null;
  setMobileSidebarOpenLocationKey: (value: string | null) => void;
}) => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() =>
    localStorage.getItem("sidebar.collapsed") === "true"
  );
  const isMobileSidebarOpen = mobileSidebarOpenLocationKey === locationKey;
  const { closeFilterRail } = useFilterRail();
  const setIsMobileSidebarOpen = useCallback((open: boolean) => {
    if (open) closeFilterRail(undefined, false);
    setMobileSidebarOpenLocationKey(open ? locationKey : null);
  }, [closeFilterRail, locationKey, setMobileSidebarOpenLocationKey]);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");

  const notificationRef = useRef<HTMLDivElement>(null);
  const realtime = useSupplyRealtime();

  useEffect(() => {
    // Khởi tạo Fonts & Icons...
    if (!document.getElementById("hugeicons-cdn")) {
      const link = document.createElement("link");
      link.id = "hugeicons-cdn";
      link.rel = "stylesheet";
      link.href = "https://cdn.hugeicons.com/font/hgi-stroke-rounded.css";
      document.head.appendChild(link);
    }

    if (!document.getElementById("figtree-font")) {
      const link = document.createElement("link");
      link.id = "figtree-font";
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=Figtree:ital,wght@0,300..900;1,300..900&display=swap";
      document.head.appendChild(link);
    }
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (notificationRef.current && !notificationRef.current.contains(event.target as Node)) {
        setIsNotificationsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    localStorage.setItem("sidebar.collapsed", String(isSidebarCollapsed));
  }, [isSidebarCollapsed]);

  useEffect(() => {
    const desktopMedia = window.matchMedia("(min-width: 768px)");
    const closeDrawerOnBreakpointChange = () => setIsMobileSidebarOpen(false);
    desktopMedia.addEventListener("change", closeDrawerOnBreakpointChange);
    return () => desktopMedia.removeEventListener("change", closeDrawerOnBreakpointChange);
  }, [setIsMobileSidebarOpen]);

  useEffect(() => {
    if (!isMobileSidebarOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMobileSidebarOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isMobileSidebarOpen, setIsMobileSidebarOpen]);

  useBodyScrollLock(isMobileSidebarOpen, "mobile-sidebar");

  return (
    <OffcanvasProvider onDrawerOpen={() => {
      setIsMobileSidebarOpen(false);
      closeFilterRail(undefined, false);
    }}>
      <div className="relative flex h-screen h-dvh min-h-0 w-full max-w-full overflow-hidden bg-slate-50 font-sans text-slate-900">
        <LiveNotificationToast notification={realtime.toast} onDismiss={realtime.dismissToast} />

      {/* LỚP PHỦ MỜ KHI MỞ SIDEBAR TRÊN MOBILE */}
        <button
          type="button"
          className="workspace-sidebar-backdrop fixed inset-0 bg-slate-900/50 backdrop-blur-sm md:hidden"
          style={{ zIndex: APP_LAYER.navigationBackdrop }}
          data-open={isMobileSidebarOpen}
          onClick={() => setIsMobileSidebarOpen(false)}
          aria-label="Đóng menu"
          aria-hidden={!isMobileSidebarOpen}
          tabIndex={isMobileSidebarOpen ? 0 : -1}
        />

      {/* SIDEBAR COMPONENT */}
        <Sidebar
          isSidebarCollapsed={isSidebarCollapsed}
          setIsSidebarCollapsed={setIsSidebarCollapsed}
          isMobileSidebarOpen={isMobileSidebarOpen}
          setIsMobileSidebarOpen={setIsMobileSidebarOpen}
          pathname={pathname}
        />

      {/* MAIN WORKSPACE */}
        <main className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-slate-50">
        {/* Background blobs */}
        <div className="pointer-events-none absolute right-0 top-0 -m-32 h-96 w-96 rounded-full bg-blue-100 opacity-40 mix-blend-multiply blur-3xl filter"></div>
        <div className="pointer-events-none absolute right-48 top-0 -m-32 h-96 w-96 rounded-full bg-purple-100 opacity-40 mix-blend-multiply blur-3xl filter"></div>

        {/* HEADER COMPONENT */}
        <Header 
          isMobileSidebarOpen={isMobileSidebarOpen}
          setIsMobileSidebarOpen={setIsMobileSidebarOpen}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          isNotificationsOpen={isNotificationsOpen}
          setIsNotificationsOpen={setIsNotificationsOpen}
          notificationRef={notificationRef}
        />

        <div className="z-10 min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-3 sm:p-5 lg:px-8">
          <div className="lg:pl-3 lg:pr-6 space-y-6">
            <Outlet context={{ searchQuery, setSearchQuery }} />
          </div>
        </div>
        <Footer />
        </main>
      </div>
    </OffcanvasProvider>
  );
};

export const WorkspaceLayout = () => {
  const location = useLocation();
  const [mobileSidebarOpenLocationKey, setMobileSidebarOpenLocationKey] = useState<string | null>(null);
  const closeMobileSidebar = useCallback(() => setMobileSidebarOpenLocationKey(null), []);

  return (
    <FilterRailProvider onRailOpen={closeMobileSidebar}>
      <WorkspaceLayoutContent
        pathname={location.pathname}
        locationKey={location.key}
        mobileSidebarOpenLocationKey={mobileSidebarOpenLocationKey}
        setMobileSidebarOpenLocationKey={setMobileSidebarOpenLocationKey}
      />
    </FilterRailProvider>
  );
};
