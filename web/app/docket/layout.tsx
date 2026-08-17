"use client";

import { Sidebar } from "@/components/docket/sidebar";

export default function DocketLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row" style={{ background: "#F5F5F7" }}>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col pb-20 md:pb-0">
        {children}
      </div>
    </div>
  );
}
