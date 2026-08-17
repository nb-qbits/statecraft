"use client";

import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();

  return (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ background: "linear-gradient(160deg, #1A2A4A 0%, #16233F 50%, #111D33 100%)" }}
    >
      <div
        className="w-[360px] bg-white p-12 text-center"
        style={{ borderRadius: "20px", boxShadow: "0 24px 70px rgba(0,0,0,0.3)" }}
      >
        <div
          className="mx-auto mb-[18px] flex h-11 w-11 items-center justify-center rounded-[10px] text-xl font-bold"
          style={{ background: "#C8983E", color: "#16233F" }}
        >
          D
        </div>
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "24px",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: "#16233F",
            marginBottom: "6px",
          }}
        >
          Docket
        </div>
        <div className="mb-8 text-[13px]" style={{ color: "#6E6E73" }}>
          Deadline intelligence for legislation.
        </div>

        {/* TODO: Wire real Google OAuth — this is a stub */}
        <button
          onClick={() => router.push("/docket")}
          className="flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-[10px] px-4 py-[13px] text-sm font-semibold transition-transform active:scale-[0.97]"
          style={{ background: "#16233F", color: "#F5F2E8" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24">
            <path
              fill="#fff"
              d="M21.35 11.1h-9.17v2.92h5.27c-.23 1.44-1.62 4.22-5.27 4.22-3.17 0-5.76-2.62-5.76-5.85s2.59-5.85 5.76-5.85c1.8 0 3.01.77 3.7 1.43l2.52-2.43C16.98 3.86 14.9 3 12.18 3 6.9 3 2.6 7.24 2.6 12.5s4.3 9.5 9.58 9.5c5.53 0 9.19-3.89 9.19-9.36 0-.63-.07-1.11-.02-1.54z"
            />
          </svg>
          Continue with Google
        </button>

        <div
          className="mt-[18px] cursor-default text-[12.5px]"
          style={{ color: "#AEAEB2" }}
        >
          Sign in with email &amp; password
        </div>
      </div>
    </div>
  );
}
