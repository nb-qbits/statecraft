"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getStoredBills,
  removeStoredBill,
  removeAllStoredBills,
  keepOnlyBills,
  loadBill,
} from "@/lib/docket-data";
import type { DocketBill } from "@/lib/docket-types";

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const FREE_LIMIT = 3;
const PRO_LIMIT = 10;

export default function AccountPage() {
  const [bills, setBills] = useState<DocketBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<"free" | "pro">("free");
  const [confirmRemoveAll, setConfirmRemoveAll] = useState(false);
  const [showDowngradeSelect, setShowDowngradeSelect] = useState(false);
  const [downgradeKeep, setDowngradeKeep] = useState<Set<string>>(new Set());

  const billLimit = plan === "pro" ? PRO_LIMIT : FREE_LIMIT;

  const reload = useCallback(async () => {
    setLoading(true);
    const stored = getStoredBills();
    const loaded = await Promise.all(stored.map((s) => loadBill(s.dvId)));
    setBills(loaded.filter((b): b is DocketBill => b !== null));
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleRemove = (dvId: string) => {
    removeStoredBill(dvId);
    setBills((prev) => prev.filter((b) => b.dvId !== dvId));
  };

  const handleRemoveAll = () => {
    removeAllStoredBills();
    setBills([]);
    setConfirmRemoveAll(false);
  };

  const handleDowngrade = () => {
    if (bills.length <= FREE_LIMIT) {
      setPlan("free");
      return;
    }
    setDowngradeKeep(new Set(bills.slice(0, FREE_LIMIT).map((b) => b.dvId)));
    setShowDowngradeSelect(true);
  };

  const toggleDowngradeKeep = (dvId: string) => {
    setDowngradeKeep((prev) => {
      const next = new Set(prev);
      if (next.has(dvId)) {
        next.delete(dvId);
      } else if (next.size < FREE_LIMIT) {
        next.add(dvId);
      }
      return next;
    });
  };

  const confirmDowngrade = () => {
    keepOnlyBills([...downgradeKeep]);
    setBills((prev) => prev.filter((b) => downgradeKeep.has(b.dvId)));
    setPlan("free");
    setShowDowngradeSelect(false);
  };

  const today = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const storedCount = bills.length;
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
            fontSize: "30px",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            color: "#16233F",
          }}
        >
          Account
        </div>
        <div style={{ fontSize: "14px", color: "#6E6E73", fontFamily: "var(--font-body)" }}>
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
                <div className="text-[13px]" style={{ color: "#9AA6BC" }}>
                  Current plan
                </div>
                <span
                  className="rounded-full px-2 py-0.5 text-[12px] font-semibold"
                  style={{ background: "rgba(200,152,62,0.2)", color: "#C8983E" }}
                >
                  {plan === "pro" ? "PRO" : "REVIEWER"}
                </span>
              </div>
              <div
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: "22px",
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  marginTop: "4px",
                }}
              >
                {plan === "pro" ? "Pro plan" : "Free plan"}
              </div>
            </div>
            {plan === "free" ? (
              <button
                className="rounded-[10px] px-5 py-2.5 text-[15px] font-semibold"
                style={{ background: "#C8983E", color: "#16233F", cursor: "pointer", border: "none" }}
                onClick={() => setPlan("pro")}
              >
                Upgrade
              </button>
            ) : (
              <button
                className="rounded-[10px] px-5 py-2.5 text-[15px] font-semibold"
                style={{
                  background: "rgba(255,255,255,0.1)",
                  color: "#C7CEDE",
                  cursor: "pointer",
                  border: "1px solid rgba(255,255,255,0.15)",
                }}
                onClick={handleDowngrade}
              >
                Downgrade
              </button>
            )}
          </div>

          <div className="mt-4">
            <div className="mb-1.5 flex justify-between text-[13px]" style={{ color: "#C7CEDE" }}>
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

          <div className="mt-3 text-[13px]" style={{ color: "#9AA6BC" }}>
            {plan === "pro"
              ? "Pro plan — unlimited bills and calendar sync."
              : `Free plan — up to ${FREE_LIMIT} bills. Upgrade for unlimited bills and calendar sync.`}
          </div>
        </div>

        {/* Downgrade selection modal */}
        {showDowngradeSelect && (
          <div
            className="mb-8 overflow-hidden rounded-[12px] border"
            style={{ borderColor: "#C8983E", boxShadow: "0 2px 12px rgba(200,152,62,0.15)" }}
          >
            <div
              className="px-5 py-4"
              style={{ background: "#FBF6ED", borderBottom: "1px solid #E8DEC5" }}
            >
              <div className="text-[16px] font-semibold" style={{ color: "#16233F" }}>
                Choose bills to keep
              </div>
              <div className="mt-1 text-[14px]" style={{ color: "#6E6E73" }}>
                Free plan allows {FREE_LIMIT} bills. Select which ones to keep —
                the rest will be removed along with their calendar entries.
              </div>
            </div>
            <div className="bg-white">
              {bills.map((bill, i) => {
                const selected = downgradeKeep.has(bill.dvId);
                const disabled = !selected && downgradeKeep.size >= FREE_LIMIT;
                return (
                  <div
                    key={bill.dvId}
                    onClick={() => !disabled && toggleDowngradeKeep(bill.dvId)}
                    className="flex items-center gap-3.5 px-5 py-3.5"
                    style={{
                      borderBottom: i < bills.length - 1 ? "1px solid #EFEFF1" : "none",
                      cursor: disabled ? "not-allowed" : "pointer",
                      opacity: disabled ? 0.45 : 1,
                      background: selected ? "#F0F5FF" : "transparent",
                      transition: "background 0.15s",
                    }}
                  >
                    <div
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 6,
                        border: selected ? "none" : "1.5px solid #C8C8CC",
                        background: selected ? "#16233F" : "#FFFFFF",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        transition: "all 0.15s",
                      }}
                    >
                      {selected && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-medium" style={{ color: "#1D1D1F" }}>
                        {bill.title}
                      </div>
                      <div className="mt-0.5 text-[13px]" style={{ color: "#86868B" }}>
                        {bill.number} · {bill.tasks.length} tasks
                      </div>
                    </div>
                    {selected && (
                      <span className="text-[12px] font-semibold" style={{ color: "#3C5A82" }}>
                        Keeping
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <div
              className="flex items-center justify-between px-5 py-3.5"
              style={{ background: "#FAFAFA", borderTop: "1px solid #EFEFF1" }}
            >
              <div className="text-[13px]" style={{ color: "#86868B" }}>
                {downgradeKeep.size}/{FREE_LIMIT} selected
              </div>
              <div className="flex gap-2.5">
                <button
                  onClick={() => setShowDowngradeSelect(false)}
                  className="rounded-[8px] px-4 py-2 text-[14px] font-medium"
                  style={{ color: "#6E6E73", background: "none", border: "1px solid #D8D8DC", cursor: "pointer" }}
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDowngrade}
                  disabled={downgradeKeep.size === 0}
                  className="rounded-[8px] px-4 py-2 text-[14px] font-semibold"
                  style={{
                    background: downgradeKeep.size > 0 ? "#B8452F" : "#D8D8DC",
                    color: "#FFFFFF",
                    border: "none",
                    cursor: downgradeKeep.size > 0 ? "pointer" : "not-allowed",
                  }}
                >
                  Downgrade & remove {bills.length - downgradeKeep.size} bill{bills.length - downgradeKeep.size !== 1 ? "s" : ""}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Bill library header */}
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[15px] font-semibold" style={{ color: "#16233F" }}>
            Your bill library
          </div>
          {!loading && bills.length > 0 && (
            <div className="flex gap-2">
              {!confirmRemoveAll ? (
                <button
                  onClick={() => setConfirmRemoveAll(true)}
                  className="rounded-[8px] px-3 py-1.5 text-[13px] font-medium"
                  style={{ color: "#B8452F", background: "none", border: "1px solid #E5D5D0", cursor: "pointer" }}
                >
                  Remove all
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-[13px]" style={{ color: "#B8452F" }}>
                    Remove all {bills.length} bills?
                  </span>
                  <button
                    onClick={handleRemoveAll}
                    className="rounded-[8px] px-3 py-1.5 text-[13px] font-semibold"
                    style={{ background: "#B8452F", color: "#FFFFFF", border: "none", cursor: "pointer" }}
                  >
                    Yes, remove all
                  </button>
                  <button
                    onClick={() => setConfirmRemoveAll(false)}
                    className="rounded-[8px] px-3 py-1.5 text-[13px] font-medium"
                    style={{ color: "#6E6E73", background: "none", border: "1px solid #D8D8DC", cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {loading ? (
          <div className="py-8 text-center text-[15px]" style={{ color: "#AEAEB2" }}>
            Loading...
          </div>
        ) : bills.length === 0 ? (
          <div className="py-8 text-center text-[15px]" style={{ color: "#AEAEB2" }}>
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
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-medium" style={{ color: "#1D1D1F" }}>
                    {bill.title}
                  </div>
                  <div className="mt-0.5 text-[13px]" style={{ color: "#6E6E73" }}>
                    {bill.number} · {bill.tasks.length} tasks · Added{" "}
                    {formatDate(bill.addedDate)}
                  </div>
                </div>
                <button
                  onClick={() => handleRemove(bill.dvId)}
                  className="ml-3 flex-shrink-0 rounded-[8px] px-3 py-1.5 text-[13px] font-medium"
                  style={{ color: "#B8452F", background: "none", border: "1px solid #E5D5D0", cursor: "pointer" }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        {!loading && bills.length > 0 && (
          <div className="mt-3 text-[13px]" style={{ color: "#AEAEB2" }}>
            Removing a bill clears it from your dashboard and calendar.
          </div>
        )}
      </div>
    </>
  );
}
