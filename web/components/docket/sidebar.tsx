"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getStoredBills } from "@/lib/docket-data";
import { fetchUserInfo, syncBillTracking } from "@/lib/api";

/* ------------------------------------------------------------------ */
/*  Route config                                                       */
/* ------------------------------------------------------------------ */

interface NavItem {
  label: string;
  href: string;
  /** Return true when this item should appear active. */
  isActive: (path: string) => boolean;
  icon: React.ReactNode;
}

/* ------------------------------------------------------------------ */
/*  SVG icons (17x17, stroke-based)                                    */
/* ------------------------------------------------------------------ */

function DashboardIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 17 17"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="1.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="10.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="1.5" y="10.5" width="5" height="5" rx="1" />
      <rect x="10.5" y="10.5" width="5" height="5" rx="1" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 17 17"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="1.5" y="3" width="14" height="12.5" rx="2" />
      <line x1="1.5" y1="7.5" x2="15.5" y2="7.5" />
      <line x1="5.5" y1="1" x2="5.5" y2="4.5" />
      <line x1="11.5" y1="1" x2="11.5" y2="4.5" />
    </svg>
  );
}

function AddBillIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 17 17"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8.5" cy="8.5" r="7" />
      <line x1="8.5" y1="5" x2="8.5" y2="12" />
      <line x1="5" y1="8.5" x2="12" y2="8.5" />
    </svg>
  );
}

function AccountIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 17 17"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8.5" cy="5.5" r="3.5" />
      <path d="M1.5 15.5c0-3 3-5 7-5s7 2 7 5" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Nav items                                                          */
/* ------------------------------------------------------------------ */

const NAV_ITEMS: NavItem[] = [
  {
    label: "Dashboard",
    href: "/docket",
    isActive: (p) => p === "/docket" || p.startsWith("/docket/bill/"),
    icon: <DashboardIcon />,
  },
  {
    label: "Calendar",
    href: "/docket/calendar",
    isActive: (p) => p === "/docket/calendar",
    icon: <CalendarIcon />,
  },
  {
    label: "Add a bill",
    href: "/docket/add",
    isActive: (p) => p === "/docket/add",
    icon: <AddBillIcon />,
  },
  {
    label: "Account",
    href: "/docket/account",
    isActive: (p) => p === "/docket/account",
    icon: <AccountIcon />,
  },
];

/* ------------------------------------------------------------------ */
/*  Desktop sidebar                                                    */
/* ------------------------------------------------------------------ */

function DesktopSidebar({ pathname, billCount, billLimit, plan }: { pathname: string; billCount: number; billLimit: number; plan: string }) {
  const meterPct = Math.min(100, (billCount / billLimit) * 100);

  return (
    <aside className="hidden md:flex sticky top-0 h-screen w-[250px] flex-col p-7 px-5 text-[#E7E3D6]" style={{ background: "linear-gradient(180deg, #1A2A4A 0%, #16233F 40%, #111D33 100%)" }}>
      {/* Logo */}
      <div className="mb-6 border-b border-white/[0.14] pb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-[7px] bg-[#C8983E]">
            <span className="text-sm font-bold text-white">D</span>
          </div>
          <div>
            <h1 style={{ fontFamily: "var(--font-heading)", fontSize: "19px", fontWeight: 700, lineHeight: 1.2, color: "#F5F2E8", letterSpacing: "-0.02em" }}>
              Docket
            </h1>
            <p className="text-[13px] text-[#9AA6BC]">Legislative deadlines</p>
          </div>
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const active = item.isActive(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                active
                  ? "bg-[rgba(200,152,62,0.16)] text-[#F5F2E8]"
                  : "bg-transparent text-[#B7BECF] hover:bg-white/[0.06] hover:text-[#E7E3D6]"
              }`}
            >
              {item.icon}
              <span style={{ fontSize: "15px", fontFamily: "var(--font-body)" }}>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="mt-auto flex flex-col gap-4">
        <p className="text-[13px] leading-relaxed text-[#9AA6BC]">
          Every computed date cites the rule that produced it. Unresolved items
          are real obligations, not failures.
        </p>

        {/* Plan meter */}
        <div className="rounded-lg bg-white/[0.06] p-3">
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-[#B7BECF]">{plan === "waitlisted" ? "Waitlisted" : "Free plan"}</span>
            <span className="text-[#B7BECF]">{billCount}/{billLimit} bills</span>
          </div>
          <div className="mt-2 h-1.5 w-full rounded-full bg-white/[0.1]">
            <div
              className="h-1.5 rounded-full bg-[#C8983E]"
              style={{ width: `${meterPct}%` }}
            />
          </div>
        </div>

        {/* Footer links */}
        <div className="flex flex-col gap-2">
          <Link
            href="/docket/admin"
            className="text-[13px] text-[#7C86A0] hover:text-[#9AA6BC] transition-colors"
          >
            Admin console
          </Link>
          <Link
            href="/login"
            className="text-[13px] text-[#7C86A0] hover:text-[#9AA6BC] transition-colors"
          >
            Sign out
          </Link>
        </div>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/*  Mobile bottom bar                                                  */
/* ------------------------------------------------------------------ */

function MobileBottomBar({ pathname }: { pathname: string }) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t border-gray-200 bg-white md:hidden">
      {NAV_ITEMS.map((item) => {
        const active = item.isActive(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-1 flex-col items-center gap-1 py-2 transition-colors ${
              active ? "text-[#C8983E]" : "text-[#86868B]"
            }`}
          >
            <span className="[&>svg]:h-5 [&>svg]:w-5">{item.icon}</span>
            <span className="text-[11px]">
              {item.label === "Add a bill" ? "Add" : item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/*  Sidebar (combined export)                                          */
/* ------------------------------------------------------------------ */

export function Sidebar() {
  const pathname = usePathname();
  const [billCount, setBillCount] = useState(0);
  const [billLimit, setBillLimit] = useState(3);
  const [plan, setPlan] = useState("free");

  useEffect(() => {
    const storedIds = getStoredBills();
    setBillCount(storedIds.length);
    syncBillTracking(storedIds)
      .then(() => fetchUserInfo())
      .then((u) => {
        setBillCount(u.trackedBills);
        setBillLimit(u.billLimit);
        setPlan(u.plan);
      })
      .catch(() => {});
  }, [pathname]);

  return (
    <>
      <DesktopSidebar pathname={pathname} billCount={billCount} billLimit={billLimit} plan={plan} />
      <MobileBottomBar pathname={pathname} />
    </>
  );
}

export default Sidebar;
