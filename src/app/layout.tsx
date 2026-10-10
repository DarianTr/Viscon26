import type { Metadata, Viewport } from "next";
import { Baloo_2, Plus_Jakarta_Sans } from "next/font/google";
import { NumericInputWheelGuard } from "@/components/numeric-input-wheel-guard";
import "./globals.css";

const baloo = Baloo_2({
  variable: "--font-baloo",
  subsets: ["latin"],
  weight: "variable",
});

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: "variable",
});

export const metadata: Metadata = {
  title: { default: "Braina", template: "%s · Braina" },
  description: "Grow your brain by using it — study plans, a focus timer and a feed for studying.",
  appleWebApp: { capable: true, title: "Braina", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f7f5ec",
};

/** Sets the dark class before paint, so there's no flash of the wrong theme on load. */
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("braina-theme");var d=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${baloo.variable} ${jakarta.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <NumericInputWheelGuard />
        {children}
      </body>
    </html>
  );
}
