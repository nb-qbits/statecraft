"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { getStoredBills, loadBill } from "@/lib/docket-data";
import type { DocketBill } from "@/lib/docket-types";

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const STATUS_COLORS: Record<string, string> = {
  analyzed: "#3F6B54",
  processing: "#A67326",
  error: "#B8452F",
};

export default function AdminPage() {
  const [bills, setBills] = useState<DocketBill[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const stored = getStoredBills();
      const loaded = await Promise.all(stored.map((s) => loadBill(s.dvId)));
      setBills(loaded.filter((b): b is DocketBill => b !== null));
      setLoading(false);
    }
    load();
  }, []);

  const totalDocs = bills.length;
  const totalTasks = bills.reduce((sum, b) => sum + b.tasks.length, 0);

  return (
    <div className="flex min-h-screen">
      {/* Admin sidebar */}
      <div
        className="hidden w-[230px] flex-shrink-0 flex-col p-6 px-5 md:flex"
        style={{ background: "#16233F", color: "#E7E3D6" }}
      >
        <div className="mb-6 flex items-center gap-2.5">
          <div
            className="flex h-[30px] w-[30px] items-center justify-center rounded-[7px] text-sm font-bold text-white"
            style={{ background: "#4C6D96" }}
          >
            D
          </div>
          <div className="text-[15px] font-semibold" style={{ color: "#F5F2E8" }}>
            Docket Admin
          </div>
        </div>
        <div
          className="mb-5 text-[11px] uppercase tracking-widest"
          style={{ color: "#9AA6BC" }}
        >
          Internal console
        </div>
        <Link
          href="/docket"
          className="mt-auto flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13.5px] no-underline"
          style={{ color: "#B7BECF" }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Exit admin
        </Link>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-8 md:p-10">
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "25px",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            color: "#16233F",
            marginBottom: "24px",
          }}
        >
          Admin overview
        </div>

        {/* Stat cards */}
        <div className="mb-8 grid grid-cols-1 gap-3.5 md:grid-cols-3">
          <div
            className="rounded-[12px] border bg-white"
            style={{ borderColor: "#D8D8DC", padding: "18px 20px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}
          >
            <div style={{ fontSize: "12px", fontWeight: 500, color: "#6E6E73", marginBottom: "8px", fontFamily: "var(--font-body)" }}>
              Total users
            </div>
            <div
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: "26px",
                fontWeight: 700,
                letterSpacing: "-0.03em",
                fontVariantNumeric: "tabular-nums",
                color: "#16233F",
                lineHeight: 1,
              }}
            >
              1
            </div>
          </div>
          <div
            className="rounded-[12px] border bg-white"
            style={{ borderColor: "#D8D8DC", padding: "18px 20px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}
          >
            <div style={{ fontSize: "12px", fontWeight: 500, color: "#6E6E73", marginBottom: "8px", fontFamily: "var(--font-body)" }}>
              Documents processed
            </div>
            <div
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: "26px",
                fontWeight: 700,
                letterSpacing: "-0.03em",
                fontVariantNumeric: "tabular-nums",
                color: "#16233F",
                lineHeight: 1,
              }}
            >
              {loading ? "—" : totalDocs}
            </div>
          </div>
          <div
            className="rounded-[12px] border bg-white"
            style={{ borderColor: "#D8D8DC", padding: "18px 20px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}
          >
            <div style={{ fontSize: "12px", fontWeight: 500, color: "#6E6E73", marginBottom: "8px", fontFamily: "var(--font-body)" }}>
              Total tasks found
            </div>
            <div
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: "26px",
                fontWeight: 700,
                letterSpacing: "-0.03em",
                fontVariantNumeric: "tabular-nums",
                color: "#4C6D96",
                lineHeight: 1,
              }}
            >
              {loading ? "—" : totalTasks}
            </div>
          </div>
        </div>

        {/* Users table — placeholder since no real user data */}
        <div className="mb-3 text-sm font-semibold" style={{ color: "#16233F" }}>
          Users
        </div>
        <div
          className="mb-8 overflow-hidden rounded-[12px] border"
          style={{ borderColor: "#D8D8DC", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}
        >
          <div
            className="grid border-b bg-white px-[18px] py-2.5 text-[11px] uppercase tracking-wide"
            style={{
              gridTemplateColumns: "1.4fr 1.6fr 0.8fr 0.8fr 1fr",
              color: "#86868B",
              borderColor: "#E5E5EA",
            }}
          >
            <div>Name</div>
            <div>Email</div>
            <div>Plan</div>
            <div>Bills</div>
            <div>Joined</div>
          </div>
          <div
            className="grid bg-white px-[18px] py-3 text-[13px]"
            style={{
              gridTemplateColumns: "1.4fr 1.6fr 0.8fr 0.8fr 1fr",
              color: "#1D1D1F",
            }}
          >
            <div>You</div>
            <div style={{ color: "#6E6E73" }}>—</div>
            <div>Free</div>
            <div>{loading ? "—" : bills.length}</div>
            <div style={{ color: "#6E6E73" }}>—</div>
          </div>
        </div>

        {/* Documents table — real data from tracked bills */}
        <div className="mb-3 text-sm font-semibold" style={{ color: "#16233F" }}>
          Documents processed
        </div>
        <div
          className="overflow-hidden rounded-[12px] border"
          style={{ borderColor: "#D8D8DC", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}
        >
          <div
            className="grid border-b bg-white px-[18px] py-2.5 text-[11px] uppercase tracking-wide"
            style={{
              gridTemplateColumns: "1fr 1fr 1.4fr 1fr 1fr",
              color: "#86868B",
              borderColor: "#E5E5EA",
            }}
          >
            <div>Bill</div>
            <div>Jurisdiction</div>
            <div>Tasks</div>
            <div>Date</div>
            <div>Status</div>
          </div>
          {loading ? (
            <div className="bg-white px-[18px] py-4 text-sm" style={{ color: "#AEAEB2" }}>
              Loading...
            </div>
          ) : bills.length === 0 ? (
            <div className="bg-white px-[18px] py-4 text-sm" style={{ color: "#AEAEB2" }}>
              No documents processed yet.
            </div>
          ) : (
            bills.map((bill, i) => (
              <div
                key={bill.dvId}
                className="grid bg-white px-[18px] py-3 text-[13px]"
                style={{
                  gridTemplateColumns: "1fr 1fr 1.4fr 1fr 1fr",
                  color: "#1D1D1F",
                  borderBottom:
                    i < bills.length - 1 ? "1px solid #EFEFF1" : "none",
                }}
              >
                <div>{bill.number}</div>
                <div style={{ color: "#6E6E73" }}>{bill.jurisdiction}</div>
                <div style={{ color: "#6E6E73" }}>
                  {bill.tasks.length} tasks
                </div>
                <div style={{ color: "#6E6E73" }}>
                  {formatDate(bill.addedDate)}
                </div>
                <div
                  style={{
                    color: STATUS_COLORS["analyzed"] ?? "#3F6B54",
                    fontWeight: 500,
                  }}
                >
                  Analyzed
                </div>
              </div>
            ))
          )}
        </div>

        {/* Mobile back link */}
        <div className="mt-8 md:hidden">
          <Link
            href="/docket"
            className="text-sm no-underline"
            style={{ color: "#4C6D96" }}
          >
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
