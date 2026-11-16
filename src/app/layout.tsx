import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Browser LLM Chat — wllama (WebGPU / WASM)",
  description:
    "GGUF モデルをブラウザ内で直接実行するチャットアプリ。wllama（llama.cpp WASM）+ WebGPU 対応。すべての推論はローカルで完結します。",
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "Browser LLM Chat",
    description: "GGUF モデルをブラウザ内で直接実行するチャットアプリ",
    siteName: "Browser LLM Chat",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Browser LLM Chat",
    description: "GGUF モデルをブラウザ内で直接実行するチャットアプリ",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
