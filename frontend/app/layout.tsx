import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "ServeAI — Serviços locais, resolvidos",
  description: "Um agente autônomo para contratar serviços locais por você.",
  icons: {
    icon: "/serveai-logo.png",
    apple: "/serveai-logo.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className={GeistSans.className}>{children}</body>
    </html>
  );
}
