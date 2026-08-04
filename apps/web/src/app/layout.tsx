import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Shadow — the agentic orchestrator for your terminal",
  description:
    "Run Claude and Gemini under one orchestrator. Delegate across both subscriptions from your CLI, and keep the conversation when you switch.",
  openGraph: {
    title: "Shadow — the agentic orchestrator for your terminal",
    description:
      "Run Claude and Gemini under one orchestrator. Delegate across both subscriptions from your CLI.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Shadow — the agentic orchestrator for your terminal",
    description:
      "Run Claude and Gemini under one orchestrator. Delegate across both subscriptions from your CLI.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
