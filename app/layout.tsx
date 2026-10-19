import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { QueryProvider } from "@/components/providers/query-provider";
import "./globals.css";

// Geist: sharper and more refined than Inter; self-hosted by next/font, no layout shift.
const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Aexyl CRM",
  description: "A premium internal operating system",
};

export const viewport: Viewport = { viewportFit: "cover", themeColor: "#000000" };

const THEME_SCRIPT = `try{var t=localStorage.getItem("aexyl-theme")||"dark";if(t==="system")t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${geist.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        {/* Apply the saved theme before paint so there's no dark/light flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-background text-text-primary">
        <ClerkProvider>
          <QueryProvider>{children}</QueryProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
