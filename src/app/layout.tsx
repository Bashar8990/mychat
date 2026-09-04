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
  title: "Calculator",
  description: "Calculator - Simple and elegant",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Calculator",
  },
};

export const viewport = {
  themeColor: "#1c1c1e",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#1c1c1e" />
        <link rel="apple-touch-icon" href="/icon-180.png" />
      </head>
      <body className="min-h-full flex flex-col bg-[#1c1c1e]">
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if('serviceWorker' in navigator){
                window.addEventListener('load',function(){
                  navigator.serviceWorker.register('/sw.js').then(function(reg){
                    console.log('SW registered:', reg.scope);
                  }).catch(function(err){
                    console.log('SW register failed:', err);
                  });
                });
              }
              var deferredPrompt;
              window.addEventListener('beforeinstallprompt', function(e){
                e.preventDefault();
                deferredPrompt = e;
                console.log('beforeinstallprompt captured');
              });
            `,
          }}
        />
      </body>
    </html>
  );
}
