import type { Metadata } from "next";
import { Cormorant_Garamond, DM_Sans, JetBrains_Mono, Public_Sans } from "next/font/google";
import "./globals.css";
import { createClient } from "@/lib/supabase/server";
import { TERMS_VERSION } from "@/config/terms";
import { TermsGate } from "@/components/terms-gate";

// Editorial Luxury identity (phase 25, DECISIONS 2026-08-31): serif display for
// hero moments (address, titles), DM Sans for UI labels/state, Public Sans for
// body copy. JetBrains Mono remains ONLY for the interim Wordmark/Mark —
// TODO(brand): mark/wordmark redesign is a flagged open decision.
const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Listing Studio",
  description: "Real estate photo enhancement",
};

async function needsTermsGate(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase
    .from("terms_acceptances")
    .select("version")
    .eq("user_id", user.id)
    .eq("version", TERMS_VERSION)
    .maybeSingle();
  // fail open if the table is missing (migration 0007 not applied yet) —
  // never brick the app on a schema gap
  if (error) return false;
  return data === null;
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const showTerms = await needsTermsGate();
  return (
    <html lang="en">
      <body
        className={`${publicSans.variable} ${dmSans.variable} ${cormorant.variable} ${jetbrainsMono.variable} antialiased`}
      >
        {children}
        {showTerms && <TermsGate />}
      </body>
    </html>
  );
}
