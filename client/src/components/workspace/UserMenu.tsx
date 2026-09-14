import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faRightFromBracket } from "@fortawesome/free-solid-svg-icons";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { getButtonClassName } from "../common/Button";
import { APP_LAYER } from "../../constants/layers";

const fallbackAvatar =
  "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png";

const UserMenu = () => {
  const { user, role, logoutContext } = useAuth();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const profile = user?.publicData;
  const displayName = [profile?.last_name, profile?.first_name]
    .filter(Boolean)
    .join(" ") || profile?.email || "Người dùng";
  const roleDisplayName =
    profile?.role && typeof profile.role === "object"
      ? profile.role.name
      : role ?? "Người dùng";
  const accountIdentifier = profile?.vinfast_id
    ? `VF ID: ${profile.vinfast_id}`
    : profile?.email ?? "";

  useEffect(() => {
    if (!isOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  const handleLogout = async () => {
    setIsOpen(false);
    await logoutContext();
    navigate("/auth/login", { replace: true });
  };

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className={getButtonClassName({
          variant: "ghost",
          size: "sm",
          className: "max-w-[12rem] rounded-full !p-1 sm:rounded-xl sm:pr-2",
        })}
        aria-label={`Mở menu tài khoản của ${displayName}`}
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <img
          src={profile?.avatar_url || fallbackAvatar}
          alt=""
          aria-hidden="true"
          className="h-8 w-8 shrink-0 rounded-full border border-slate-200 object-cover"
        />
        <span className="hidden min-w-0 text-left lg:block">
          <span className="block truncate text-xs font-semibold text-slate-700">{displayName}</span>
          <span className="block truncate text-[10px] text-slate-500">{roleDisplayName}</span>
        </span>
        <FontAwesomeIcon
          icon={faChevronDown}
          className={`hidden text-xs text-slate-400 transition-transform sm:block ${isOpen ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-[min(18rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl"
          style={{ zIndex: APP_LAYER.dropdown }}
        >
          <div className="border-b border-slate-100 px-3 py-2.5">
            <p className="truncate text-sm font-bold text-slate-900">{displayName}</p>
            <p className="mt-0.5 truncate text-xs text-slate-500">{roleDisplayName}</p>
            {accountIdentifier && (
              <p className="mt-1 truncate text-xs text-slate-400">{accountIdentifier}</p>
            )}
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => void handleLogout()}
            className={getButtonClassName({
              variant: "textError",
              size: "sm",
              block: true,
              className: "mt-1 !justify-start",
            })}
          >
            <FontAwesomeIcon icon={faRightFromBracket} aria-hidden="true" />
            Đăng xuất
          </button>
        </div>
      )}
    </div>
  );
};

export default UserMenu;
