import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSearch } from "@fortawesome/free-solid-svg-icons/faSearch";
import { AppTooltip } from "../common/AppTooltip";
import { getButtonClassName, IconButton } from "../common/Button";
import NotificationBell from "../notifications/NotificationBell";
import UserMenu from "./UserMenu";
import { APP_LAYER } from "../../constants/layers";
import { faBarsStaggered, faXmark } from "@fortawesome/free-solid-svg-icons";

interface HeaderProps {
  isMobileSidebarOpen: boolean;
  setIsMobileSidebarOpen: (open: boolean) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  isNotificationsOpen: boolean;
  setIsNotificationsOpen: (open: boolean) => void;
  notificationRef: React.RefObject<HTMLDivElement | null>;
}

const Header = ({
  isMobileSidebarOpen,
  setIsMobileSidebarOpen,
  searchQuery,
  setSearchQuery,
  isNotificationsOpen,
  setIsNotificationsOpen,
  notificationRef,
}: HeaderProps) => {
  return (
     <header
       className="mx-3 mt-3 flex min-h-13 min-w-0 shrink-0 items-center justify-between gap-2 rounded-2xl border border-white/60 bg-white/80 px-3 shadow-lg backdrop-blur-xl sm:mx-4 sm:mt-4 sm:min-h-14 sm:px-4 md:mx-6 lg:mx-5 xl:mx-6"
       style={{ zIndex: APP_LAYER.header }}
     >
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        {/* Nút Hamburger cho Mobile (< 768px) */}
        <AppTooltip content="Mở menu" side="bottom">
          <button
            type="button"
            onClick={() => setIsMobileSidebarOpen(true)}
            className={`${IconButton} md:hidden`}
            aria-label="Mở menu"
            aria-controls="sidebar"
            aria-expanded={isMobileSidebarOpen}
          >
            <FontAwesomeIcon size="lg" icon={faBarsStaggered} />
          </button>
        </AppTooltip>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-800 sm:text-base">Trung tâm đóng gói Xuất khẩu linh kiện</p>
          <p className="truncate text-xs text-slate-500">EDC</p>
        </div>
      </div>

      <div className="flex min-w-0 shrink-0 items-center gap-1 sm:gap-2 lg:gap-3">
        {/* Thanh tìm kiếm (Ẩn ở mobile nhỏ, hiện ở màn hình vừa và lớn) */}
        <div className="relative hidden md:block">
          <FontAwesomeIcon icon={faSearch} className="absolute left-3 top-1/2 -translate-y-1/2 text-lg text-slate-400" aria-hidden="true" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search anything..."
            className="w-48 lg:w-64 xl:w-80 rounded-xl border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm font-medium text-slate-700 transition-all placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          {searchQuery && (
            <AppTooltip content="Xóa tìm kiếm" side="bottom">
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className={getButtonClassName({
                  variant: "icon",
                  size: "xs",
                  className: "absolute right-2 top-1/2 -translate-y-1/2 text-slate-400",
                })}
                aria-label="Xóa tìm kiếm"
              >
                <FontAwesomeIcon icon={faXmark} className="text-sm" aria-hidden="true" />
              </button>
            </AppTooltip>
          )}
        </div>

        <div className="hidden h-6 w-px bg-slate-200 md:block"></div>

        <NotificationBell
          isOpen={isNotificationsOpen}
          setIsOpen={setIsNotificationsOpen}
          containerRef={notificationRef}
        />
        <UserMenu />
      </div>
    </header>
  );
}

export default Header;
