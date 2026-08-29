import type { Metadata } from "next";
import { JetBrains_Mono, Public_Sans } from "next/font/google";
import "./globals.css";
import { createClient } from "@/lib/supabase/server";
import { TERMS_VERSION } from "@/config/terms";
import { TermsGate } from "@/components/terms-gate";

// Darkroom identity: mono marks machine truth (state, cost, dimensions,
// filenames), sans marks human intent (what you asked for).
const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
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
        className={`${publicSans.variable} ${jetbrainsMono.variable} antialiased`}
      >
        {children}
        {showTerms && <TermsGate />}
      </body>
    </html>
  );
}
