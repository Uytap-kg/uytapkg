import { Noto_Sans } from "next/font/google";
import Script from "next/script";

import NavigationLoader from "@/components/ui/navigationLoader/NavigationLoader";
import LanguageProvider from "../context/LanguageContext";

import "./globals.css";

const notoSans = Noto_Sans({
  subsets: ["cyrillic", "cyrillic-ext"],
  weight: ["400", "500", "700", "900"],
  display: "swap",
});

export default function RootLayout({ children }) {
  return (
    <html
      lang="ru"
      data-scroll-behavior="smooth"
      className={notoSans.className}
    >
      <body>
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=AW-18128866403"
          strategy="afterInteractive"
        />

        <Script id="google-ads-tag" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag() {
              window.dataLayer.push(arguments);
            }
            window.gtag = gtag;
            gtag('js', new Date());
            gtag('config', 'AW-18128866403');
          `}
        </Script>

        <LanguageProvider>
          <NavigationLoader />
          {children}
        </LanguageProvider>
      </body>
    </html>
  );
}
