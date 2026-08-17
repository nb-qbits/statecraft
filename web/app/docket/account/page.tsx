"use client";

import { useState, useEffect } from "react";
import { getStoredBills, removeStoredBill, loadBill } from "@/lib/docket-data";
import type { DocketBill } from "@/lib/docket-types";

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function AccountPage() {
  const [bills, setBills] = useState<DocketBill[]>([]);
  const [loading, setLoading] = useState(true);
  const billLimit = 10;

  useEffect(() => {
    async function load() {
      const stored = getStoredBills();
      const loaded = await Promise.all(stored.map((s) => loadBill(s.dvId)));
      setBills(loaded.filter((b): b is DocketBill => b !== null));
      setLoading(false);
    }
    load();
  }, []);

  const handleRemove = (dvId: string) => {
    removeStoredBill(dvId);
    setBills((prev) => prev.filter((b) => b.dvId !== dvId));
  };

  const today = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const storedCount = getStoredBills().length;
  const pct = Math.min(100, (storedCount / billLimit) * 100);

  return (
    <>
      <div
        className="flex items-center justify-between border-b bg-white px-6 py-4 md:px-10 md:py-5"
        style={{ borderColor: "#E5E5EA" }}
      >
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "25px",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            color: "#16233F",
          }}
        >
          Account
        </div>
        <div style={{ fontSize: "12.5px", color: "#6E6E73", fontFamily: "var(--font-body)" }}>
          Today — {today}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 md:p-8">
        {/* Plan card */}
        <div
          className="mb-8 rounded-[12px]"
          style={{ background: "#16233F", color: "#F5F2E8", padding: "24px", boxShadow: "0 2px 8px rgba(22,35,63,0.25)" }}
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <div className="text-xs" style={{ color: "#9AA6BC" }}>
                  Current plan
                </div>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  style={{ background: "rgba(200,152,62,0.2)", color: "#C8983E" }}
                >
                  REVIEWER
                </span>
              </div>
              <div
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: "20px",
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  marginTop: "4px",
                }}
              >
                Free plan
              </div>
            </div>
            {/* TODO: Wire real Stripe payment — this button does nothing */}
            <button
              className="rounded-[10px] px-5 py-2.5 text-sm font-semibold"
              style={{ background: "#C8983E", color: "#16233F" }}
              onClick={() => {
                /* TODO: open paywall modal */
              }}
            >
              Upgrade
            </button>
          </div>

          <div className="mt-4">
            <div className="mb-1.5 flex justify-between text-xs" style={{ color: "#C7CEDE" }}>
              <span>Bills tracked</span>
              <span>
                {storedCount}/{billLimit} bills
              </span>
            </div>
            <div
              className="h-[5px] overflow-hidden rounded-full"
              style={{ background: "rgba(255,255,255,0.12)" }}
            >
              <div
                className="h-full rounded-full"
                style={{ background: "#C8983E", width: `${pct}%` }}
              />
            </div>
          </div>

          <div className="mt-3 text-xs" style={{ color: "#9AA6BC" }}>
            Unlimited bills and calendar sync (Google, Outlook, ICS) available on
            Pro.
          </div>
        </div>

        {/* Bill library */}
        <div className="mb-3 text-sm font-semibold" style={{ color: "#16233F" }}>
          Your bill library
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm" style={{ color: "#AEAEB2" }}>
            Loading...
          </div>
        ) : bills.length === 0 ? (
          <div className="py-8 text-center text-sm" style={{ color: "#AEAEB2" }}>
            No bills tracked yet.
          </div>
        ) : (
          <div
            className="overflow-hidden rounded-[12px] border"
            style={{ borderColor: "#D8D8DC", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}
          >
            {bills.map((bill, i) => (
              <div
                key={bill.dvId}
                className="flex items-center justify-between bg-white px-5 py-4"
                style={{
                  borderBottom:
                    i < bills.length - 1 ? "1px solid #EFEFF1" : "none",
                }}
              >
                <div>
                  <div className="text-sm font-medium" style={{ color: "#1D1D1F" }}>
                    {bill.title}
                  </div>
                  <div className="mt-0.5 text-xs" style={{ color: "#6E6E73" }}>
                    {bill.number} · {bill.tasks.length} tasks · Added{" "}
                    {formatDate(bill.addedDate)}
                  </div>
                </div>
                <button
                  onClick={() => handleRemove(bill.dvId)}
                  className="text-xs"
                  style={{ color: "#AEAEB2" }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
