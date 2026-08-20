import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import { AssessmentProvider } from "@/components/AssessmentProvider";
import { SetupGate } from "@/components/SetupGate";
import { ToastProvider } from "@/components/toast";
import "./globals.css";

// Neon brand typography:
//   • Inter for UI, headlines, marketing copy
//   • Geist Mono for code, version tags, technical UI labels
// Ref: https://neon.com/brand
const inter = Inter({
  variable: "--font-sans-display",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-mono-display",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Neon Upgrade Advisor",
  description:
    "PostgreSQL version upgrade advisor for Neon — assess breaking changes, deprecations, and recommended migration path",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex h-dvh overflow-hidden text-foreground">
        <ToastProvider>
          <AssessmentProvider>
            <SetupGate>{children}</SetupGate>
          </AssessmentProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
