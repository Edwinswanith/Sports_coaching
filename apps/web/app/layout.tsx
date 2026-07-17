import type { Metadata } from "next";
import "./globals.css";
import { ServiceWorkerRegister } from "../components/ServiceWorkerRegister";
import { TourProvider } from "../lib/tour/TourProvider";

// The app uses the native-first system font stack defined in tailwind.config.ts.
export const metadata: Metadata = {
  title: "Sports Coaching Platform",
  description: "Daily readiness, training load, and recovery for athletes and coaches.",
  applicationName: "Apex",
  appleWebApp: {
    capable: true,
    title: "Apex",
    statusBarStyle: "default",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover" as const,
  themeColor: "#f6f7f3",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased">
        <ServiceWorkerRegister />
        <TourProvider>{children}</TourProvider>
      </body>
    </html>
  );
}
